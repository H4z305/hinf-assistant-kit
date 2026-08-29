// test/heartbeat.test.js
const test = require("node:test");
const assert = require("node:assert");
const { createHeartbeat } = require("../lib/heartbeat");

const MINUTE = 60 * 1000;

function harness({ lastSuccessAt = 0, mode = "long" } = {}) {
  const sent = [];
  const logs = [];
  const intervals = [];
  let clock = 0;

  const poller = { state: { lastSuccessAt, mode } };

  const heartbeat = createHeartbeat({
    api: { sendMessage: async (p) => { sent.push(p); } },
    ownerId: "555",
    poller,
    log: (m) => logs.push(m),
    now: () => clock,
    setIntervalFn: (fn, ms) => { intervals.push({ fn, ms, cleared: false }); return intervals.length - 1; },
    clearIntervalFn: (id) => { if (intervals[id]) intervals[id].cleared = true; },
  });

  return {
    heartbeat, poller, sent, logs, intervals,
    advance: (ms) => { clock += ms; },
    setLastSuccess: (t) => { poller.state.lastSuccessAt = t; },
  };
}

test("stays silent while polling is healthy", async () => {
  const h = harness({ lastSuccessAt: 0 });
  h.advance(2 * MINUTE);
  h.setLastSuccess(2 * MINUTE);

  await h.heartbeat.check();

  assert.strictEqual(h.sent.length, 0);
});

test("alerts once inbound has been silent past the threshold", async () => {
  const h = harness({ lastSuccessAt: 0 });
  h.advance(11 * MINUTE);

  await h.heartbeat.check();

  assert.strictEqual(h.sent.length, 1);
  assert.strictEqual(String(h.sent[0].chat_id), "555");
  assert.match(h.sent[0].text, /not received/i);
});

test("never alerts before the first successful poll", async () => {
  // lastSuccessAt is null at startup. Treating that as silence would fire an
  // alert on every single boot.
  const h = harness({ lastSuccessAt: null });
  h.advance(60 * MINUTE);

  await h.heartbeat.check();

  assert.strictEqual(h.sent.length, 0);
});

test("does not repeat the alert inside the notify gap", async () => {
  const h = harness({ lastSuccessAt: 0 });
  h.advance(11 * MINUTE);
  await h.heartbeat.check();

  h.advance(5 * MINUTE);
  await h.heartbeat.check();

  assert.strictEqual(h.sent.length, 1);
});

test("repeats the alert once the notify gap has passed", async () => {
  const h = harness({ lastSuccessAt: 0 });
  h.advance(11 * MINUTE);
  await h.heartbeat.check();

  h.advance(61 * MINUTE);
  await h.heartbeat.check();

  assert.strictEqual(h.sent.length, 2);
});

test("goes quiet again once polling recovers", async () => {
  const h = harness({ lastSuccessAt: 0 });
  h.advance(11 * MINUTE);
  await h.heartbeat.check();

  h.advance(1 * MINUTE);
  h.setLastSuccess(12 * MINUTE);
  await h.heartbeat.check();

  assert.strictEqual(h.sent.length, 1);
});

test("re-alerts after a recovery followed by fresh silence", async () => {
  const h = harness({ lastSuccessAt: 0 });
  h.advance(11 * MINUTE);
  await h.heartbeat.check();

  // Recover.
  h.advance(1 * MINUTE);
  h.setLastSuccess(12 * MINUTE);
  await h.heartbeat.check();

  // Go silent again, well past the notify gap.
  h.advance(70 * MINUTE);
  await h.heartbeat.check();

  assert.strictEqual(h.sent.length, 2);
});

test("reports the polling mode so the message is actionable", async () => {
  const h = harness({ lastSuccessAt: 0, mode: "short" });
  h.advance(11 * MINUTE);

  await h.heartbeat.check();

  assert.match(h.sent[0].text, /short/);
});

test("a failing alert send is logged, not thrown", async () => {
  const h = harness({ lastSuccessAt: 0 });
  h.heartbeat.stop();
  const failing = createHeartbeat({
    api: { sendMessage: async () => { throw new Error("network down"); } },
    ownerId: "555",
    poller: { state: { lastSuccessAt: 0, mode: "long" } },
    log: () => {},
    now: () => 11 * MINUTE,
  });

  await assert.doesNotReject(() => failing.check());
});

test("does nothing when no owner is configured", async () => {
  const sent = [];
  const hb = createHeartbeat({
    api: { sendMessage: async (p) => { sent.push(p); } },
    ownerId: "",
    poller: { state: { lastSuccessAt: 0, mode: "long" } },
    log: () => {},
    now: () => 11 * MINUTE,
  });

  await hb.check();

  assert.strictEqual(sent.length, 0);
});

test("start registers an interval and stop clears it", () => {
  const h = harness();
  h.heartbeat.start();
  assert.strictEqual(h.intervals.length, 1);

  h.heartbeat.stop();
  assert.strictEqual(h.intervals[0].cleared, true);
});
