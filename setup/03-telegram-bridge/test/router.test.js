// test/router.test.js
const test = require("node:test");
const assert = require("node:assert");
const { createRouter, parseCommand } = require("../lib/router");
const { createQueue } = require("../lib/queue");
const { createSessionsMemory } = require("../lib/sessions-memory");
const { AbortedError } = require("../lib/claude-runner");

const OWNER = "1807215308";
const NOW_MS = Date.UTC(2026, 7, 17, 12, 0, 0);
const nowSec = Math.floor(NOW_MS / 1000);

// handleUpdates returns before the queued turn finishes, by design, so tests
// drain the queue before asserting on what was sent.
async function drain(router, updates) {
  await router.handleUpdates(updates);
  await router.whenIdle();
}

function msgUpdate({ id = 1, text = "hi", from = OWNER, chat = OWNER, date = nowSec } = {}) {
  return {
    update_id: id,
    message: { message_id: id, from: { id: Number(from) }, chat: { id: Number(chat) }, date, text },
  };
}

function harness({ runResult, runError, commands = {} } = {}) {
  const sent = [];
  const docs = [];
  const logs = [];
  const audited = [];

  const api = {
    sendMessage: async (p) => { sent.push(p); return { message_id: 900 + sent.length }; },
    sendDocument: async (p) => { docs.push(p); return { message_id: 999 }; },
    answerCallbackQuery: async () => {},
    editMessageText: async () => {},
    deleteMessage: async () => {},
    sendChatAction: async () => {},
  };

  const runner = {
    run: async ({ signal }) => {
      if (runError) throw runError;
      if (signal && signal.aborted) throw new AbortedError();
      return runResult || { text: "answer", sessionId: "sess-9", costUsd: 0.05 };
    },
  };

  const router = createRouter({
    api,
    ownerId: OWNER,
    commands,
    runner,
    queue: createQueue(),
    audit: { append: (e) => audited.push(e), totalCostToday: () => 0, readToday: () => [] },
    sessions: createSessionsMemory(),
    log: (m) => logs.push(m),
    now: () => NOW_MS,
  });

  return { router, sent, docs, logs, audited, api };
}

test("parseCommand pulls the name and the rest as args", () => {
  assert.deepStrictEqual(parseCommand("/new career stuff"), { name: "new", args: "career stuff" });
  assert.deepStrictEqual(parseCommand("/threads"), { name: "threads", args: "" });
  assert.deepStrictEqual(parseCommand("/New"), { name: "new", args: "" });
  assert.strictEqual(parseCommand("not a command"), null);
});

test("parseCommand tolerates the @botname suffix Telegram adds", () => {
  assert.deepStrictEqual(
    parseCommand("/status@Emily_Secretary_H4z_bot"),
    { name: "status", args: "" }
  );
});

test("runs a turn and sends the reply as HTML", async () => {
  const h = harness();
  await drain(h.router, [msgUpdate({ text: "what is up" })]);

  assert.strictEqual(h.sent.length, 1);
  assert.strictEqual(h.sent[0].text, "answer");
  assert.strictEqual(h.sent[0].parse_mode, "HTML");
  assert.strictEqual(String(h.sent[0].chat_id), OWNER);
});

test("stores the returned session id so the next turn resumes", async () => {
  const seen = [];
  const router = createRouter({
    api: { sendMessage: async () => ({ message_id: 1 }) },
    ownerId: OWNER,
    commands: {},
    runner: {
      run: async ({ sessionId }) => {
        seen.push(sessionId);
        return { text: "ok", sessionId: "sess-A", costUsd: 0 };
      },
    },
    queue: createQueue(),
    audit: { append: () => {} },
    sessions: createSessionsMemory(),
    log: () => {},
    now: () => NOW_MS,
  });

  await drain(router, [msgUpdate({ id: 1, text: "one" })]);
  await drain(router, [msgUpdate({ id: 2, text: "two" })]);

  assert.deepStrictEqual(seen, [null, "sess-A"]);
});

test("drops a message from a stranger and never replies", async () => {
  const h = harness();
  await drain(h.router, [msgUpdate({ from: "999", chat: "999" })]);

  assert.strictEqual(h.sent.length, 0);
  assert.ok(h.logs.some((l) => /unauthorized/i.test(l)));
});

