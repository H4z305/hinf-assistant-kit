// test/sessions-memory.test.js
const test = require("node:test");
const assert = require("node:assert");
const { createSessionsMemory } = require("../lib/sessions-memory");

test("starts with no session", () => {
  assert.strictEqual(createSessionsMemory().currentSessionId(), null);
});

test("remembers the session id it is given", () => {
  const s = createSessionsMemory();
  s.setCurrentSessionId("abc");
  assert.strictEqual(s.currentSessionId(), "abc");
});

test("reset clears the session", () => {
  const s = createSessionsMemory();
  s.setCurrentSessionId("abc");
  s.reset();
  assert.strictEqual(s.currentSessionId(), null);
});
