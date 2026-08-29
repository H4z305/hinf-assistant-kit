// lib/threads.js
// Named parallel conversations. Implements the same three-method port as
// sessions-memory.js (currentSessionId, setCurrentSessionId, reset), so bot.js
// can swap createSessionsMemory() for createThreads() with no change to
// router.js -- the router only ever calls the port subset, never the
// thread-management methods below it.
//
// No idle expiry, unlike v1's session-manager.js. That 6h timeout was right for
// one anonymous session; it is wrong for a NAMED thread -- "career" should
// still be "career" next week. Threads persist until reset explicitly.
const realFs = require("fs");

const MAX_NAME_LENGTH = 24;
const DEFAULT_THREAD = "main";

// Pure. Lowercase, alnum-and-hyphen, capped short enough that "th:<name>" still
// fits Telegram's 64-byte callback_data limit with room to spare.
function slugify(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_NAME_LENGTH)
    .replace(/-+$/g, "");
}

function createThreads({ filePath, fsImpl = realFs, now = () => Date.now() }) {
  let state = load();

  function load() {
    try {
      if (fsImpl.existsSync(filePath)) {
        const parsed = JSON.parse(fsImpl.readFileSync(filePath, "utf8"));
        if (parsed && parsed.threads && parsed.threads[parsed.current]) {
          return parsed;
        }
      }
    } catch (err) {
      // Corrupt or unreadable -- fall through to a fresh default below.
    }
    return {
      current: DEFAULT_THREAD,
      threads: { [DEFAULT_THREAD]: { sessionId: null, lastActive: now() } },
    };
  }

  function save() {
    try {
      fsImpl.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf8");
    } catch (err) {
      // Persistence is best-effort; an in-memory thread switch must not throw
      // just because the disk write failed.
    }
  }

  function currentThread() {
    return state.threads[state.current];
  }

  return {
    currentSessionId: () => currentThread().sessionId,

    setCurrentSessionId: (id) => {
      currentThread().sessionId = id;
      currentThread().lastActive = now();
      save();
    },

    reset: () => {
      currentThread().sessionId = null;
      save();
    },

    create: (rawName) => {
      const name = slugify(rawName);
      if (!name) return { ok: false, reason: "that name has no usable characters" };
      if (state.threads[name]) return { ok: false, reason: `a thread named "${name}" already exists` };

      state.threads[name] = { sessionId: null, lastActive: now() };
      state.current = name;
      save();
      return { ok: true, name };
    },

    switchTo: (name) => {
      if (!state.threads[name]) return false;
      state.current = name;
      state.threads[name].lastActive = now();
      save();
      return true;
    },

    list: () => {
      return Object.keys(state.threads)
        .map((name) => ({
          name,
          isCurrent: name === state.current,
          hasSession: Boolean(state.threads[name].sessionId),
          lastActive: state.threads[name].lastActive,
        }))
        .sort((a, b) => b.lastActive - a.lastActive);
    },

    currentName: () => state.current,
  };
}

module.exports = { createThreads, slugify, MAX_NAME_LENGTH, DEFAULT_THREAD };