test("drops a message where the sender matches but the chat does not", async () => {
  const h = harness();
  await drain(h.router, [msgUpdate({ from: OWNER, chat: "-100123" })]);

  assert.strictEqual(h.sent.length, 0);
});

test("reports stale messages instead of executing them", async () => {
  const h = harness();
  await drain(h.router, [
    msgUpdate({ id: 1, text: "delete the old files", date: nowSec - 2 * 86400 }),
  ]);

  assert.strictEqual(h.sent.length, 1);
  assert.match(h.sent[0].text, /while I was down/i);
  assert.match(h.sent[0].text, /delete the old files/);
  assert.strictEqual(h.audited.length, 0, "a stale message must not produce a turn");
});

test("batches several stale messages into one report", async () => {
  const h = harness();
  const old = nowSec - 3 * 86400;

  await drain(h.router, [
    msgUpdate({ id: 1, text: "first", date: old }),
    msgUpdate({ id: 2, text: "second", date: old }),
  ]);

  assert.strictEqual(h.sent.length, 1);
  assert.match(h.sent[0].text, /first/);
  assert.match(h.sent[0].text, /second/);
});

test("processes fresh messages in the same batch as stale ones", async () => {
  const h = harness();
  await drain(h.router, [
    msgUpdate({ id: 1, text: "old thing", date: nowSec - 5 * 86400 }),
    msgUpdate({ id: 2, text: "new thing" }),
  ]);

  assert.strictEqual(h.sent.length, 2);
  assert.match(h.sent[0].text, /while I was down/i);
  assert.strictEqual(h.sent[1].text, "answer");
});

test("dispatches a registered command instead of running Claude", async () => {
  let got = null;
  const h = harness({
    commands: {
      ping: { description: "ping", handler: async (ctx) => { got = ctx.args; return "pong"; } },
    },
  });

  await drain(h.router, [msgUpdate({ text: "/ping loudly" })]);

  assert.strictEqual(got, "loudly");
  assert.strictEqual(h.sent[0].text, "pong");
});

test("passes the extra bag through to command handlers", async () => {
  let seenExtra = null;
  const router = createRouter({
    api: { sendMessage: async (p) => ({ message_id: 1 }) },
    ownerId: OWNER,
    commands: { probe: { description: "p", handler: async (ctx) => { seenExtra = ctx.extra; } } },
    runner: { run: async () => ({ text: "x", sessionId: "s" }) },
    queue: createQueue(),
    audit: { append: () => {} },
    sessions: createSessionsMemory(),
    log: () => {},
    now: () => NOW_MS,
    extra: { poller: { state: { mode: "long" } }, startedAt: NOW_MS },
  });

  await drain(router, [msgUpdate({ text: "/probe" })]);

  assert.strictEqual(seenExtra.poller.state.mode, "long");
  assert.strictEqual(seenExtra.startedAt, NOW_MS);
});

test("an unknown command says so rather than burning a Claude turn", async () => {
  const h = harness();
  await drain(h.router, [msgUpdate({ text: "/nonsense" })]);

  assert.ok(h.sent[0].text.includes("/nonsense"), "the reply should name the unknown command");
  assert.ok(h.sent[0].text.includes("/help"), "the reply should point at /help");
  assert.strictEqual(h.audited.length, 0);
});

test("sends a long reply as a document", async () => {
  const h = harness({ runResult: { text: "L".repeat(13000), sessionId: "s", costUsd: 0 } });
  await drain(h.router, [msgUpdate({ text: "long please" })]);

  assert.strictEqual(h.docs.length, 1);
  assert.strictEqual(h.sent.length, 0);
  assert.ok(h.docs[0].filename.endsWith(".md"));
});

test("falls back to plain markdown when Telegram rejects the HTML", async () => {
  const h = harness();
  let first = true;
  h.api.sendMessage = async (p) => {
    if (first && p.parse_mode === "HTML") {
      first = false;
      const err = new Error("Bad Request: cannot parse entities");
      err.status = 400;
      throw err;
    }
    h.sent.push(p);
    return { message_id: 1 };
  };

  await drain(h.router, [msgUpdate({ text: "hi" })]);

  assert.strictEqual(h.sent.length, 1);
  assert.strictEqual(h.sent[0].parse_mode, undefined);
  assert.strictEqual(h.sent[0].text, "answer");
});

