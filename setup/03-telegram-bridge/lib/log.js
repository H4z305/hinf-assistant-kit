// lib/log.js
const realFs = require("fs");

function createLogger({
  filePath,
  fsImpl = realFs,
  now = () => new Date(),
  consoleImpl = console,
}) {
  return function log(message) {
    const line = `[${now().toISOString()}] ${message}`;
    consoleImpl.log(line);
    try {
      fsImpl.appendFileSync(filePath, line + "\n", "utf8");
    } catch (err) {
      // Logging must never be the thing that kills the bridge.
    }
  };
}

module.exports = { createLogger };
