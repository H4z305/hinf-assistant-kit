// test/thread-commands.test.js
const test = require("node:test");
const assert = require("node:assert");
const newCmd = require("../lib/commands/new");
const threadsCmd = require("../lib/commands/threads");
const statusCmd = require("../lib/commands/status");
const callbackCmd = require("../lib/commands/callback");
const { createThreads } = require("../lib/threads");

function memFs() {
  const files = new Map();
  return {
    existsSync: (p) => files.has(p),
    readFileSync: (p) => {
      if (!files.has(p)) { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; }
      return files.get(p);
    },
    writeFileSync: (p, d) => { files.set(p, d); },
  };
}

function makeThreads() {
  return createThreads({ filePath: "threads.json", fsImpl: memFs() });
}

// --- /new ---------------------------------------------------------------------

test("/new with a topic switches to a freshly slugified thread and confirms by name", async () => {
  const sessions = makeThreads();
  const reply = await newCmd.handler({ args: "Career Roadmap", sessions });

  assert.strictEqual(sessions.currentName(), "career-roadmap");
  assert.match(reply, /career-roadmap/);
});

test("/new with no args still creates a usable, distinctly-named thread", async () => {
  const sessions = makeThreads();
  const before = sessions.currentName();
  const reply = await newCmd.handler({ args: "", sessions });

  assert.notStrictEqual(sessions.currentName(), before);
  assert.match(reply, new RegExp(sessions.currentName()));
});

test("/new twice with no args produces two different thread names", async () => {
  const sessions = makeThreads();
  await newCmd.handler({ args: "", sessions });
  const first = sessions.currentName();
  await newCmd.handler({ args: "", sessions });
  const second = sessions.currentName();

  assert.notStrictEqual(first, second);
});

test("/new reports a friendly error rather than crashing on a duplicate name", async () => {
  const sessions = makeThreads();
  await newCmd.handler({ args: "career", sessions });
  sessions.switchTo("main");

  const reply = await newCmd.handler({ args: "career", sessions });
  assert.match(reply, /already exists/i);
  assert.strictEqual(sessions.currentName(), "main", "must not switch on failure");
});

// --- /threads -------------------------------------------------------------

test("/threads sends its own message with an inline keyboard of th:-prefixed buttons", async () => {
  const sessions = makeThreads();
  sessions.create("career");
  sessions.create("grey-court");

  const sent = [];
  const api = { sendMessage: async (p) => { sent.push(p); return { message_id: 1 }; } };

  const reply = await threadsCmd.handler({ chatId: 42, api, sessions });

  assert.strictEqual(reply, undefined, "the handler sends its own reply and returns nothing");
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].chat_id, 42);

  const buttons = sent[0].reply_markup.inline_keyboard.flat();
  assert.ok(buttons.length >= 3, "expected a button per thread");
  for (const b of buttons) {
    assert.ok(b.callback_data.startsWith("th:"), `bad callback_data: ${b.callback_data}`);
    assert.ok(Buffer.byteLength(b.callback_data, "utf8") <= 64, `callback_data too long: ${b.callback_data}`);
  }
});

test("/threads marks the current thread in its text", async () => {
  const sessions = makeThreads();
  sessions.create("career");

  const sent = [];
  const api = { sendMessage: async (p) => { sent.push(p); return { message_id: 1 }; } };
  await threadsCmd.handler({ chatId: 1, api, sessions });

  assert.match(sent[0].text, /career/);
});

// --- callback (__callback__) -----------------------------------------------

test("switches thread on a th: callback and acknowledges by name", async () => {
  const sessions = makeThreads();
  sessions.create("career");
  sessions.switchTo("main");

  const reply = await callbackCmd.handler({ data: "th:career", sessions });

  assert.strictEqual(sessions.currentName(), "career");
  assert.match(reply, /career/);
});

test("ignores unrelated callback_data without crashing", async () => {
  const sessions = makeThreads();
  const before = sessions.currentName();

  const reply = await callbackCmd.handler({ data: "noop", sessions });

  assert.strictEqual(sessions.currentName(), before);
  assert.strictEqual(reply, undefined);
});

test("a th: callback for a thread that no longer exists reports gracefully", async () => {
  const sessions = makeThreads();
  const reply = await callbackCmd.handler({ data: "th:ghost", sessions });

  assert.match(reply, /no longer exists|not found/i);
});

// --- /status ----------------------------------------------------------------

test("/status reports the current thread, polling mode and a notional cost", async () => {
  const sessions = makeThreads();
  sessions.create("career");

  const reply = await statusCmd.handler({
    sessions,
    audit: { totalCostToday: () => 0.42 },
    extra: { poller: { state: { mode: "long", lastSuccessAt: 1000 } }, startedAt: 500 },
  });

  assert.match(reply, /career/);
  assert.match(reply, /long/);
  assert.match(reply, /notional/i);
  assert.match(reply, /0\.42/);
});

test("/status does not crash when extra is missing pieces", async () => {
  const sessions = makeThreads();
  await assert.doesNotReject(() =>
    statusCmd.handler({ sessions, audit: { totalCostToday: () => 0 }, extra: {} })
  );
});
