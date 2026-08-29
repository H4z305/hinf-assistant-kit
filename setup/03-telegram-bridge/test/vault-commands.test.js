// test/vault-commands.test.js
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const logCmd = require("../lib/commands/log");
const hotCmd = require("../lib/commands/hot");
const { CAPTURE_RELATIVE, HOT_RELATIVE } = require("../lib/vault");

// These commands touch the real filesystem by design -- they are the two that
// deliberately bypass Claude entirely -- so they get a real temp vault.
function tempVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"));
  return dir;
}

test("/log writes a capture and confirms with a Riyadh timestamp", async () => {
  const vaultPath = tempVault();
  const reply = await logCmd.handler({ args: "buy the treadmill mat", extra: { vaultPath } });

  assert.match(reply, /^Logged at \d{2}:\d{2}\.$/);

  const body = fs.readFileSync(path.join(vaultPath, CAPTURE_RELATIVE), "utf8");
  assert.match(body, /buy the treadmill mat/);
});

test("/log refuses empty input without writing anything", async () => {
  const vaultPath = tempVault();
  const reply = await logCmd.handler({ args: "   ", extra: { vaultPath } });

  assert.match(reply, /nothing to log/i);
  assert.strictEqual(fs.existsSync(path.join(vaultPath, CAPTURE_RELATIVE)), false);
});

test("/log appends a second capture to the same file", async () => {
  const vaultPath = tempVault();
  await logCmd.handler({ args: "first", extra: { vaultPath } });
  await logCmd.handler({ args: "second", extra: { vaultPath } });

  const body = fs.readFileSync(path.join(vaultPath, CAPTURE_RELATIVE), "utf8");
  assert.match(body, /first/);
  assert.match(body, /second/);
});

test("/hot returns the latest dated entry", async () => {
  const vaultPath = tempVault();
  fs.mkdirSync(path.join(vaultPath, "wiki"), { recursive: true });
  fs.writeFileSync(
    path.join(vaultPath, HOT_RELATIVE),
    "---\ntype: meta\n---\n\n# Recent Context\n\n2026-08-16 (Career). newest\n\n2026-08-15 (Older). older\n",
    "utf8"
  );

  const reply = await hotCmd.handler({ extra: { vaultPath } });

  assert.match(reply, /2026-08-16/);
  assert.match(reply, /newest/);
  assert.ok(!reply.includes("2026-08-15"));
});

test("/hot reports plainly when the vault is missing rather than throwing", async () => {
  const reply = await hotCmd.handler({ extra: { vaultPath: path.join(os.tmpdir(), "definitely-not-a-vault") } });
  assert.match(reply, /couldn't read|not found/i);
});

test("both commands are registered with descriptions", () => {
  const { commands } = require("../lib/commands");
  assert.ok(commands.log && commands.log.description, "/log must be registered");
  assert.ok(commands.hot && commands.hot.description, "/hot must be registered");
});
