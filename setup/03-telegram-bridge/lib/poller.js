// lib/poller.js
// The fix for the 2026-08-10 outage.
//
// Diagnosis: short request/response calls to api.telegram.org succeed through
// Thamer's network; the long-held getUpdates connection is reaped at ~10s, which
// produced `TypeError: fetch failed` every 11 seconds for hours. So: try long
// polling, and when it keeps failing, stop trying and poll short instead.
const POLLER_DEFAULTS = {
  longPollTimeoutS: 25,
  shortPollIntervalMs: 2000,
  failuresBeforeDegrade: 3,
  cleanPollsBeforeRecover: 10,
  maxBackoffMs: 30000,
  allowedUpdates: ["message", "callback_query"],
};

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createPoller({
  api,
  onUpdates,
  log,
  sleep = defaultSleep,
  now = () => Date.now(),
  options = {},
}) {
  const cfg = { ...POLLER_DEFAULTS, ...options };

  const state = {
    mode: "long",
    offset: 0,
    consecutiveFailures: 0,
    cleanPolls: 0,
    backoffMs: 0,
    lastSuccessAt: null,
    running: false,
    stopReason: null,
  };

  async function pollOnce() {
    const updates = await api.getUpdates({
      offset: state.offset,
      timeout: state.mode === "long" ? cfg.longPollTimeoutS : 0,
      allowed_updates: cfg.allowedUpdates,
    });

    state.lastSuccessAt = now();
    state.consecutiveFailures = 0;
    state.backoffMs = 0;

    if (updates.length) {
      // Advance BEFORE handling. If a handler throws on a malformed update and
      // the offset had not moved, the loop would refetch it forever.
      state.offset = updates[updates.length - 1].update_id + 1;
      try {
        await onUpdates(updates);
      } catch (err) {
        log(`onUpdates threw, batch dropped: ${err.stack || err}`);
      }
    }

    if (state.mode === "short") {
      state.cleanPolls += 1;
      if (state.cleanPolls >= cfg.cleanPollsBeforeRecover) {
        state.mode = "long";
        state.cleanPolls = 0;
        log("Poller recovered: long polling restored.");
      }
      await sleep(cfg.shortPollIntervalMs);
    }
  }

  function handleFailure(err) {
    if (err && err.status === 409) {
      state.running = false;
      state.stopReason = "conflict";
      log("FATAL: 409 Conflict — another process is polling this token. Stopping rather than fighting for it.");
      return;
    }

    if (err && err.retryAfter) {
      state.backoffMs = err.retryAfter * 1000;
      return;
    }

    state.consecutiveFailures += 1;

    if (state.mode === "long" && state.consecutiveFailures >= cfg.failuresBeforeDegrade) {
      state.mode = "short";
      state.cleanPolls = 0;
      log(
        `Poller degraded to short polling after ${state.consecutiveFailures} long-poll failures: ${err && err.message}`
      );
    } else if (state.consecutiveFailures === 1) {
      // Once only. v1 logged this line every 11 seconds and buried the signal.
      log(`Poll failed (retrying quietly): ${err && err.message}`);
    }

    state.backoffMs = Math.min(
      state.backoffMs ? state.backoffMs * 2 : 1000,
      cfg.maxBackoffMs
    );
  }

  async function run() {
    state.running = true;
    while (state.running) {
      try {
        await pollOnce();
      } catch (err) {
        handleFailure(err);
        if (state.running && state.backoffMs) await sleep(state.backoffMs);
      }
    }
  }

  return { run, stop: () => { state.running = false; }, state };
}

module.exports = { createPoller, POLLER_DEFAULTS };
