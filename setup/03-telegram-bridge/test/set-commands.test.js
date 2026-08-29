// test/set-commands.test.js
const test = require("node:test");
const assert = require("node:assert");
const { buildCommandList, DISPLAY_ORDER, SCOPES_TO_CLEAR } = require("../scripts/set-commands");

test("converts the registry into Telegram's shape", () => {
  const list = buildCommandList({
    help: { description: "This list." },
    status: { description: "Bridge health." },
  });

  assert.deepStrictEqual(list, [
    { command: "status", description: "Bridge health." },
    { command: "help", description: "This list." },
  ]);
});

test("skips the callback pseudo-command", () => {
  const list = buildCommandList({
    __callback__: { handler: () => {} },
    help: { description: "This list." },
  });

  assert.deepStrictEqual(list.map((c) => c.command), ["help"]);
});

test("skips entries with no description", () => {
  const list = buildCommandList({ secret: { handler: () => {} }, help: { description: "d" } });
  assert.deepStrictEqual(list.map((c) => c.command), ["help"]);
});

test("honours the display order and appends unknown names alphabetically", () => {
  const registry = {};
  for (const name of ["help", "zeta", "new", "alpha", "stop"]) {
    registry[name] = { description: name };
  }

  assert.deepStrictEqual(
    buildCommandList(registry).map((c) => c.command),
    ["new", "stop", "help", "alpha", "zeta"]
  );
});

test("the display order covers exactly the eight specified commands", () => {
  assert.deepStrictEqual(DISPLAY_ORDER, [
    "new", "threads", "stop", "brief", "log", "hot", "status", "help",
  ]);
});

test("truncates a description past Telegram's 256 character limit", () => {
  const list = buildCommandList({ help: { description: "x".repeat(300) } });
  assert.strictEqual(list[0].description.length, 256);
});

// Regression guard for the actual bug: a stale all_private_chats/all_group_chats
// scope shadowed the default-scope menu this script sets, so the owner's phone kept
// showing an OpenClaw command list even after "Now registered: 5 commands"
// printed correctly. getMyCommands() with no scope argument -- what the script
// checked -- also defaults to `default`, so the check looked clean while the
// scope that actually renders on his phone was untouched.
test("clears every scope that can shadow the default menu, not just default itself", () => {
  assert.deepStrictEqual(
    SCOPES_TO_CLEAR.slice().sort(),
    ["all_chat_administrators", "all_group_chats", "all_private_chats"]
  );
});
