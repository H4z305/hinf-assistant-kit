// test/claude-runner.test.js
const test = require("node:test");
const assert = require("node:assert");
const { EventEmitter } = require("node:events");
const {
  createClaudeRunner,
  AbortedError,
  parseNdjsonChunk,
} = require("../lib/claude-runner");

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr.setEncoding = () => {};
  child.killed = false;
  child.kill = () => { child.killed = true; };
  return child;
}

function harness(opts = {}) {
  const { timeoutMs = 600000 } = opts;
  const spawned = [];
  const child = fakeChild();
  const spawnFn = (exe, args, opts) => {
    spawned.push({ exe, args, opts });
    return child;
  };
  const runner = createClaudeRunner({
    spawnFn,
    claudeExecutable: "claude",
    cwd: "/project",
    permissionMode: opts.permissionMode,
    timeoutMs,
  });
  return { runner, child, spawned };
}

const RESULT_EVENT = JSON.stringify({
  type: "result",
  subtype: "success",
  session_id: "sess-1",
  result: "the answer",
  is_error: false,
  total_cost_usd: 0.12,
});

// --- parseNdjsonChunk -------------------------------------------------------

test("parseNdjsonChunk returns complete objects and keeps the remainder", () => {
  const a = parseNdjsonChunk("", '{"type":"one"}\n{"type":"tw');
  assert.deepStrictEqual(a.events, [{ type: "one" }]);
  assert.strictEqual(a.buffer, '{"type":"tw');

  const b = parseNdjsonChunk(a.buffer, 'o"}\n');
  assert.deepStrictEqual(b.events, [{ type: "two" }]);
  assert.strictEqual(b.buffer, "");
});

test("parseNdjsonChunk splits a JSON object across three chunks", () => {
  let buffer = "";
  const all = [];
  for (const chunk of ['{"ty', 'pe":"sp', 'lit"}\n']) {
    const out = parseNdjsonChunk(buffer, chunk);
    buffer = out.buffer;
    all.push(...out.events);
  }
  assert.deepStrictEqual(all, [{ type: "split" }]);
});

test("parseNdjsonChunk skips malformed lines rather than throwing", () => {
  const out = parseNdjsonChunk("", 'not json\n{"type":"ok"}\nalso not json\n');
  assert.deepStrictEqual(out.events, [{ type: "ok" }]);
});

test("parseNdjsonChunk ignores blank lines", () => {
  const out = parseNdjsonChunk("", '\n\n{"type":"ok"}\n\n');
  assert.deepStrictEqual(out.events, [{ type: "ok" }]);
});

// --- run --------------------------------------------------------------------

test("asks for stream-json with verbose", async () => {
  const h = harness();
  const p = h.runner.run({ prompt: "hello" });
  h.child.stdout.emit("data", RESULT_EVENT + "\n");
  h.child.emit("close", 0);
  await p;

  assert.deepStrictEqual(h.spawned[0].args, [
    "-p", "hello",
    "--permission-mode", "acceptEdits",
    "--output-format", "stream-json",
    "--verbose",
  ]);
  assert.strictEqual(h.spawned[0].opts.cwd, "/project");
});

test("defaults --permission-mode to the safe acceptEdits", async () => {
  const h = harness();
  const p = h.runner.run({ prompt: "hi" });
  h.child.stdout.emit("data", RESULT_EVENT + "\n");
  h.child.emit("close", 0);
  await p;
  const args = h.spawned[0].args;
  assert.strictEqual(args[args.indexOf("--permission-mode") + 1], "acceptEdits");
});

test("passes a custom permissionMode straight through", async () => {
  const h = harness({ permissionMode: "bypassPermissions" });
  const p = h.runner.run({ prompt: "hi" });
  h.child.stdout.emit("data", RESULT_EVENT + "\n");
  h.child.emit("close", 0);
  await p;
  const args = h.spawned[0].args;
  assert.strictEqual(args[args.indexOf("--permission-mode") + 1], "bypassPermissions");
});

test("closes stdin so the CLI doesn't wait ~3s on an unconnected pipe (observed intermittent exit-1 in prod)", async () => {
  const h = harness();
  const p = h.runner.run({ prompt: "hello" });
  h.child.stdout.emit("data", RESULT_EVENT + "\n");
  h.child.emit("close", 0);
  await p;

  assert.deepStrictEqual(h.spawned[0].opts.stdio, ["ignore", "pipe", "pipe"]);
});

test("does not override env, so the OAuth login keeps working", async () => {
  const h = harness();
  const p = h.runner.run({ prompt: "hi" });
  h.child.stdout.emit("data", RESULT_EVENT + "\n");
  h.child.emit("close", 0);
  await p;

  assert.strictEqual("env" in h.spawned[0].opts, false, "spawn options must not set env");
});

