// lib/tts.js
// Voice replies. Uses msedge-tts -- free, no API key, and already Emily's voice
// on Discord, so she sounds like herself on both.
//
// Telegram's sendVoice wants OGG/Opus specifically; msedge-tts emits MP3. ffmpeg
// (already installed for the STT path) does the conversion in a pipe, so nothing
// intermediate is written to disk.
const { spawn: defaultSpawn } = require("child_process");

const ENGLISH_VOICE = "en-US-AriaNeural";
// He is Saudi and messages in Arabic often. An Arabic answer read by an English
// voice is unlistenable, so the voice follows the script of the text.
const ARABIC_VOICE = "ar-SA-ZariyahNeural";

// A voice note of a 3000-character answer is useless -- he cannot skim audio.
// The text reply always goes out in full alongside it, so truncating here loses
// nothing.
const MAX_SPOKEN_CHARS = 700;

const ARABIC_RANGE = /[؀-ۿ]/;

function pickVoice(text) {
  return ARABIC_RANGE.test(String(text)) ? ARABIC_VOICE : ENGLISH_VOICE;
}

// Strips what would be read aloud as noise: code fences, markdown markers, URLs.
function spokenText(raw, maxChars = MAX_SPOKEN_CHARS) {
  let s = String(raw || "");
  s = s.replace(/```[\s\S]*?```/g, " (code omitted) ");
  s = s.replace(/`([^`]+)`/g, "$1");
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1");
  s = s.replace(/https?:\/\/\S+/g, " a link ");
  s = s.replace(/[*_#>]/g, "");
  s = s.replace(/\s+/g, " ").trim();

  if (s.length <= maxChars) return s;
  // Cut on a sentence boundary where possible so it does not stop mid-word.
  const cut = s.slice(0, maxChars);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  const body = lastStop > maxChars * 0.5 ? cut.slice(0, lastStop + 1) : cut;
  return `${body} … the rest is in the text.`;
}

function mp3ToOggOpus(mp3Buffer, { spawnFn = defaultSpawn, ffmpegPath = "ffmpeg" } = {}) {
  return new Promise((resolve, reject) => {
    const ff = spawnFn(ffmpegPath, [
      "-hide_banner", "-loglevel", "error",
      "-i", "pipe:0",
      "-c:a", "libopus", "-b:a", "32k", "-ar", "48000", "-ac", "1",
      "-f", "ogg", "pipe:1",
    ]);

    const chunks = [];
    let stderr = "";
    ff.stdout.on("data", (d) => chunks.push(d));
    ff.stderr.on("data", (d) => { stderr += d; });
    ff.on("error", reject);
    ff.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`));
      resolve(Buffer.concat(chunks));
    });

    ff.stdin.on("error", () => {}); // ffmpeg can close early; not fatal here
    ff.stdin.end(mp3Buffer);
  });
}

async function synthesise(text, { ttsFactory, voice } = {}) {
  const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts");
  const tts = ttsFactory ? ttsFactory() : new MsEdgeTTS();

  await tts.setMetadata(voice || pickVoice(text), OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(text);

  const chunks = [];
  return new Promise((resolve, reject) => {
    audioStream.on("data", (d) => chunks.push(d));
    audioStream.on("end", () => resolve(Buffer.concat(chunks)));
    audioStream.on("error", reject);
  });
}

function createTts({ api, log = () => {}, spawnFn, ffmpegPath, synthesiseFn = synthesise }) {
  // Sends a voice note. Callers must already have sent the text reply -- this is
  // the extra, never the delivery mechanism.
  return async function speak(chatId, text) {
    const body = spokenText(text);
    if (!body) return;

    const mp3 = await synthesiseFn(body, {});
    const ogg = await mp3ToOggOpus(mp3, { spawnFn, ffmpegPath });

    await api.sendVoice({ chat_id: chatId, buffer: ogg, filename: "emily.ogg" });
    log(`Spoke ${body.length} chars as ${ogg.length} bytes of opus.`);
  };
}

module.exports = {
  createTts,
  spokenText,
  pickVoice,
  mp3ToOggOpus,
  synthesise,
  ENGLISH_VOICE,
  ARABIC_VOICE,
  MAX_SPOKEN_CHARS,
};
