// lib/commands/threads.js
// Lists threads with tap-to-switch buttons. Sends its own message (so it can
// attach reply_markup) and returns nothing -- the router treats a falsy return
// from a command handler as "already handled."
const MAX_BUTTONS_PER_ROW = 2;

module.exports = {
  description: "List your threads, with buttons to switch.",

  async handler({ chatId, api, sessions }) {
    const threads = sessions.list();

    const lines = threads.map((t) => {
      const marker = t.isCurrent ? "→ " : "  ";
      const hint = t.hasSession ? "" : " (empty)";
      return `${marker}${t.name}${hint}`;
    });

    const buttons = threads.map((t) => ({
      text: t.isCurrent ? `• ${t.name}` : t.name,
      callback_data: `th:${t.name}`,
    }));

    const rows = [];
    for (let i = 0; i < buttons.length; i += MAX_BUTTONS_PER_ROW) {
      rows.push(buttons.slice(i, i + MAX_BUTTONS_PER_ROW));
    }

    await api.sendMessage({
      chat_id: chatId,
      text: ["Threads:", ...lines].join("\n"),
      reply_markup: { inline_keyboard: rows },
    });
  },
};
