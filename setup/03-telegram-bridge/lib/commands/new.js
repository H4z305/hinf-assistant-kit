// lib/commands/new.js
// Opens a fresh named thread. `sessions` here is structurally the full Threads
// object from lib/threads.js -- the router doesn't know or care that it is more
// than the three-method port it itself relies on.
module.exports = {
  description: "Start a new thread. /new <topic>",

  async handler({ args, sessions }) {
    const requested = String(args || "").trim();
    // No topic given: fall back to an auto name. Threads.create rejects an
    // empty slug, so this can't just be create(""); try increasing numeric
    // suffixes until one is free.
    const name = requested || nextAutoName(sessions);

    const result = sessions.create(name);
    if (!result.ok) return `Couldn't start that thread: ${result.reason}.`;

    return `New thread: ${result.name}. Previous threads are still there — /threads to switch back.`;
  },
};

function nextAutoName(sessions) {
  const taken = new Set(sessions.list().map((t) => t.name));
  let n = 1;
  while (taken.has(`thread-${n}`)) n += 1;
  return `thread-${n}`;
}
