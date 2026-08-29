// lib/media.js
// Photos, documents and voice notes arriving from Telegram.
//
// Photos and documents need no external dependency at all: Telegram hands over
// a file, we write it to disk, and Claude reads it with its own Read tool. The
// path is the whole integration.
const realFs = require("fs");
const path = require("path");

const MEDIA_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// A filename from Telegram is attacker-controlled data. Even though this bot is
// owner-locked, a name must never be able to escape the media directory.
function safeName(raw) {
  const base = path.basename(String(raw || ""));
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+/, "")
    .replace(/-+/g, "-")
    .slice(0, 60);

  return cleaned || "attachment";
}

function pickAttachment(msg) {
  if (!msg || typeof msg !== "object") return null;
  const caption = msg.caption ? String(msg.caption) : "";

  if (Array.isArray(msg.photo) && msg.photo.length) {
    // Telegram sends photo sizes ascending; the last is the largest.
    const largest = msg.photo[msg.photo.length - 1];
    return { kind: "photo", fileId: largest.file_id, fileName: "photo.jpg", caption };
  }

  if (msg.document) {
    return {
      kind: "document",
      fileId: msg.document.file_id,
      fileName: safeName(msg.document.file_name || "document"),
      mimeType: msg.document.mime_type,
      caption,
    };
  }

  if (msg.voice) {
    return {
      kind: "voice",
      fileId: msg.voice.file_id,
      fileName: "voice.oga",
      durationSec: msg.voice.duration,
      caption,
    };
  }

  if (msg.audio) {
    return {
      kind: "voice",
      fileId: msg.audio.file_id,
      fileName: safeName(msg.audio.file_name || "audio.mp3"),
      durationSec: msg.audio.duration,
      caption,
    };
  }

  return null;
}

async function saveAttachment({ api, attachment, mediaDir, fsImpl = realFs, now = () => new Date() }) {
  // Download first. If this throws, nothing has been written.
  const { buffer } = await api.downloadFile(attachment.fileId);

  try {
    fsImpl.mkdirSync(mediaDir, { recursive: true });
  } catch (err) {
    // Already there, or unwritable -- the write below will report it.
  }

  // Timestamp prefix: two photos are both "photo.jpg", and the second must not
  // silently overwrite the first.
  const stamp = now().toISOString().replace(/[:.]/g, "-");
  const fileName = `${stamp}-${safeName(attachment.fileName)}`;
  // Resolve once and use the same absolute path for both the write and the
  // return value -- Claude is given this path and must be able to open exactly
  // what was written, whatever the process cwd happens to be.
  const fullPath = path.resolve(path.join(mediaDir, fileName));

  fsImpl.writeFileSync(fullPath, buffer);

  return { path: fullPath, fileName, bytes: buffer.length };
}

function pruneMedia({ mediaDir, fsImpl = realFs, now = () => Date.now(), maxAgeMs = MEDIA_MAX_AGE_MS }) {
  let entries;
  try {
    entries = fsImpl.readdirSync(mediaDir);
  } catch (err) {
    return 0; // nothing there yet
  }

  const cutoff = now() - maxAgeMs;
  let removed = 0;

  for (const entry of entries) {
    const full = path.join(mediaDir, entry);
    try {
      if (fsImpl.statSync(full).mtimeMs < cutoff) {
        fsImpl.unlinkSync(full);
        removed += 1;
      }
    } catch (err) {
      // Vanished under us, or locked. Not worth failing a turn over.
    }
  }

  return removed;
}

module.exports = {
  pickAttachment,
  saveAttachment,
  pruneMedia,
  safeName,
  MEDIA_MAX_AGE_MS,
};