test("appends --resume only when a sessionId is given", async () => {
  const h = harness();
  const p = h.runner.run({ prompt: "hi", sessionId: "abc" });
  h.child.stdout.emit("data", RESULT_EVENT + "\n");
  h.child.emit("close", 0);
  await p;

  const args = h.spawned[0].args;
  assert.strictEqual(args[args.indexOf("--resume") + 1], "abc");
});

test("resolves from the result event with text, sessionId and cost", async () => {
  const h = harness();
  const p = h.runner.run({ prompt: "hi" });
  h.child.stdout.emit("data", RESULT_EVENT + "\n");
  h.child.emit("close", 0);

  assert.deepStrictEqual(await p, {
    text: "the answer",
    sessionId: "sess-1",
    isError: false,
    costUsd: 0.12,
  });
});

test("sets utf8 encoding on both streams", async () => {
  const encodings = [];
  const child = fakeChild();
  child.stdout.setEncoding = (e) => encodings.push(["stdout", e]);
  child.stderr.setEncoding = (e) => encodings.push(["stderr", e]);
  const runner = createClaudeRunner({ spawnFn: () => child, claudeExecutable: "claude", cwd: "." });

  const p = runner.run({ prompt: "hi" });
  child.stdout.emit("data", RESULT_EVENT + "\n");
  child.emit("close", 0);
  await p;

  assert.deepStrictEqual(encodings, [["stdout", "utf8"], ["stderr", "utf8"]]);
});

test("passes every parsed event to onEvent, in order", async () => {
  const h = harness();
  const seen = [];
  const p = h.runner.run({ prompt: "hi", onEvent: (e) => seen.push(e.type) });

  h.child.stdout.emit("data", '{"type":"system","subtype":"init"}\n');
  h.child.stdout.emit("data", '{"type":"assistant"}\n');
  h.child.stdout.emit("data", RESULT_EVENT + "\n");
  h.child.emit("close", 0);
  await p;

  assert.deepStrictEqual(seen, ["system", "assistant", "result"]);
});

test("a throwing onEvent does not kill the run", async () => {
  const h = harness();
  const p = h.runner.run({
    prompt: "hi",
    onEvent: () => { throw new Error("listener exploded"); },
  });

  h.child.stdout.emit("data", '{"type":"assistant"}\n');
  h.child.stdout.emit("data", RESULT_EVENT + "\n");
  h.child.emit("close", 0);

  assert.strictEqual((await p).text, "the answer");
});

test("rejects when the process exits 0 without ever emitting a result event", async () => {
  const h = harness();
  const p = h.runner.run({ prompt: "hi" });
  h.child.stdout.emit("data", '{"type":"assistant"}\n');
  h.child.emit("close", 0);

  await assert.rejects(() => p, /no result event/i);
});

test("rejects on a non-zero exit and includes the tail of stderr", async () => {
  const h = harness();
  const p = h.runner.run({ prompt: "hi" });
  h.child.stderr.emit("data", "something exploded");
  h.child.emit("close", 1);

  await assert.rejects(() => p, /exited 1[\s\S]*something exploded/);
});

test("rejects when the result event is missing session_id or result", async () => {
  const h = harness();
  const p = h.runner.run({ prompt: "hi" });
  h.child.stdout.emit("data", JSON.stringify({ type: "result", result: "no session id" }) + "\n");
  h.child.emit("close", 0);

  await assert.rejects(() => p, /unexpected claude result shape/);
});

test("an abort signal kills the child and rejects with AbortedError", async () => {
  const h = harness();
  const controller = new AbortController();
  const p = h.runner.run({ prompt: "hi", signal: controller.signal });

  controller.abort();

  await assert.rejects(() => p, (err) => {
    assert.ok(err instanceof AbortedError);
    assert.strictEqual(err.aborted, true);
    return true;
  });
  assert.strictEqual(h.child.killed, true);
});

test("an already-aborted signal rejects without spawning a run that hangs", async () => {
  const h = harness();
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => h.runner.run({ prompt: "hi", signal: controller.signal }),
    AbortedError
  );
});

test("a late close after an abort does not settle the promise twice", async () => {
  const h = harness();
  const controller = new AbortController();
  const p = h.runner.run({ prompt: "hi", signal: controller.signal });

  controller.abort();
  await assert.rejects(() => p, AbortedError);

  h.child.stdout.emit("data", RESULT_EVENT + "\n");
  h.child.emit("close", 0);
});

test("rejects on timeout and kills the child", async () => {
  const h = harness({ timeoutMs: 5 });
  const p = h.runner.run({ prompt: "hi" });

  await assert.rejects(() => p, /timed out after 5ms/);
  assert.strictEqual(h.child.killed, true);
});

test("rejects when the process fails to spawn", async () => {
  const h = harness();
  const p = h.runner.run({ prompt: "hi" });
  h.child.emit("error", new Error("ENOENT"));

  await assert.rejects(() => p, /ENOENT/);
});
