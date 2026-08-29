// lib/commands/index.js
// The command registry. Every entry is { description, handler }.
//
// `description` is what Telegram shows in the / menu -- see scripts/set-commands.js,
// which builds that menu from this object so the two can never drift apart.
// `handler(ctx)` may return a markdown string to send, or nothing.
//
// The reserved key `__callback__` is not a slash command; it handles inline
// button taps and has no `description`.
const commands = {
  new: require("./new"),
  threads: require("./threads"),
  stop: require("./stop"),
  brief: require("./brief"),
  log: require("./log"),
  hot: require("./hot"),
  status: require("./status"),
  help: require("./help"),
  __callback__: require("./callback"),
};

module.exports = { commands };
