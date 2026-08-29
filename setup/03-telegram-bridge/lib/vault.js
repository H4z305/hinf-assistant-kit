// lib/vault.js
// Direct reads and appends against the second brain, with no Claude turn at all.
// That is the whole point of /hot and /log: capturing a stray thought used to
// cost a full CLI invocation and forty seconds, and it should cost nothing.
const realFs = require("fs");
const path = require("path");

const HOT_RELATIVE = path.join("wiki", "hot.md");

// The curated log.md says "Append-only. Newest entries at the top. Never edit
// past entries." and its sections are substantial prose under `## DATE — Title`.
// Raw one-line captures do not belong there and would degrade it, so /log writes
// to the vault's own (previously empty) inbox folder instead. Emily can fold
// captures into log.md properly later.
const CAPTURE_RELATIVE = path.join("wiki", "projects", "inbox", "Capture.md");

const MAX_HOT_CHARS = 3500;

const CAPTURE_HEADER = `---
type: meta
title: "Capture"
tags:
  - meta
  - inbox
---

# Capture

Quick captures from Telegram via /log. Append-only, oldest first.
Fold anything worth keeping into the proper page, then strike it here.
`;

// the owner may be in a non-UTC timezone. A capture stamped in UTC reads three hours wrong, which
// makes the timestamp worse than useless for reconstructing his day.
function riyadhParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    // Intl can render midnight as "24" in some locales; normalise it.
    time: `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`,
  };
}

function readHotEntry({ vaultPath, fsImpl = realFs, maxChars = MAX_HOT_CHARS }) {
  const hotPath = path.join(vaultPath, HOT_RELATIVE);

  let raw;
  try {
    raw = String(fsImpl.readFileSync(hotPath, "utf8"));
  } catch (err) {
    return `Couldn't read hot.md — not found at ${hotPath}.`;
  }

  const lines = raw.split("\n");
  const dated = /^\d{4}-\d{2}-\d{2}/;

  const startIdx = lines.findIndex((l) => dated.test(l));
  if (startIdx === -1) return "hot.md has no dated entry to show.";

  // Run to the line before the next dated entry, so we return exactly one.
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    if (dated.test(lines[i])) {
      endIdx = i;
      break;
    }
  }

  const entry = lines.slice(startIdx, endIdx).join("\n").trim();

  if (entry.length > maxChars) {
    return entry.slice(0, maxChars) + "\n\n…(truncated — open hot.md for the rest)";
  }
  return entry;
}

function appendCapture({ vaultPath, fsImpl = realFs, text, now = () => new Date() }) {
  const body = String(text || "").replace(/\s+/g, " ").trim();
  if (!body) return { ok: false, reason: "nothing to capture" };

  const capturePath = path.join(vaultPath, CAPTURE_RELATIVE);
  const { date, time } = riyadhParts(now());

  let existing = "";
  try {
    existing = String(fsImpl.readFileSync(capturePath, "utf8"));
  } catch (err) {
    // First use: create the folder and seed the header.
    try {
      fsImpl.mkdirSync(path.dirname(capturePath), { recursive: true });
    } catch (mkErr) {
      // Directory already exists, or cannot be made -- the write below will say.
    }
    existing = "";
  }

  let toAppend = "";
  if (!existing) toAppend += CAPTURE_HEADER;
  // Only start a new day heading when today is not already the latest one.
  if (!existing.includes(`## ${date}`)) toAppend += `\n## ${date}\n\n`;
  toAppend += `- ${time} — ${body}\n`;

  try {
    if (!existing) fsImpl.writeFileSync(capturePath, toAppend, "utf8");
    else fsImpl.appendFileSync(capturePath, toAppend, "utf8");
  } catch (err) {
    return { ok: false, reason: err.message };
  }

  return { ok: true, path: capturePath, date, time };
}

module.exports = {
  readHotEntry,
  appendCapture,
  riyadhParts,
  HOT_RELATIVE,
  CAPTURE_RELATIVE,
  MAX_HOT_CHARS,
};
