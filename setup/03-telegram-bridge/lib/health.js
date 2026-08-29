// lib/health.js
// Publishes poller state to disk so a supervisor can see it.
//
// heartbeat.js already computes whether inbound is alive, but it reports over
// sendMessage -- useful on the phone, invisible to anything else. This writes
// the same facts where emily-ops can read them without touching the bot.
//
// Cadence and payload shape deliberately mirror emily-discord-voice/bot.js so
// both bots publish the same kind of thing.
const realFs = require("fs");

const INTERVAL_MS = 60 * 1000;

function iso(ms) {
  return ms === null || ms === undefined ? null : new Date(ms).toISOString();
}

function createHealth({
  healthFile,
  poller,
  startedAt,
  fsImpl = realFs,
  now = () => Date.now(),
  intervalMs = INTERVAL_MS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  let timer = null;

  function write() {
    const s = poller.state;
    const payload = {
      pid: process.pid,
      startedAt: iso(startedAt),
      ts: iso(now()),
      poller: {
        lastSuccessAt: iso(s.lastSuccessAt),
        mode: s.mode,
        consecutiveFailures: s.consecutiveFailures,
        running: s.running,
      },
    };
    // Errors ignored on purpose: a failed health write must never take the
    // bridge down. A missing file already means "unknown" to the reader.
    fsImpl.writeFile(healthFile, JSON.stringify(payload, null, 2), () => {});
  }

  function start() {
    if (timer !== null) return;
    write(); // don't leave the supervisor blind for the first minute
    timer = setIntervalFn(write, intervalMs);
    if (timer && typeof timer.unref === "function") timer.unref();
  }

  function stop() {
    if (timer !== null) {
      clearIntervalFn(timer);
      timer = null;
    }
    // A stale health file outlives the process and makes a dead bot look
    // merely quiet. Remove it on the way out.
    try {
      fsImpl.unlinkSync(healthFile);
    } catch (err) {
      // Already gone.
    }
  }

  return { write, start, stop };
}

module.exports = { createHealth, INTERVAL_MS };
