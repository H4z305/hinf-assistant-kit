// scripts/set-commands.js
// One-shot migration of the bot's / menu.
//
// As of 2026-08-17 getMyCommands returned 77 entries, every one a leftover from
// a previous bot framework -- /restart described as "Restart <old bot>", 
// several with Chinese descriptions. The bridge implemented one
// of them. This replaces the lot.
//
// Telegram's command menu is not one list -- it is resolved per SCOPE, and a more
// specific scope always wins over `default`: chat > all_private_chats /
// all_group_chats / all_chat_administrators > default. The first run of this
// script only ever set `default`, so it looked correct to getMyCommands() (which
// also defaults to that scope) while the owner's phone kept showing an
// `all_private_chats` menu -- 30 more leftover commands (/resume,
// /sessions, /branch, /undo, /agents...) that a plain default-scope check never
// surfaces. `all_group_chats` carried a near-complete copy of the original 77.
// Both are now cleared explicitly, every run, so a stale scope can never again
// hide behind a clean-looking default.
//
// Run deliberately, not on boot: the menu is bot-global state, so a half-built
// registry during development would clobber the live menu.
const path = require("path");

const DISPLAY_ORDER = ["new", "threads", "stop", "brief", "log", "hot", "status", "help"];
const MAX_DESCRIPTION = 256;

// Scopes this bot has no use for -- it is owner-locked to one private chat and
// will never serve a group -- but which Telegram still lets carry a stale menu
// independently of `default`. Cleared unconditionally so none of them can shadow
// the real one again.
const SCOPES_TO_CLEAR = ["all_private_chats", "all_group_chats", "all_chat_administrators"];

function buildCommandList(commands) {
  const named = Object.keys(commands)
    .filter((name) => name !== "__callback__")
    .filter((name) => commands[name] && commands[name].description);

  const ranked = named.slice().sort((a, b) => {
    const ia = DISPLAY_ORDER.indexOf(a);
    const ib = DISPLAY_ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });

  return ranked.map((name) => ({
    command: name,
    description: String(commands[name].description).slice(0, MAX_DESCRIPTION),
  }));
}

async function main() {
  const { loadConfig } = require(path.join(__dirname, "..", "config"));
  const { createTelegramApi } = require(path.join(__dirname, "..", "lib", "telegram-api"));
  const { commands } = require(path.join(__dirname, "..", "lib", "commands"));

  const cfg = loadConfig();
  const api = createTelegramApi({ token: cfg.token });

  const before = await api.callApi("getMyCommands");
  console.log(`Currently registered (default scope): ${before.length} commands.`);

  const list = buildCommandList(commands);
  if (list.length === 0) {
    console.error("Refusing to run: the registry is empty, which would leave no menu at all.");
    process.exit(1);
  }

  for (const scopeType of SCOPES_TO_CLEAR) {
    const scoped = await api.callApi("getMyCommands", { scope: { type: scopeType } });
    if (scoped.length > 0) {
      console.log(`Clearing stale scope "${scopeType}": ${scoped.length} commands.`);
      await api.deleteMyCommands({ scope: { type: scopeType } });
    }
  }

  await api.setMyCommands({ commands: list });
  await api.setMyDescription({
    description: "A personal Claude Code assistant. Owner-locked -- nobody else can use this bot.",
  });
  await api.setMyShortDescription({ short_description: "Personal assistant." });

  const after = await api.callApi("getMyCommands");
  console.log(`Now registered (default scope): ${after.length} commands.`);
  for (const c of after) console.log(`  /${c.command} -- ${c.description}`);

  // Verify every scope that could shadow default is actually empty now --
  // trusting the calls above is exactly the mistake that caused this bug.
  let allClear = true;
  for (const scopeType of SCOPES_TO_CLEAR) {
    const stillThere = await api.callApi("getMyCommands", { scope: { type: scopeType } });
    if (stillThere.length > 0) {
      allClear = false;
      console.error(`WARNING: scope "${scopeType}" still has ${stillThere.length} commands after clearing.`);
    }
  }
  if (allClear) console.log("Verified: no stale scope can shadow the menu above.");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stack || err);
    process.exit(1);
  });
}

module.exports = { buildCommandList, DISPLAY_ORDER, MAX_DESCRIPTION, SCOPES_TO_CLEAR };
