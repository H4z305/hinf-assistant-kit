// lib/commands/log.js
// Instant capture. No Claude turn, so it costs nothing and answers immediately --
// which is the point. Capturing a stray thought used to mean a full CLI
// invocation and forty seconds of waiting.
const { appendCapture } = require("../vault");

module.exports = {
  description: "Capture a thought into the vault instantly. /log <text>",

  async handler({ args, extra = {} }) {
    const text = String(args || "").trim();
    if (!text) return "Nothing to log. Use /log <text>.";

    const result = appendCapture({ vaultPath: extra.vaultPath, text });
    if (!result.ok) return `Couldn't write that: ${result.reason}.`;

    return `Logged at ${result.time}.`;
  },
};
