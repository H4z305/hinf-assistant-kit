// lib/commands/help.js
// Generated from the registry, never hand-written.
//
// A hand-maintained help text is exactly how this bot ended up advertising 85
// commands while implementing one. If it is not registered, it does not appear
// here -- and it cannot appear here without being registered.
module.exports = {
  description: "Show what I can do.",

  async handler(ctx) {
    // Required lazily: lib/commands/index.js requires this module, so a
    // top-level require would be circular and yield an empty object.
    const registry = (ctx && ctx.commands) || require("./index").commands;

    const lines = Object.keys(registry)
      .filter((name) => name !== "__callback__")
      .filter((name) => registry[name] && registry[name].description)
      .sort()
      .map((name) => `- /${name} — ${registry[name].description}`);

    return ["Commands:", ...lines, "", "Anything else, just talk to me."].join("\n");
  },
};
