// lib/commands/stop.js
// Aborts the run in flight. In v1 there was no escape at all -- a wrong turn
// meant waiting out the ten-minute timeout.
//
// This works because handleUpdates deliberately does not block on a run, so the
// poller is still free to receive this command while Claude is working.
module.exports = {
  description: "Abort the run in flight.",

  async handler(ctx) {
    return ctx.router.abortCurrent() ? "Stopped." : "Nothing running.";
  },
};
