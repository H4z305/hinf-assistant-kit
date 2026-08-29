// watchdog.js
// Restarts the bridge if it is not running. That is the whole job.
//
// HARD CONSTRAINT, the owner's own words: "do not let it interrupt my pc play."
// A task that fires every five minutes is exactly the thing that steals focus
// mid-game, so every decision here is about staying invisible:
//   - launched through wscript.exe + watchdog-hidden.vbs, so no console window
//     is ever created, not even a flash
//   - the restarted bridge is spawned detached, stdio ignored, windowsHide true
//   - no output, no network, no notification -- anything worth saying goes to
//     Telegram, which is his phone, not his desktop
//   - runs at BelowNormal priority so it can never contend with a game
//
// The check itself is: read bot.pid, probe it, exit. Sub-100ms.
const realFs = require("fs");
const path = require("path");
const { spawn: defaultSpawn } = require("child_process");

const BOT_ENTRY = path.join(__dirname, "bot.js");
const PAUSE_FILE = path.join(__dirname, "bot.paused");

function checkAndRestart({
  pidFile,
  pauseFile = PAUSE_FILE,
  fsImpl = realFs,
  killFn = process.kill,
  spawnFn = defaultSpawn,
  log = () => {},
  botEntry = BOT_ENTRY,
  cwd = __dirname,
}) {
  // emily-ops sets this flag while it deliberately stops the bot. Without the
  // check, Stop in the dashboard loses a race with this watchdog and the bot
  // comes back within the task interval, making the button look broken.
  if (fsImpl.existsSync(pauseFile)) return "paused";

  let pid = null;

  if (fsImpl.existsSync(pidFile)) {
    try {
      const raw = String(fsImpl.readFileSync(pidFile, "utf8")).trim();
      const parsed = Number(raw);
      if (Number.isInteger(parsed) && parsed > 0) pid = parsed;
    } catch (err) {
      // Unreadable pid file is the same as no pid file.
    }
  }

  if (pid !== null) {
    try {
      // Signal 0 sends nothing. It is the standard liveness probe and throws
      // only if no process holds that pid.
      killFn(pid, 0);
      return "alive";
    } catch (err) {
      // Dead. Fall through and restart.
    }
  }

  const outcome = pid === null ? "started" : "restarted";

  try {
    const child = spawnFn(process.execPath, [botEntry], {
      cwd,
      detached: true, // must outlive this short-lived watchdog process
      stdio: "ignore", // holding a console handle is how a window appears
      windowsHide: true, // belt and braces: never flash a window
    });
    if (child && typeof child.unref === "function") child.unref();
    log(`Bridge ${outcome}.`);
    return outcome;
  } catch (err) {
    log(`Failed to start the bridge: ${err.message}`);
    return "failed";
  }
}

if (require.main === module) {
  const { createLogger } = require("./lib/log");
  const log = createLogger({
    filePath: path.join(__dirname, "watchdog.log"),
    // No console output. This runs every five minutes and must be silent.
    consoleImpl: { log: () => {} },
  });

  const result = checkAndRestart({ pidFile: path.join(__dirname, "bot.pid"), log });
  // Only a state change is worth a log line; "alive" every five minutes forever
  // is precisely the log spam that hid the real failure in v1.
  if (result !== "alive") log(`watchdog result: ${result}`);
  process.exit(0);
}

module.exports = { checkAndRestart, BOT_ENTRY };
