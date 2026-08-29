// lib/commands/brief.js
// Runs the morning brief on demand instead of waiting for 08:03. Shares
// lib/brief.js with the Scheduled Task, so there is exactly one brief.
//
// This is the only command that costs a Claude turn, and it is a heavy one --
// calendar, Gmail, the vault and a seven-check week scan.
const path = require("path");
const { composeBrief } = require("../brief");

module.exports = {
  description: "Run the morning brief now. /brief --all shows suppressed flags.",

  async handler({ args, extra = {}, api, chatId, log = () => {} }) {
    const showAll = /(^|\s)--all(\s|$)/.test(String(args || ""));

    // The brief takes a while; say so rather than leaving the owner staring at nothing.
    // Progress only wraps ordinary turns, not command handlers.
    if (api && chatId) {
      try {
        await api.sendChatAction({ chat_id: chatId, action: "typing" });
      } catch (err) {
        // Cosmetic.
      }
    }

    const result = await composeBrief({
      runner: extra.runner,
      statePath: path.join(extra.dataDir || ".", "brief-state.json"),
      showAll,
      log,
    });

    return result.text || "The brief came back empty — nothing to send.";
  },
};