test("reports a claude failure with the stderr tail, not a pointer to the log", async () => {
  const h = harness({ runError: new Error("claude exited 1: ENOENT spawn claude") });
  await drain(h.router, [msgUpdate({ text: "hi" })]);

  assert.match(h.sent[0].text, /ENOENT spawn claude/);
  assert.ok(!/bot\.log/i.test(h.sent[0].text), "must not fob Thamer off to a log file");
});

test("an aborted run reports being stopped, not an error", async () => {
  const h = harness({ runError: new AbortedError() });
  await drain(h.router, [msgUpdate({ text: "hi" })]);

  assert.match(h.sent[0].text, /stopped/i);
});

test("audits the turn with prompt, reply and notional cost", async () => {
  const h = harness();
  await drain(h.router, [msgUpdate({ text: "audit me" })]);

  assert.strictEqual(h.audited.length, 1);
  assert.strictEqual(h.audited[0].prompt, "audit me");
  assert.strictEqual(h.audited[0].costUsd, 0.05);
});

test("refuses work when the queue is full and says so", async () => {
  const sent = [];
  const router = createRouter({
    api: { sendMessage: async (p) => { sent.push(p); return { message_id: 1 }; } },
    ownerId: OWNER,
    commands: {},
    runner: { run: () => new Promise((r) => setTimeout(() => r({ text: "x", sessionId: "s" }), 30)) },
    queue: createQueue({ maxDepth: 1 }),
    audit: { append: () => {} },
    sessions: createSessionsMemory(),
    log: () => {},
    now: () => NOW_MS,
  });

  const first = router.handleUpdates([msgUpdate({ id: 1, text: "one" })]);
  await drain(router, [msgUpdate({ id: 2, text: "two" })]);
  await first;

  assert.ok(sent.some((p) => /queued/i.test(p.text)), "expected a queue-full notice");
});

test("abortCurrent reports false when nothing is running", () => {
  const h = harness();
  assert.strictEqual(h.router.abortCurrent(), false);
  assert.strictEqual(h.router.isRunning(), false);
});

test("ignores an update that is neither a message nor a callback", async () => {
  const h = harness();
  await drain(h.router, [{ update_id: 5, poll: {} }]);
  assert.strictEqual(h.sent.length, 0);
});

test("acknowledges a callback tap from the owner", async () => {
  let acked = null;
  const h = harness();
  h.api.answerCallbackQuery = async (p) => { acked = p; };

  await drain(h.router, [
    {
      update_id: 7,
      callback_query: {
        id: "cb1",
        from: { id: Number(OWNER) },
        data: "noop",
        message: { message_id: 3, chat: { id: Number(OWNER) }, date: nowSec },
      },
    },
  ]);

  assert.ok(acked, "the tap must be acknowledged so the client stops spinning");
  assert.strictEqual(acked.callback_query_id, "cb1");
});

test("drops a callback tap from a stranger", async () => {
  let acked = false;
  const h = harness();
  h.api.answerCallbackQuery = async () => { acked = true; };

  await drain(h.router, [
    {
      update_id: 8,
      callback_query: {
        id: "cb2",
        from: { id: 999 },
        data: "noop",
        message: { message_id: 3, chat: { id: 999 }, date: nowSec },
      },
    },
  ]);

  assert.strictEqual(acked, false);
});

// --- attachments (P5) --------------------------------------------------------

function mediaPort({ transcribe, speak, saveError } = {}) {
  const { pickAttachment } = require("../lib/media");
  const saved = [];
  const spoken = [];
  return {
    saved,
    spoken,
    port: {
      pick: pickAttachment,
      save: async (a) => {
        if (saveError) throw saveError;
        const rec = { path: `C:/media/${a.fileName}`, fileName: a.fileName };
        saved.push(rec);
        return rec;
      },
      transcribe,
      speak: speak ? async (chatId, text) => { spoken.push({ chatId, text }); } : undefined,
    },
  };
}

