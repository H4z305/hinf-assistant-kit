// test/poller.test.js
const test = require("node:test");
const assert = require("node:assert");
const { createPoller } = require("../lib/poller");

// A poller that stops itself after N calls, so run() terminates.
function harness({ script, stopAfterCalls = Infinity }) {
  const logs = [];
  const sleeps = [];
  const seen = [];
  let calls = 0;
  let poller;

  const api = {
    getUpdates: async () => {
      calls += 1;
      if (calls >= stopAfterCalls) poller.stop();
      const step = script[Math.min(calls - 1, script.length - 1)];
      if (step instanceof Error) throw step;
      return step;
    },
  };

  poller = createPoller({
    api,
    onUpdates: async (updates) => { seen.push(...updates); },
    log: (m) => logs.push(m),
    sleep: async (ms) => { sleeps.push(ms); },
    now: () => 1000,
  });

  return { poller, logs, sleeps, seen };
}

function netError() {
  return new TypeError("fetch failed");
}

function conflictError() {
  const err = new Error("Conflict");
  err.status = 409;
  return err;
}

test("starts in long-poll mode and asks for a 25 second timeout", async () => {
  const captured = [];
  let poller;
  const api = {
    getUpdates: async (params) => { captured.push(params); poller.stop(); return []; },
  };
  poller = createPoller({ api, onUpdates: async () => {}, log: () => {}, sleep: async () => {} });

  await poller.run();

  assert.strictEqual(poller.state.mode, "long");
  assert.strictEqual(captured[0].timeout, 25);
  assert.deepStrictEqual(captured[0].allowed_updates, ["message", "callback_query"]);
});

test("degrades to short polling after three consecutive long-poll failures", async () => {
  const h = harness({ script: [netError(), netError(), netError(), []], stopAfterCalls: 4 });

  await h.poller.run();

  assert.strictEqual(h.poller.state.mode, "short");
  const degradeLines = h.logs.filter((l) => /degraded to short polling/.test(l));
  assert.strictEqual(degradeLines.length, 1, "the degrade must be logged exactly once");
});

test("does not degrade at two failures", async () => {
  const h = harness({ script: [netError(), netError(), []], stopAfterCalls: 3 });

  await h.poller.run();

  assert.strictEqual(h.poller.state.mode, "long");
});

test("logs only once while failures repeat", async () => {
  const h = harness({
    script: [netError(), netError(), netError(), netError(), netError()],
    stopAfterCalls: 5,
  });

  await h.poller.run();

  const failLines = h.logs.filter((l) => /Poll failed/.test(l));
  assert.strictEqual(failLines.length, 1, "repeated failures must not spam the log");
});

test("recovers to long polling after ten clean short polls", async () => {
  const script = [netError(), netError(), netError()];
  for (let i = 0; i < 10; i += 1) script.push([]);
  const h = harness({ script, stopAfterCalls: 13 });

  await h.poller.run();

  assert.strictEqual(h.poller.state.mode, "long");
  assert.strictEqual(h.logs.filter((l) => /recovered/.test(l)).length, 1);
});

test("advances the offset past the highest update_id", async () => {
  const h = harness({ script: [[{ update_id: 40 }, { update_id: 41 }], []], stopAfterCalls: 2 });

  await h.poller.run();

  assert.strictEqual(h.poller.state.offset, 42);
  assert.deepStrictEqual(h.seen.map((u) => u.update_id), [40, 41]);
});

test("a throwing handler does not wedge the loop or rewind the offset", async () => {
  let poller;
  let calls = 0;
  const logs = [];
  const api = {
    getUpdates: async () => {
      calls += 1;
      if (calls >= 2) { poller.stop(); return []; }
      return [{ update_id: 99 }];
    },
  };
  poller = createPoller({
    api,
    onUpdates: async () => { throw new Error("poison update"); },
    log: (m) => logs.push(m),
    sleep: async () => {},
  });

  await poller.run();

  assert.strictEqual(poller.state.offset, 100, "offset must still advance");
  assert.ok(logs.some((l) => /poison update/.test(l)));
});

test("stops immediately on 409 Conflict rather than fighting for the token", async () => {
  const h = harness({ script: [conflictError()] });

  await h.poller.run();

  assert.strictEqual(h.poller.state.running, false);
  assert.strictEqual(h.poller.state.stopReason, "conflict");
  assert.ok(h.logs.some((l) => /409/.test(l)));
});

test("honours retry_after instead of its own backoff", async () => {
  const rateLimited = new Error("Too Many Requests");
  rateLimited.status = 429;
  rateLimited.retryAfter = 7;
  const h = harness({ script: [rateLimited, []], stopAfterCalls: 2 });

  await h.poller.run();

  assert.ok(h.sleeps.includes(7000), `expected a 7000ms sleep, got ${h.sleeps}`);
});

test("backoff grows and is capped at 30 seconds", async () => {
  const script = [];
  for (let i = 0; i < 8; i += 1) script.push(netError());
  const h = harness({ script, stopAfterCalls: 8 });

  await h.poller.run();

  assert.ok(Math.max(...h.sleeps) <= 30000, `backoff exceeded the cap: ${h.sleeps}`);
  assert.ok(h.sleeps.length > 1);
});

test("records lastSuccessAt on a successful poll", async () => {
  const h = harness({ script: [[]], stopAfterCalls: 1 });

  await h.poller.run();

  assert.strictEqual(h.poller.state.lastSuccessAt, 1000);
});
