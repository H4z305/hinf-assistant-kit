// lib/heartbeat.js
// Tells the owner when inbound has gone silent.
//
// The whole design rests on one fact from the 2026-08-10 outage: outbound
// sendMessage worked perfectly for a week while inbound getUpdates was dead.
// Every signal he could actually see -- the morning brief, arriving on time --
// came from the half that still worked. So the alert goes out over sendMessage.
//
// A monitor that shares a failure mode with the thing it monitors is decoration.
const CHECK_INTERVAL_MS = 60 * 1000;
const SILENCE_THRESHOLD_MS = 10 * 60 * 1000;
const MIN_NOTIFY_GAP_MS = 60 * 60 * 1000;

function createHeartbeat({
  api,
  ownerId,
  poller,
  log = () => {},
  now = () => Date.now(),
  checkIntervalMs = CHECK_INTERVAL_MS,
  silenceThresholdMs = SILENCE_THRESHOLD_MS,
  minNotifyGapMs = MIN_NOTIFY_GAP_MS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  let timer = null;
  let lastNotifiedAt = null;

  async function check() {
    if (!ownerId) return;

    const { lastSuccessAt, mode } = poller.state;

    // Null means no poll has ever succeeded -- we are still starting up.
    // Treating that as silence would fire an alert on every boot.
    if (lastSuccessAt === null || lastSuccessAt === undefined) return;

    const silentFor = now() - lastSuccessAt;
    if (silentFor < silenceThresholdMs) {
      lastNotifiedAt = null; // healthy again; the next outage alerts immediately
      return;
    }

    if (lastNotifiedAt !== null && now() - lastNotifiedAt < minNotifyGapMs) return;

    const minutes = Math.floor(silentFor / 60000);
    lastNotifiedAt = now();

    try {
      await api.sendMessage({
        chat_id: ownerId,
        text:
          `I have not received anything from Telegram in ${minutes} minutes ` +
          `(polling mode: ${mode}). Outbound still works, since you are reading this. ` +
          `If you did send something, inbound is broken -- check bot.log.`,
      });
      log(`Heartbeat alert sent: inbound silent for ${minutes}m, mode=${mode}.`);
    } catch (err) {
      // If this fails too, both directions are down and there is nothing left
      // to tell him with. Log and carry on.
      log(`Heartbeat alert failed to send: ${err.message}`);
    }
  }

  function start() {
    if (timer !== null) return;
    timer = setIntervalFn(() => { check(); }, checkIntervalMs);
  }

  function stop() {
    if (timer === null) return;
    clearIntervalFn(timer);
    timer = null;
  }

  return { start, stop, check };
}

module.exports = {
  createHeartbeat,
  CHECK_INTERVAL_MS,
  SILENCE_THRESHOLD_MS,
  MIN_NOTIFY_GAP_MS,
};
