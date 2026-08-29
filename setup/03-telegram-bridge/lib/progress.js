// lib/progress.js
// Makes a long run visible. Without this a three-minute answer looks exactly
// like a dead bot -- which is the single biggest reason v1 felt broken even on
// the days it worked.
const TYPING_INTERVAL_MS = 4000; // Telegram clears the indicator after ~5s
const MIN_EDIT_GAP_MS = 3000; // edits are rate-limited; a fast tool loop would 429

// Which input field names actually say something useful about a tool call,
// in the order we would rather show them.
const TARGET_FIELDS = [
  "file_path",
  "path",
  "command",
  "pattern",
  "query",
  "url",
  "prompt",
  "skill",
];

function shorten(value, max = 60) {
  const s = String(value).replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function describeToolUse(block) {
  const name = block.name || "a tool";
  const input = block.input || {};

  for (const field of TARGET_FIELDS) {
    if (input[field]) {
      let value = String(input[field]);
      // A full path is noise on a phone screen; the basename is the signal.
      if (field === "file_path" || field === "path") {
        const parts = value.split(/[\\/]/);
        value = parts[parts.length - 1] || value;
      }
      return `${name}: ${shorten(value)}`;
    }
  }
  return String(name);
}

// Pure. Returns text worth showing, or null when the event is noise.
function describeEvent(event) {
  if (!event || typeof event !== "object") return null;

  if (event.type === "system" && event.subtype === "init") return "Starting…";

  if (event.type === "assistant") {
    const content = event.message && event.message.content;
    if (!Array.isArray(content)) return null;
    for (const block of content) {
      if (block && block.type === "tool_use") return describeToolUse(block);
    }
    return null;
  }

  // Everything else -- hooks, thinking token counts, rate limit notices, the
  // final result -- is noise for a status line.
  return null;
}

function createProgress({
  api,
  log = () => {},
  typingIntervalMs = TYPING_INTERVAL_MS,
  minEditGapMs = MIN_EDIT_GAP_MS,
  now = () => Date.now(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  function start(chatId) {
    let statusMessageId = null;
    let lastEditAt = 0;
    let lastText = null;
    let done = false;

    function typing() {
      // Fire and forget. A failed typing action is cosmetic and must never
      // propagate into the run.
      Promise.resolve()
        .then(() => api.sendChatAction({ chat_id: chatId, action: "typing" }))
        .catch(() => {});
    }

    typing();
    const timer = setIntervalFn(typing, typingIntervalMs);

    async function update(event) {
      if (done) return;

      const text = describeEvent(event);
      if (!text || text === lastText) return;

      try {
        if (statusMessageId === null) {
          const sent = await api.sendMessage({ chat_id: chatId, text });
          statusMessageId = sent && sent.message_id;
          lastEditAt = now();
          lastText = text;
          return;
        }

        if (now() - lastEditAt < minEditGapMs) return;

        await api.editMessageText({
          chat_id: chatId,
          message_id: statusMessageId,
          text,
        });
        lastEditAt = now();
        lastText = text;
      } catch (err) {
        // Progress is decoration. It must never break a turn.
        log(`progress update failed: ${err.message}`);
      }
    }

    async function finish() {
      if (done) return;
      done = true;
      clearIntervalFn(timer);

      if (statusMessageId === null) return;
      const id = statusMessageId;
      statusMessageId = null;

      try {
        await api.deleteMessage({ chat_id: chatId, message_id: id });
      } catch (err) {
        // The real reply is about to arrive; a stale status line is survivable,
        // and throwing here would mask whatever actually went wrong.
        log(`could not delete status message: ${err.message}`);
      }
    }

    return { update, finish };
  }

  return { start };
}

module.exports = {
  createProgress,
  describeEvent,
  TYPING_INTERVAL_MS,
  MIN_EDIT_GAP_MS,
};
