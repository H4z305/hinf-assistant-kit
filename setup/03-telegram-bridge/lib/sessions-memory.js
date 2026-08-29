// lib/sessions-memory.js
// The P1 session port: one conversation, held in memory.
//
// This exists so the router can be finished and shipped before named threads
// land. lib/threads.js implements the same three methods, so swapping it in
// requires no change to the router.
function createSessionsMemory() {
  let sessionId = null;
  return {
    currentSessionId: () => sessionId,
    setCurrentSessionId: (id) => { sessionId = id; },
    reset: () => { sessionId = null; },
  };
}

module.exports = { createSessionsMemory };
