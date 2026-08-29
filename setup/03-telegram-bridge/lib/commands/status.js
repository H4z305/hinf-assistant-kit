// lib/commands/status.js
// Reads extra.poller / extra.startedAt -- the grab-bag router.js merges into
// every command handler's ctx, added specifically so this command could exist
// without widening every other handler's signature.
function formatUptime(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatSilence(lastSuccessAt, now) {
  if (lastSuccessAt === null || lastSuccessAt === undefined) return "no successful poll yet";
  const s = Math.floor((now - lastSuccessAt) / 1000);
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
}

module.exports = {
  description: "Bridge health, current thread, today's usage.",

  async handler({ sessions, audit, extra = {} }) {
    const now = Date.now();
    const poller = extra.poller || { state: {} };
    const mode = poller.state.mode || "unknown";
    const lastSuccess = formatSilence(poller.state.lastSuccessAt, now);
    const uptime = formatUptime(extra.startedAt ? now - extra.startedAt : NaN);

    // Notional, not a charge -- the owner is on subscription auth, not per-token
    // API billing. Must always read this way; a bare "$" reads as money spent.
    const cost = audit && typeof audit.totalCostToday === "function" ? audit.totalCostToday() : 0;

    return [
      `Thread: ${sessions.currentName()}`,
      `Polling: ${mode} (last inbound ${lastSuccess})`,
      `Uptime: ${uptime}`,
      `Today's usage: $${cost.toFixed(2)} (notional API-equivalent, not a charge)`,
    ].join("\n");
  },
};
