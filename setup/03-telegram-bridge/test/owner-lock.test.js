// test/owner-lock.test.js
const test = require("node:test");
const assert = require("node:assert");
const { isAuthorized } = require("../owner-lock");

test("returns false when ownerId is not configured", () => {
  assert.strictEqual(isAuthorized(12345, ""), false);
  assert.strictEqual(isAuthorized(12345, undefined), false);
});

test("returns true when senderId matches ownerId", () => {
  assert.strictEqual(isAuthorized(12345, "12345"), true);
  assert.strictEqual(isAuthorized("12345", "12345"), true);
});

test("returns false when senderId does not match ownerId", () => {
  assert.strictEqual(isAuthorized(999, "12345"), false);
});
