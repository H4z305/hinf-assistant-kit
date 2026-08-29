// test/stt.test.js
const test = require("node:test");
const assert = require("node:assert");
const { EventEmitter } = require("node:events");
const { createStt, parseTranscript, runWhisper } = require("../lib/stt");

// --- parseTranscript ---------------------------------------------------------

test("keeps the transcript and drops whisper's loading chatter", () => {
  const raw = [
    "ggml_cuda_init: found 1 CUDA devices (Total VRAM: 12281 MiB):",
    "load_backend: loaded CUDA backend from ggml-cuda.dll",
    "read_audio_data: reading audio data from 'x.wav' ...",
    "",
    " Book the cheapest room in Riyadh for 27 October.",
  ].join("\n");

  assert.strictEqual(parseTranscript(raw), "Book the cheapest room in Riyadh for 27 October.");
});

test("keeps Arabic transcripts intact", () => {
  const raw = "load_backend: loaded CUDA backend\n\n احجز لي غرفة رخيصة في الرياض";
  assert.strictEqual(parseTranscript(raw), "احجز لي غرفة رخيصة في الرياض");
});

test("joins a multi-line transcript into one string", () => {
  assert.strictEqual(parseTranscript("first part\nsecond part"), "first part second part");
});

test("drops bracketed markers like [BLANK_AUDIO]", () => {
  assert.strictEqual(parseTranscript("[BLANK_AUDIO]"), "");
});

test("returns empty for empty input", () => {
  assert.strictEqual(parseTranscript(""), "");
  assert.strictEqual(parseTranscript(null), "");
});

// --- runWhisper --------------------------------------------------------------

function fakeProc({ exitCode = 0, stdout = "", stderr = "", hang = false } = {}) {
  const calls = [];
  const spawnFn = (bin, args) => {
    calls.push({ bin, args });
    const p = new EventEmitter();
    p.stdout = new EventEmitter();
    p.stderr = new EventEmitter();
    p.stdout.setEncoding = () => {};
    p.stderr.setEncoding = () => {};
    p.killed = false;
    p.kill = () => { p.killed = true; };
    if (!hang) {
      setImmediate(() => {
        if (stdout) p.stdout.emit("data", stdout);
        if (stderr) p.stderr.emit("data", stderr);
        p.emit("close", exitCode);
      });
    }
    spawnFn.lastProc = p;
    return p;
  };
  spawnFn.calls = calls;
  return spawnFn;
}

test("asks whisper for auto language detection, since he switches mid-conversation", async () => {
  const spawnFn = fakeProc({ stdout: " hello" });
  await runWhisper("a.wav", { spawnFn, whisperPath: "w.exe", modelPath: "m.bin" });

  const args = spawnFn.calls[0].args.join(" ");
  assert.match(args, /-l auto/);
  assert.match(args, /-nt/);
});

test("rejects with stderr when whisper exits non-zero", async () => {
  const spawnFn = fakeProc({ exitCode: 1, stderr: "model not found" });
  await assert.rejects(
    () => runWhisper("a.wav", { spawnFn, whisperPath: "w.exe", modelPath: "m.bin" }),
    /whisper exited 1[\s\S]*model not found/
  );
});

test("times out and kills a hung whisper rather than blocking forever", async () => {
  const spawnFn = fakeProc({ hang: true });
  await assert.rejects(
    () => runWhisper("a.wav", { spawnFn, whisperPath: "w.exe", modelPath: "m.bin", timeoutMs: 10 }),
    /timed out after 10ms/
  );
  assert.strictEqual(spawnFn.lastProc.killed, true);
});

// --- createStt ---------------------------------------------------------------

test("returns null when whisper is not installed, so the caller can say so", () => {
  const fsImpl = { existsSync: () => false };
  assert.strictEqual(createStt({ whisperPath: "w.exe", modelPath: "m.bin", fsImpl }), null);
});

test("returns null when paths are not configured at all", () => {
  assert.strictEqual(createStt({ fsImpl: { existsSync: () => true } }), null);
});

test("returns a function when both binary and model are present", () => {
  const fsImpl = { existsSync: () => true, unlinkSync: () => {} };
  assert.strictEqual(typeof createStt({ whisperPath: "w.exe", modelPath: "m.bin", fsImpl }), "function");
});

test("converts then transcribes, and cleans up the temp wav either way", async () => {
  const unlinked = [];
  const fsImpl = { existsSync: () => true, unlinkSync: (p) => unlinked.push(p) };
  // First spawn is ffmpeg, second is whisper.
  let call = 0;
  const spawnFn = (bin, args) => {
    call += 1;
    const p = new EventEmitter();
    p.stdout = new EventEmitter();
    p.stderr = new EventEmitter();
    p.stdout.setEncoding = () => {};
    p.stderr.setEncoding = () => {};
    p.kill = () => {};
    setImmediate(() => {
      if (call === 2) p.stdout.emit("data", " transcribed words");
      p.emit("close", 0);
    });
    return p;
  };

  const transcribe = createStt({ whisperPath: "w.exe", modelPath: "m.bin", fsImpl, spawnFn, tmpDir: "T" });
  const out = await transcribe("voice.oga");

  assert.strictEqual(out, "transcribed words");
  assert.strictEqual(unlinked.length, 1, "the temp wav must be removed");
});

test("still cleans up the temp wav when transcription fails", async () => {
  const unlinked = [];
  const fsImpl = { existsSync: () => true, unlinkSync: (p) => unlinked.push(p) };
  let call = 0;
  const spawnFn = () => {
    call += 1;
    const p = new EventEmitter();
    p.stdout = new EventEmitter();
    p.stderr = new EventEmitter();
    p.stdout.setEncoding = () => {};
    p.stderr.setEncoding = () => {};
    p.kill = () => {};
    setImmediate(() => {
      if (call === 2) p.stderr.emit("data", "boom");
      p.emit("close", call === 2 ? 1 : 0);
    });
    return p;
  };

  const transcribe = createStt({ whisperPath: "w.exe", modelPath: "m.bin", fsImpl, spawnFn, tmpDir: "T" });

  await assert.rejects(() => transcribe("voice.oga"));
  assert.strictEqual(unlinked.length, 1, "cleanup must run on the failure path too");
});
