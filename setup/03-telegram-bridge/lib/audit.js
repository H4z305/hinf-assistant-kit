// lib/audit.js
// Append-only record of every turn. Spec section 10: bypassPermissions means a
// Telegram message is an unsandboxed shell, so every prompt and reply must be
// reconstructable after the fact.
const realFs = require("fs");

function createAudit({ filePath, fsImpl = realFs, now = () => new Date() }) {
  function append(entry) {
    const line = JSON.stringify({ ts: now().toISOString(), ...entry }) + "\n";
    try {
      fsImpl.appendFileSync(filePath, line, "utf8");
    } catch (err) {
      // Auditing must never take the bot down. A lost line is bad; a crashed
      // bridge is worse.
    }
  }

  function readToday() {
    let raw;
    try {
      raw = fsImpl.readFileSync(filePath, "utf8");
    } catch (err) {
      return [];
    }

    const today = now().toISOString().slice(0, 10);
    const entries = [];
    for (const line of String(raw).split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (typeof parsed.ts === "string" && parsed.ts.slice(0, 10) === today) {
          entries.push(parsed);
        }
      } catch (err) {
        // Malformed line: skip it rather than failing the whole read.
      }
    }
    return entries;
  }

  function totalCostToday() {
    return readToday().reduce((sum, e) => sum + (Number(e.costUsd) || 0), 0);
  }

  return { append, readToday, totalCostToday };
}

module.exports = { createAudit };
