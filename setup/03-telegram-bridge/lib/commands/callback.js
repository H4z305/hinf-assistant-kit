// lib/commands/callback.js
// Registered as commands.__callback__ -- the router's catch-all for inline
// button taps. Not a slash command, so it has no `description` (set-commands.js
// already skips entries with none).
module.exports = {
  async handler({ data, sessions }) {
    if (typeof data !== "string" || !data.startsWith("th:")) return undefined;

    const name = data.slice("th:".length);
    const switched = sessions.switchTo(name);
    if (!switched) return `That thread no longer exists: ${name}.`;

    return `Switched to: ${name}.`;
  },
};
