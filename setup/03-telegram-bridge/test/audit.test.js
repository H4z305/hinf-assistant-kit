// test/audit.test.js
const test = require("node:test");
const assert = require("node:assert");
const { createAudit } = require("../lib/audit");

function memFs() {
  const files = new Map();
  return {
    files,
    appendFileSync(p, data) { files.set(p, (files.get(p) || "") + data); },
    readFileSync(p) {
      if (!files.has(p)) {
        const err = new Error("ENOENT");
        err.code = "ENOENT";
        throw err;
      }
      return files.get(p);
    },
  };
}

test("appends one JSON line per entry with an ISO timestamp", () => {
  const fsImpl = memFs();
  const audit = createAudit({
    filePath: "a.log",
    fsImpl,
    now: () => new Date("2026-08-17T09:00:00.000Z"),
  });

  audit.append({ kind: "in", text: "hello" });
  audit.append({ kind: "out", text: "hi" });

  const lines = fsImpl.files.get("a.log").trim().split("\n");
  assert.strictEqual(lines.length, 2);
  assert.deepStrictEqual(JSON.parse(lines[0]), {
    ts: "2026-08-17T09:00:00.000Z",
    kind: "in",
    text: "hello",
  });
});

test("returns zero cost when the log does not exist yet", () => {
  const audit = createAudit({ filePath: "missing.log", fsImpl: memFs() });
  assert.strictEqual(audit.totalCostToday(), 0);
});

test("sums costUsd for today only", () => {
  const fsImpl = memFs();
  fsImpl.appendFileSync(
    "a.log",
    [
      JSON.stringify({ ts: "2026-08-16T22:00:00.000Z", costUsd: 5 }),
      JSON.stringify({ ts: "2026-08-17T01:00:00.000Z", costUsd: 0.25 }),
      JSON.stringify({ ts: "2026-08-17T02:00:00.000Z", costUsd: 0.75 }),
    ].join("\n") + "\n"
  );
  const audit = createAudit({
    filePath: "a.log",
    fsImpl,
    now: () => new Date("2026-08-17T09:00:00.000Z"),
  });

  assert.strictEqual(audit.totalCostToday(), 1);
});

test("ignores malformed lines rather than throwing", () => {
  const fsImpl = memFs();
  fsImpl.appendFileSync(
    "a.log",
    "not json\n" + JSON.stringify({ ts: "2026-08-17T01:00:00.000Z", costUsd: 2 }) + "\n"
  );
  const audit = createAudit({
    filePath: "a.log",
    fsImpl,
    now: () => new Date("2026-08-17T09:00:00.000Z"),
  });

  assert.strictEqual(audit.totalCostToday(), 2);
});

test("treats entries with no costUsd as zero", () => {
  const fsImpl = memFs();
  fsImpl.appendFileSync("a.log", JSON.stringify({ ts: "2026-08-17T01:00:00.000Z" }) + "\n");
  const audit = createAudit({
    filePath: "a.log",
    fsImpl,
    now: () => new Date("2026-08-17T09:00:00.000Z"),
  });

  assert.strictEqual(audit.totalCostToday(), 0);
});

test("a failing write does not throw", () => {
  const fsImpl = memFs();
  fsImpl.appendFileSync = () => { throw new Error("EACCES"); };
  const audit = createAudit({ filePath: "a.log", fsImpl });

  assert.doesNotThrow(() => audit.append({ kind: "in" }));
});
