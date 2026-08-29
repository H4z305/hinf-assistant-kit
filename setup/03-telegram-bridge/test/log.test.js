// test/log.test.js
const test = require("node:test");
const assert = require("node:assert");
const { createLogger } = require("../lib/log");

function fakes() {
  const written = [];
  const printed = [];
  return {
    written,
    printed,
    fsImpl: { appendFileSync: (p, data) => written.push({ p, data }) },
    consoleImpl: { log: (line) => printed.push(line) },
  };
}

test("writes an ISO-prefixed line to the file and the console", () => {
  const f = fakes();
  const log = createLogger({
    filePath: "bot.log",
    fsImpl: f.fsImpl,
    consoleImpl: f.consoleImpl,
    now: () => new Date("2026-08-17T10:20:30.000Z"),
  });

  log("started");

  assert.strictEqual(f.written[0].p, "bot.log");
  assert.strictEqual(f.written[0].data, "[2026-08-17T10:20:30.000Z] started\n");
  assert.strictEqual(f.printed[0], "[2026-08-17T10:20:30.000Z] started");
});

test("a failing file write does not throw", () => {
  const f = fakes();
  f.fsImpl.appendFileSync = () => { throw new Error("EACCES"); };
  const log = createLogger({ filePath: "bot.log", fsImpl: f.fsImpl, consoleImpl: f.consoleImpl });

  assert.doesNotThrow(() => log("still fine"));
  assert.strictEqual(f.printed.length, 1);
});
