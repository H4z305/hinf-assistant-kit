// proactive-checkin.js
// The 08:03 Scheduled Task entry point. Thin by design: lib/brief.js owns the
// brief itself, shared with the /brief command so the two can never drift.
const fs = require("fs");
const path = require("path");

const { loadConfig } = require("./config");
const { createLogger } = require("./lib/log");
const { createTelegramApi } = require("./lib/telegram-api");
const { createClaudeRunner } = require("./lib/claude-runner");
const { composeBrief } = require("./lib/brief");

const log = createLogger({ filePath: path.join(__dirname, "proactive.log") });

async function main() {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (err) {
    log(`FATAL: ${err.message}`);
    process.exit(1);
  }

  if (!cfg.ownerId) {
    log("FATAL: OWNER_TELEGRAM_ID missing from .env -- refusing to run.");
    process.exit(1);
  }

  fs.mkdirSync(cfg.dataDir, { recursive: true });

  const api = createTelegramApi({ token: cfg.token });
  const runner = createClaudeRunner({
    claudeExecutable: cfg.claudeExecutable,
    cwd: cfg.claudeCwd,
    permissionMode: cfg.permissionMode,
  });

  try {
    const result = await composeBrief({
      runner,
      statePath: path.join(cfg.dataDir, "brief-state.json"),
      log,
    });

    log(`Brief composed (notional $${Number(result.costUsd ?? 0).toFixed(4)}): ${result.text.slice(0, 200)}`);

    if (!result.text) {
      log("Empty brief, staying quiet.");
      return;
    }

    await api.sendMessage({ chat_id: cfg.ownerId, text: result.text });
    log("Sent morning brief.");
  } catch (err) {
    log(`Morning brief failed: ${err.stack || err}`);
    process.exitCode = 1;
  }
}

main();
