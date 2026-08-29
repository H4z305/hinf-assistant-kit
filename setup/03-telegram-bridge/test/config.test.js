// test/config.test.js
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { loadConfig, normalisePermissionMode } = require("../config");

// A minimal env that satisfies the required keys. CLAUDE_CWD points at this
// test directory purely because it is a real, always-present path.
const BASE = { TELEGRAM_BOT_TOKEN: "t", CLAUDE_CWD: __dirname };

test("throws when the token is missing", () => {
  assert.throws(() => loadConfig({ CLAUDE_CWD: __dirname }), /TELEGRAM_BOT_TOKEN/);
});

test("throws when CLAUDE_CWD is missing — there is no hidden default", () => {
  assert.throws(() => loadConfig({ TELEGRAM_BOT_TOKEN: "t" }), /CLAUDE_CWD/);
});

test("treats a blank CLAUDE_CWD as unset", () => {
  assert.throws(() => loadConfig({ TELEGRAM_BOT_TOKEN: "t", CLAUDE_CWD: "" }), /CLAUDE_CWD/);
});

test("claudeCwd comes straight from CLAUDE_CWD", () => {
  const cfg = loadConfig({ ...BASE, CLAUDE_CWD: "C:/my-assistant" });
  assert.strictEqual(cfg.claudeCwd, "C:/my-assistant");
});

test("vaultPath derives from claudeCwd when VAULT_PATH is unset", () => {
  const cfg = loadConfig({ ...BASE, CLAUDE_CWD: "C:/my-assistant" });
  assert.strictEqual(cfg.vaultPath, path.join("C:/my-assistant", "second-brain"));
});

test("VAULT_PATH overrides the derived vault path", () => {
  const cfg = loadConfig({ ...BASE, VAULT_PATH: "D:/notes" });
  assert.strictEqual(cfg.vaultPath, "D:/notes");
});

test("permissionMode defaults to the safe 'acceptEdits'", () => {
  const cfg = loadConfig({ ...BASE });
  assert.strictEqual(cfg.permissionMode, "acceptEdits");
});

test("permissionMode honours a valid override", () => {
  const cfg = loadConfig({ ...BASE, PERMISSION_MODE: "bypassPermissions" });
  assert.strictEqual(cfg.permissionMode, "bypassPermissions");
});

test("an unknown PERMISSION_MODE is rejected loudly", () => {
  assert.throws(() => loadConfig({ ...BASE, PERMISSION_MODE: "yolo" }), /PERMISSION_MODE/);
  assert.throws(() => normalisePermissionMode("nope"), /PERMISSION_MODE/);
});

test("accepts either brief prompt env name, preferring the unsuffixed one", () => {
  const both = loadConfig({
    ...BASE,
    PROACTIVE_CHECKIN_PROMPT: "chosen",
    PROACTIVE_CHECKIN_PROMPT_TEMPLATE: "legacy",
  });
  assert.strictEqual(both.briefPrompt, "chosen");

  const legacyOnly = loadConfig({ ...BASE, PROACTIVE_CHECKIN_PROMPT_TEMPLATE: "legacy" });
  assert.strictEqual(legacyOnly.briefPrompt, "legacy");
});

test("defaults the claude executable to bare 'claude'", () => {
  const cfg = loadConfig({ ...BASE, CLAUDE_EXECUTABLE_PATH: "" });
  assert.strictEqual(cfg.claudeExecutable, "claude");
});

test("the returned config is frozen", () => {
  const cfg = loadConfig({ ...BASE });
  assert.strictEqual(Object.isFrozen(cfg), true);
});
