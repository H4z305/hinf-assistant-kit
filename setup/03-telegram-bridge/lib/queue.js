// lib/queue.js
// Serialises Claude runs. Without this, two Telegram messages arriving close
// together spawn two `claude` processes that both --resume the same session id,
// which corrupts the transcript. The depth cap means Thamer gets told the queue
// is full instead of watching messages vanish into a buffer.
const DEFAULT_MAX_DEPTH = 5;

function createQueue({ maxDepth = DEFAULT_MAX_DEPTH } = {}) {
  let chain = Promise.resolve();
  let depth = 0;

  return {
    get depth() { return depth; },
    get busy() { return depth > 0; },

    push(fn) {
      if (depth >= maxDepth) return { accepted: false, depth };

      depth += 1;
      const done = chain.then(() => fn());
      // The chain must never reject, or every later job would be skipped.
      chain = done.catch(() => {}).then(() => { depth -= 1; });

      return { accepted: true, depth, done };
    },

    // Resolves once everything queued so far has finished. Callers must NOT
    // await this inside the poll loop -- the whole point of the queue is that
    // polling continues during a run so /stop can still arrive. It exists for
    // graceful shutdown and for tests that need a deterministic drain point.
    whenIdle() {
      return chain;
    },
  };
}

module.exports = { createQueue, DEFAULT_MAX_DEPTH };
