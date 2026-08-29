// lib/stt.js
// Speech to text, entirely local. Telegram sends OGG/Opus; whisper.cpp wants
// 16 kHz mono PCM WAV, so ffmpeg converts between them.
//
// Local by choice, not convenience: sending his voice notes to a hosted API
// would put his messages -- vault contents, family, health -- on someone else's
// server. On the RTX 4070 large-v3-turbo transcribes a 30-second note in a few
// seconds, so there is no quality argument for going remote either.
//
// Verified 2026-08-19 against real audio in both languages. Arabic is good but
// not perfect ("الرياض" came back as "الرياضي"), which is why the router echoes
// the transcript back before acting on it.
const { spawn: defaultSpawn } = require("child_process");
const realFs = require("fs");
const path = require("path");
const os = require("os");

const DEFAULT_TIMEOUT_MS = 180000;

function oggToWav(inputPath, outputPath, { spawnFn = defaultSpawn, ffmpegPath = "ffmpeg" } = {}) {
  return new Promise((resolve, reject) => {
    const ff = spawnFn(ffmpegPath, [
      "-hide_banner", "-loglevel", "error",
      "-y",
      "-i", inputPath,
      // whisper.cpp requires exactly this: 16 kHz, mono, signed 16-bit PCM.
      "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
      outputPath,
    ]);

    let stderr = "";
    ff.stderr.on("data", (d) => { stderr += d; });
    ff.on("error", reject);
    ff.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`));
      resolve(outputPath);
    });
  });
}

// whisper-cli prints backend/loading chatter as well as the transcript. Anything
// that looks like a log line is dropped rather than read back to the owner as if he
// had said it.
function parseTranscript(stdout) {
  return String(stdout || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l)
    .filter((l) => !/^(whisper_|ggml_|load_backend|read_audio_data|main:|system_info|register_)/.test(l))
    .filter((l) => !/^\[.*\]$/.test(l))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function runWhisper(wavPath, { spawnFn = defaultSpawn, whisperPath, modelPath, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const child = spawnFn(whisperPath, [
      "-m", modelPath,
      "-f", wavPath,
      "-nt",        // no timestamps
      "-np",        // no progress prints
      "-l", "auto", // he switches between Arabic and English mid-conversation
    ]);

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(val);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(reject, new Error(`whisper timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });

    child.on("error", (err) => finish(reject, err));
    child.on("close", (code) => {
      if (code !== 0) return finish(reject, new Error(`whisper exited ${code}: ${stderr.slice(-400)}`));
      finish(resolve, parseTranscript(stdout));
    });
  });
}

function createStt({
  whisperPath,
  modelPath,
  ffmpegPath = "ffmpeg",
  spawnFn = defaultSpawn,
  fsImpl = realFs,
  tmpDir = os.tmpdir(),
  log = () => {},
}) {
  // Returns null when transcription is not installed, so the caller can say so
  // plainly instead of the bridge failing in a confusing way.
  if (!whisperPath || !modelPath || !fsImpl.existsSync(whisperPath) || !fsImpl.existsSync(modelPath)) {
    return null;
  }

  return async function transcribe(audioPath) {
    const wavPath = path.join(tmpDir, `emily-stt-${Date.now()}.wav`);

    try {
      await oggToWav(audioPath, wavPath, { spawnFn, ffmpegPath });
      const started = Date.now();
      const text = await runWhisper(wavPath, { spawnFn, whisperPath, modelPath });
      log(`Transcribed ${path.basename(audioPath)} in ${Date.now() - started}ms: ${text.slice(0, 80)}`);
      return text;
    } finally {
      try {
        fsImpl.unlinkSync(wavPath);
      } catch (err) {
        // Temp file already gone or locked; not worth failing a turn over.
      }
    }
  };
}

module.exports = { createStt, parseTranscript, oggToWav, runWhisper, DEFAULT_TIMEOUT_MS };
