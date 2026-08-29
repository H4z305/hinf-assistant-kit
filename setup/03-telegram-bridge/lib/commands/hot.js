// lib/commands/hot.js
// The most recent dated entry from the vault's hot cache. Read straight off
// disk -- no Claude turn, so it is instant and free.
const { readHotEntry } = require("../vault");

module.exports = {
  description: "What I'm currently holding — latest from hot.md.",

  async handler({ extra = {} }) {
    return readHotEntry({ vaultPath: extra.vaultPath });
  },
};