function harnessWithMedia(mediaOpts, { runResult } = {}) {
  const sent = [];
  const logs = [];
  const m = mediaPort(mediaOpts);
  const api = {
    sendMessage: async (p) => { sent.push(p); return { message_id: 1 }; },
    sendDocument: async () => ({ message_id: 2 }),
    answerCallbackQuery: async () => {},
    sendChatAction: async () => {},
  };
  const prompts = [];
  const router = createRouter({
    api,
    ownerId: OWNER,
    commands: {},
    runner: {
      run: async ({ prompt }) => {
        prompts.push(prompt);
        return runResult || { text: "seen it", sessionId: "s", costUsd: 0.01 };
      },
    },
    queue: createQueue(),
    audit: { append: () => {} },
    sessions: createSessionsMemory(),
    log: (x) => logs.push(x),
    now: () => NOW_MS,
    media: m.port,
  });
  return { router, sent, logs, prompts, media: m };
}

function photoUpdate({ caption } = {}) {
  const u = msgUpdate({ text: undefined });
  delete u.message.text;
  u.message.photo = [{ file_id: "small" }, { file_id: "big" }];
  if (caption) u.message.caption = caption;
  return u;
}

test("a photo is downloaded and handed to Claude as a path", async () => {
  const h = harnessWithMedia({});
  await drain(h.router, [photoUpdate({ caption: "what is this" })]);

  assert.strictEqual(h.media.saved.length, 1, "the photo must be downloaded");
  assert.match(h.prompts[0], /C:\/media\/photo\.jpg/, "the prompt must carry the file path");
  assert.match(h.prompts[0], /what is this/, "the caption must reach Claude");
  assert.strictEqual(h.sent[0].text, "seen it");
});

test("a photo with no caption still runs a turn and says so", async () => {
  const h = harnessWithMedia({});
  await drain(h.router, [photoUpdate()]);

  assert.match(h.prompts[0], /no caption/i);
});

test("a download failure is reported and no turn runs", async () => {
  const h = harnessWithMedia({ saveError: new Error("file is too big") });
  await drain(h.router, [photoUpdate()]);

  assert.strictEqual(h.prompts.length, 0, "must not run a turn on a failed download");
  assert.match(h.sent[0].text, /file is too big/);
});

test("a voice note is transcribed, echoed back, then answered", async () => {
  const h = harnessWithMedia({ transcribe: async () => "book the room" });
  const u = msgUpdate({ text: undefined });
  delete u.message.text;
  u.message.voice = { file_id: "v1", duration: 5 };

  await drain(h.router, [u]);

  assert.match(h.sent[0].text, /book the room/, "the transcript must be echoed so a mishearing is visible");
  assert.strictEqual(h.prompts[0], "book the room");
  assert.strictEqual(h.sent[1].text, "seen it");
});

test("a voice note with no transcription available says so rather than failing silently", async () => {
  const h = harnessWithMedia({});
  const u = msgUpdate({ text: undefined });
  delete u.message.text;
  u.message.voice = { file_id: "v1", duration: 5 };

  await drain(h.router, [u]);

  assert.match(h.sent[0].text, /can't hear voice/i);
  assert.strictEqual(h.prompts.length, 0);
});

test("speaking back happens only for voice input, and after the text reply", async () => {
  const h = harnessWithMedia({ transcribe: async () => "hello", speak: true });
  const u = msgUpdate({ text: undefined });
  delete u.message.text;
  u.message.voice = { file_id: "v1", duration: 3 };

  await drain(h.router, [u]);

  assert.strictEqual(h.media.spoken.length, 1);
  assert.strictEqual(h.media.spoken[0].text, "seen it");
});

test("a typed message never triggers a voice reply", async () => {
  const h = harnessWithMedia({ transcribe: async () => "x", speak: true });
  await drain(h.router, [msgUpdate({ text: "typed" })]);

  assert.strictEqual(h.media.spoken.length, 0);
});

test("a TTS failure still leaves the text reply delivered", async () => {
  const h = harnessWithMedia({ transcribe: async () => "hi" });
  h.media.port.speak = async () => { throw new Error("edge tts down"); };
  const u = msgUpdate({ text: undefined });
  delete u.message.text;
  u.message.voice = { file_id: "v1", duration: 3 };

  await drain(h.router, [u]);

  assert.ok(h.sent.some((p) => p.text === "seen it"), "the text answer must survive a TTS failure");
  assert.ok(h.logs.some((l) => /Voice reply failed/.test(l)));
});

test("without a media port, attachments are ignored exactly as before", async () => {
  const h = harness();
  await drain(h.router, [photoUpdate()]);

  assert.strictEqual(h.sent.length, 0);
});
