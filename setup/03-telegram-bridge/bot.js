// bot.js
// Wiring only. No logic lives in this file.
const fs = require("fs");
const path = require("path");

const { loadConfig } = require("./config");
const { createLogger } = require("./lib/log");
const { createTelegramApi } = require("./lib/telegram-api");
const { createPoller } = require("./lib/poller");
const { createRouter } = require("./lib/router");
const { createQueue } = require("./lib/queue");
const { createAudit } = require("./lib/audit");
const { createThreads } = require("./lib/threads");
const { createClaudeRunner } = require("./lib/claude-runner");
const { createProgress } = require("./lib/progress");
const { createHeartbeat } = require("./lib/heartbeat");
const { createHealth } = require("./lib/health");
const { pickAttachment, saveAttachment, pruneMedia } = require("./lib/media");
const { createTts } = require("./lib/tts");
const { createStt } = require("./lib/stt");
const { commands } = require("./lib/commands");

const PID_FILE = path.join(__dirname, "bot.pid");
const HEALTH_FILE = path.join(__dirname, "bot.health.json");
const log = createLogger({ filePath: path.join(__dirname, "bot.log") });

process.on("uncaughtException", (err) => {
  log(`FATAL uncaughtException: ${err.stack || err}`);
  process.exit(1); // non-zero so the watchdog restarts us
});
process.on("unhandledRejection", (err) => {
  log(`FATAL unhandledRejection: ${err && err.stack ? err.stack : err}`);
});

// Refuse to start a second instance. Two pollers on one token get 409 Conflict
// from Telegram and neither works.
function assertSingleInstance() {
  if (!fs.existsSync(PID_FILE)) return;

  const existingPid = Number(fs.readFileSync(PID_FILE, "utf8").trim());
  let alive = false;
  try {
    // Signal 0 sends nothing; it is the standard Node liveness probe and throws
    // if no process holds that pid.
    process.kill(existingPid, 0);
    alive = true;
  } catch (err) {
    alive = false;
  }

  if (alive) {
    log(`FATAL: already running (pid ${existingPid}) -- run stop.bat first if that is stale.`);
    process.exit(1);
  }
  log(`Stale bot.pid found (pid ${existingPid}); that process is gone, continuing.`);
}

function main() {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (err) {
    log(`FATAL: ${err.message}`);
    process.exit(1);
  }

  assertSingleInstance();
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  fs.writeFileSync(PID_FILE, String(process.pid));

  if (!cfg.ownerId) {
    log("OWNER_TELEGRAM_ID is not set -- every message will be rejected. Message the bot once, then copy the logged sender id into .env and restart.");
  }

  const api = createTelegramApi({ token: cfg.token });
  const audit = createAudit({ filePath: path.join(cfg.dataDir, "audit.log") });
  const runner = createClaudeRunner({
    claudeExecutable: cfg.claudeExecutable,
    cwd: cfg.claudeCwd,
    permissionMode: cfg.permissionMode,
  });
  const threads = createThreads({ filePath: path.join(cfg.dataDir, "threads.json") });

  // Constructed before the router so /status can read live poller.state through
  // the extra bag. onUpdates is filled in once the router exists below --
  // getUpdates never fires before poller.run() is called, so this ordering is
  // safe despite the apparent circularity.
  const poller = createPoller({
    api,
    onUpdates: (updates) => router.handleUpdates(updates),
    log,
  });

  const mediaDir = path.join(cfg.dataDir, "media");
  const pruned = pruneMedia({ mediaDir });
  if (pruned) log(`Pruned ${pruned} media file(s) older than 7 days.`);

  // Photos and documents need nothing external: the file is written to disk and
  // Claude opens it with its own Read tool.
  const media = {
    pick: pickAttachment,
    save: (attachment) => saveAttachment({ api, attachment, mediaDir }),
    // Only fires when he actually sent a voice note, and only after the text
    // reply has already gone out.
    speak: createTts({ api, log }),
    // null when whisper.cpp or the model is missing, which the router reports
    // plainly rather than swallowing the voice note.
    transcribe: createStt({
      whisperPath: cfg.whisperPath,
      modelPath: cfg.whisperModelPath,
      log,
    }),
  };
  log(`Voice input: ${media.transcribe ? "ready (local whisper.cpp)" : "unavailable -- whisper.cpp not installed"}.`);

  const startedAt = Date.now();
  const router = createRouter({
    api,
    ownerId: cfg.ownerId,
    commands,
    runner,
    queue: createQueue(),
    audit,
    sessions: threads,
    progress: createProgress({ api, log }),
    media,
    extra: {
      poller,
      startedAt,
      vaultPath: cfg.vaultPath,
      // /brief composes its own Claude turn rather than going through runTurn,
      // so it needs the runner directly. dataDir is where brief-state.json lives.
      runner,
      dataDir: cfg.dataDir,
    },
    log,
  });

  // Alerts over sendMessage -- the path that kept working for a week while
  // inbound was dead. See lib/heartbeat.js.
  const heartbeat = createHeartbeat({ api, ownerId: cfg.ownerId, poller, log });
  heartbeat.start();

  // Same facts as heartbeat.js, published to disk instead of Telegram, so
  // emily-ops can distinguish "process alive" from "inbound alive".
  const health = createHealth({ healthFile: HEALTH_FILE, poller, startedAt });
  health.start();

  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal} received, stopping.`);
    heartbeat.stop();
    health.stop();
    poller.stop();
    try {
      fs.unlinkSync(PID_FILE);
    } catch (err) {
      // Already gone; nothing to do.
    }
    process.exit(0);
  }
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  log(`Emily Telegram Bridge started. cwd=${cfg.claudeCwd} pid=${process.pid}`);

  poller.run().then(() => {
    log(`Poller stopped (reason: ${poller.state.stopReason || "requested"}).`);
    // A conflict stop is fatal and must exit non-zero so the watchdog notices.
    process.exit(poller.state.stopReason === "conflict" ? 1 : 0);
  });
}

main();
