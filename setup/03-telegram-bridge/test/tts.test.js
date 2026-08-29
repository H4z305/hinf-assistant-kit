// test/tts.test.js
const test = require("node:test");
const assert = require("node:assert");
const { EventEmitter } = require("node:events");
const {
  createTts,
  spokenText,
  pickVoice,
  mp3ToOggOpus,
  ENGLISH_VOICE,
  ARABIC_VOICE,
  MAX_SPOKEN_CHARS,
} = require("../lib/tts");

// --- pickVoice ---------------------------------------------------------------

test("uses the Arabic voice for Arabic text", () => {
  assert.strictEqual(pickVoice("مرحبا يا ثامر"), ARABIC_VOICE);
});

test("uses the English voice for Latin text", () => {
  assert.strictEqual(pickVoice("book the room"), ENGLISH_VOICE);
});

test("treats mixed text containing Arabic as Arabic", () => {
  assert.strictEqual(pickVoice("the exhibition is at معرض الصحة"), ARABIC_VOICE);
});

// --- spokenText --------------------------------------------------------------

test("drops code fences rather than reading them aloud", () => {
  const out = spokenText("Here:\n```js\nconst x = 1;\n```\ndone");
  assert.ok(!out.includes("const x"), "code must not be read aloud");
  assert.match(out, /code omitted/);
});

test("reads link text, not the URL", () => {
  const out = spokenText("see [the docs](https://example.com/a/b)");
  assert.match(out, /the docs/);
  assert.ok(!out.includes("example.com"));
});

test("replaces a bare URL with a word", () => {
  const out = spokenText("go to https://example.com/x now");
  assert.ok(!out.includes("https"));
  assert.match(out, /a link/);
});

test("strips markdown emphasis markers", () => {
  assert.strictEqual(spokenText("**bold** and _italic_"), "bold and italic");
});

test("truncates a long answer and says where the rest is", () => {
  const long = "This is a sentence. ".repeat(200);
  const out = spokenText(long);

  assert.ok(out.length < long.length);
  assert.ok(out.length <= MAX_SPOKEN_CHARS + 60, `expected a cap, got ${out.length}`);
  assert.match(out, /the rest is in the text/);
});

test("does not truncate a short answer", () => {
  assert.strictEqual(spokenText("short answer"), "short answer");
});

test("returns empty for empty input", () => {
  assert.strictEqual(spokenText("   "), "");
  assert.strictEqual(spokenText(null), "");
});

// --- mp3ToOggOpus ------------------------------------------------------------

function fakeFfmpeg({ exitCode = 0, output = "OGGDATA", stderr = "" } = {}) {
  const calls = [];
  const spawnFn = (bin, args) => {
    calls.push({ bin, args });
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = new EventEmitter();
    proc.stdin.end = () => {
      setImmediate(() => {
        if (output) proc.stdout.emit("data", Buffer.from(output));
        if (stderr) proc.stderr.emit("data", stderr);
        proc.emit("close", exitCode);
      });
    };
    return proc;
  };
  spawnFn.calls = calls;
  return spawnFn;
}

test("asks ffmpeg for ogg opus, which is what sendVoice requires", async () => {
  const spawnFn = fakeFfmpeg();
  await mp3ToOggOpus(Buffer.from("MP3"), { spawnFn });

  const args = spawnFn.calls[0].args.join(" ");
  assert.match(args, /libopus/);
  assert.match(args, /-f ogg/);
});

test("returns the converted bytes", async () => {
  const out = await mp3ToOggOpus(Buffer.from("MP3"), { spawnFn: fakeFfmpeg({ output: "OPUSBYTES" }) });
  assert.strictEqual(out.toString(), "OPUSBYTES");
});

test("rejects when ffmpeg fails, including its stderr", async () => {
  await assert.rejects(
    () => mp3ToOggOpus(Buffer.from("MP3"), { spawnFn: fakeFfmpeg({ exitCode: 1, output: "", stderr: "bad input" }) }),
    /ffmpeg exited 1[\s\S]*bad input/
  );
});

// --- createTts ---------------------------------------------------------------

test("sends a voice note built from the synthesised audio", async () => {
  const sent = [];
  const speak = createTts({
    api: { sendVoice: async (p) => { sent.push(p); } },
    spawnFn: fakeFfmpeg({ output: "OPUS" }),
    synthesiseFn: async () => Buffer.from("MP3"),
  });

  await speak(42, "hello there");

  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].chat_id, 42);
  assert.strictEqual(sent[0].buffer.toString(), "OPUS");
  assert.match(sent[0].filename, /\.ogg$/);
});

test("sends nothing at all for an empty answer", async () => {
  const sent = [];
  const speak = createTts({
    api: { sendVoice: async (p) => { sent.push(p); } },
    spawnFn: fakeFfmpeg(),
    synthesiseFn: async () => Buffer.from("MP3"),
  });

  await speak(42, "   ");

  assert.strictEqual(sent.length, 0);
});
