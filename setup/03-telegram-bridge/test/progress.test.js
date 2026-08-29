// test/progress.test.js
const test = require("node:test");
const assert = require("node:assert");
const { createProgress, describeEvent } = require("../lib/progress");

function harness({ startTime = 0 } = {}) {
  const actions = [];
  const sent = [];
  const edits = [];
  const deletes = [];
  const logs = [];
  const intervals = [];
  let clock = startTime;

  const api = {
    sendChatAction: async (p) => { actions.push(p); },
    sendMessage: async (p) => { sent.push(p); return { message_id: 500 + sent.length }; },
    editMessageText: async (p) => { edits.push(p); },
    deleteMessage: async (p) => { deletes.push(p); },
  };

  const progress = createProgress({
    api,
    log: (m) => logs.push(m),
    now: () => clock,
    setIntervalFn: (fn, ms) => { intervals.push({ fn, ms, cleared: false }); return intervals.length - 1; },
    clearIntervalFn: (id) => { if (intervals[id]) intervals[id].cleared = true; },
  });

  return {
    progress, api, actions, sent, edits, deletes, logs, intervals,
    advance: (ms) => { clock += ms; },
    tick: async (i = 0) => { await intervals[i].fn(); },
  };
}

const flush = () => new Promise((r) => setImmediate(r));

// --- describeEvent ----------------------------------------------------------

test("describeEvent names the tool and its target", () => {
  const event = {
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/project/x.md" } }] },
  };
  const text = describeEvent(event);
  assert.ok(text.includes("Read"), `expected the tool name, got: ${text}`);
  assert.ok(text.includes("x.md"), `expected the target, got: ${text}`);
});

test("describeEvent handles a Bash tool by showing the command", () => {
  const event = {
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "Bash", input: { command: "git status" } }] },
  };
  assert.ok(describeEvent(event).includes("git status"));
});

test("describeEvent handles a tool with no recognisable target", () => {
  const event = {
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "WebSearch", input: {} }] },
  };
  const text = describeEvent(event);
  assert.ok(text.includes("WebSearch"));
});

test("describeEvent reports init as starting", () => {
  assert.ok(/start/i.test(describeEvent({ type: "system", subtype: "init" })));
});

test("describeEvent returns null for noise", () => {
  assert.strictEqual(describeEvent({ type: "system", subtype: "hook_started" }), null);
  assert.strictEqual(describeEvent({ type: "system", subtype: "hook_response" }), null);
  assert.strictEqual(describeEvent({ type: "system", subtype: "thinking_tokens" }), null);
  assert.strictEqual(describeEvent({ type: "rate_limit_event" }), null);
  assert.strictEqual(describeEvent({ type: "result", subtype: "success" }), null);
  assert.strictEqual(describeEvent({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } }), null);
});

test("describeEvent survives a malformed event", () => {
  assert.strictEqual(describeEvent(null), null);
  assert.strictEqual(describeEvent({}), null);
  assert.strictEqual(describeEvent({ type: "assistant" }), null);
  assert.strictEqual(describeEvent({ type: "assistant", message: {} }), null);
});

// --- tracker ----------------------------------------------------------------

test("sends a typing action immediately on start", async () => {
  const h = harness();
  h.progress.start(42);
  await flush();

  assert.strictEqual(h.actions.length, 1);
  assert.strictEqual(h.actions[0].chat_id, 42);
  assert.strictEqual(h.actions[0].action, "typing");
});

test("repeats the typing action on the interval", async () => {
  const h = harness();
  h.progress.start(42);
  await flush();

  await h.tick();
  await flush();

  assert.strictEqual(h.actions.length, 2);
});

test("the typing interval is under Telegram's five second expiry", () => {
  const h = harness();
  h.progress.start(42);
  assert.ok(h.intervals[0].ms < 5000, `interval ${h.intervals[0].ms}ms would let the indicator flicker`);
});

test("the first meaningful event posts a status message", async () => {
  const h = harness();
  const t = h.progress.start(42);
  await flush();

  await t.update({ type: "system", subtype: "init" });
  await flush();

  assert.strictEqual(h.sent.length, 1);
  assert.strictEqual(h.sent[0].chat_id, 42);
});

test("later events edit that message rather than sending new ones", async () => {
  const h = harness();
  const t = h.progress.start(42);
  await t.update({ type: "system", subtype: "init" });
  await flush();

  h.advance(5000);
  await t.update({
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "a.md" } }] },
  });
  await flush();

  assert.strictEqual(h.sent.length, 1, "must not send a second message");
  assert.strictEqual(h.edits.length, 1);
  assert.strictEqual(h.edits[0].message_id, 501);
});

test("throttles edits so a fast tool loop cannot earn a 429", async () => {
  const h = harness();
  const t = h.progress.start(42);
  await t.update({ type: "system", subtype: "init" });
  await flush();

  for (let i = 0; i < 5; i += 1) {
    h.advance(200); // well inside the throttle window
    await t.update({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Read", input: { file_path: `f${i}.md` } }] },
    });
  }
  await flush();

  assert.strictEqual(h.edits.length, 0, `expected throttling, got ${h.edits.length} edits`);
});

test("noise events never post or edit anything", async () => {
  const h = harness();
  const t = h.progress.start(42);
  await flush();

  await t.update({ type: "system", subtype: "hook_started" });
  await t.update({ type: "rate_limit_event" });
  await flush();

  assert.strictEqual(h.sent.length, 0);
  assert.strictEqual(h.edits.length, 0);
});

test("finish clears the typing interval and deletes the status message", async () => {
  const h = harness();
  const t = h.progress.start(42);
  await t.update({ type: "system", subtype: "init" });
  await flush();

  await t.finish();

  assert.strictEqual(h.intervals[0].cleared, true);
  assert.strictEqual(h.deletes.length, 1);
  assert.strictEqual(h.deletes[0].message_id, 501);
});

test("finish is safe when no status message was ever posted", async () => {
  const h = harness();
  const t = h.progress.start(42);
  await flush();

  await t.finish();

  assert.strictEqual(h.intervals[0].cleared, true);
  assert.strictEqual(h.deletes.length, 0);
});

test("finish twice does not delete twice", async () => {
  const h = harness();
  const t = h.progress.start(42);
  await t.update({ type: "system", subtype: "init" });
  await flush();

  await t.finish();
  await t.finish();

  assert.strictEqual(h.deletes.length, 1);
});

test("a failing delete is swallowed so it cannot mask the real error", async () => {
  const h = harness();
  h.api.deleteMessage = async () => { throw new Error("message to delete not found"); };
  const t = h.progress.start(42);
  await t.update({ type: "system", subtype: "init" });
  await flush();

  await assert.doesNotReject(() => t.finish());
});

test("a failing typing action does not throw into the run", async () => {
  const h = harness();
  h.api.sendChatAction = async () => { throw new Error("network blip"); };

  assert.doesNotThrow(() => h.progress.start(42));
  await flush();
});

test("update after finish does nothing", async () => {
  const h = harness();
  const t = h.progress.start(42);
  await t.finish();

  h.advance(10000);
  await t.update({ type: "system", subtype: "init" });
  await flush();

  assert.strictEqual(h.sent.length, 0);
});
