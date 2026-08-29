// test/vault.test.js
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { readHotEntry, appendCapture, riyadhParts, CAPTURE_RELATIVE } = require("../lib/vault");

function memFs() {
  const files = new Map();
  return {
    files,
    existsSync: (p) => files.has(p),
    readFileSync: (p) => {
      if (!files.has(p)) { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; }
      return files.get(p);
    },
    appendFileSync: (p, data) => { files.set(p, (files.get(p) || "") + data); },
    writeFileSync: (p, data) => { files.set(p, data); },
    mkdirSync: () => {},
  };
}

const HOT = `---
type: meta
title: "Hot Cache"
updated: 2026-08-16T00:00:00
---

# Recent Context

## Last Updated
2026-08-16 (Career, **CAREER ROADMAP WRITTEN**). The newest entry body.
More of the newest entry.

2026-08-15 (Options Decision Brief, **SHIPPED**). An older entry that must not appear.

2026-08-14 (Discord bot). Older still.
`;

// --- readHotEntry ------------------------------------------------------------

test("returns only the most recent dated entry", () => {
  const fsImpl = memFs();
  const hotPath = path.join("VAULT", "wiki", "hot.md");
  fsImpl.writeFileSync(hotPath, HOT);

  const out = readHotEntry({ vaultPath: "VAULT", fsImpl });

  assert.match(out, /2026-08-16/);
  assert.match(out, /CAREER ROADMAP WRITTEN/);
  assert.match(out, /More of the newest entry/);
  assert.ok(!out.includes("2026-08-15"), "must not bleed into the previous entry");
  assert.ok(!out.includes("Options Decision Brief"), "must not bleed into the previous entry");
});

test("skips the frontmatter and headers when finding the first entry", () => {
  const fsImpl = memFs();
  fsImpl.writeFileSync(path.join("VAULT", "wiki", "hot.md"), HOT);

  const out = readHotEntry({ vaultPath: "VAULT", fsImpl });

  assert.ok(!out.includes("type: meta"), "frontmatter must not appear");
  assert.ok(!out.includes("# Recent Context"), "headers must not appear");
});

test("truncates a very long entry and says so", () => {
  const fsImpl = memFs();
  const huge = "---\n---\n\n2026-08-16 (Big). " + "x".repeat(9000) + "\n";
  fsImpl.writeFileSync(path.join("VAULT", "wiki", "hot.md"), huge);

  const out = readHotEntry({ vaultPath: "VAULT", fsImpl, maxChars: 3500 });

  assert.ok(out.length <= 3600, `expected truncation, got ${out.length} chars`);
  assert.match(out, /truncated/i);
});

test("reports plainly when hot.md is missing rather than throwing", () => {
  const out = readHotEntry({ vaultPath: "VAULT", fsImpl: memFs() });
  assert.match(out, /couldn't read|not found/i);
});

test("reports plainly when hot.md has no dated entry", () => {
  const fsImpl = memFs();
  fsImpl.writeFileSync(path.join("VAULT", "wiki", "hot.md"), "---\n---\n\n# Recent Context\n\nnothing dated here\n");

  const out = readHotEntry({ vaultPath: "VAULT", fsImpl });
  assert.match(out, /no dated entry/i);
});

// --- riyadhParts -------------------------------------------------------------

test("formats timestamps in Riyadh time, not UTC", () => {
  // 2026-08-18T22:30:00Z is 01:30 the NEXT day in Riyadh (UTC+3).
  const p = riyadhParts(new Date("2026-08-18T22:30:00.000Z"));
  assert.strictEqual(p.date, "2026-08-19");
  assert.strictEqual(p.time, "01:30");
});

test("formats a morning timestamp correctly", () => {
  const p = riyadhParts(new Date("2026-08-18T05:03:00.000Z"));
  assert.strictEqual(p.date, "2026-08-18");
  assert.strictEqual(p.time, "08:03");
});

// --- appendCapture -----------------------------------------------------------

test("creates the capture file with frontmatter on first use", () => {
  const fsImpl = memFs();
  const capturePath = path.join("VAULT", CAPTURE_RELATIVE);

  appendCapture({ vaultPath: "VAULT", fsImpl, text: "first thought", now: () => new Date("2026-08-18T09:00:00.000Z") });

  const body = fsImpl.files.get(capturePath);
  assert.match(body, /^---/, "expected frontmatter");
  assert.match(body, /## 2026-08-18/);
  assert.match(body, /- 12:00 — first thought/);
});

test("appends under the same day heading without repeating it", () => {
  const fsImpl = memFs();
  const capturePath = path.join("VAULT", CAPTURE_RELATIVE);
  const at = (iso) => () => new Date(iso);

  appendCapture({ vaultPath: "VAULT", fsImpl, text: "one", now: at("2026-08-18T09:00:00.000Z") });
  appendCapture({ vaultPath: "VAULT", fsImpl, text: "two", now: at("2026-08-18T10:00:00.000Z") });

  const body = fsImpl.files.get(capturePath);
  assert.strictEqual((body.match(/## 2026-08-18/g) || []).length, 1, "day heading must appear once");
  assert.match(body, /- 12:00 — one/);
  assert.match(body, /- 13:00 — two/);
});

test("starts a new day heading when the date rolls over", () => {
  const fsImpl = memFs();
  const capturePath = path.join("VAULT", CAPTURE_RELATIVE);
  const at = (iso) => () => new Date(iso);

  appendCapture({ vaultPath: "VAULT", fsImpl, text: "day one", now: at("2026-08-18T09:00:00.000Z") });
  appendCapture({ vaultPath: "VAULT", fsImpl, text: "day two", now: at("2026-08-19T09:00:00.000Z") });

  const body = fsImpl.files.get(capturePath);
  assert.match(body, /## 2026-08-18/);
  assert.match(body, /## 2026-08-19/);
});

test("returns the path and timestamp it wrote", () => {
  const fsImpl = memFs();
  const result = appendCapture({
    vaultPath: "VAULT", fsImpl, text: "hello",
    now: () => new Date("2026-08-18T09:00:00.000Z"),
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.time, "12:00");
  assert.ok(result.path.includes("inbox"));
});

test("refuses empty text rather than writing a blank bullet", () => {
  const fsImpl = memFs();
  const result = appendCapture({ vaultPath: "VAULT", fsImpl, text: "   " });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(fsImpl.files.size, 0, "nothing should have been written");
});

test("preserves newlines in a multi-line capture as a single bullet", () => {
  const fsImpl = memFs();
  appendCapture({
    vaultPath: "VAULT", fsImpl, text: "line one\nline two",
    now: () => new Date("2026-08-18T09:00:00.000Z"),
  });

  const body = fsImpl.files.get(path.join("VAULT", CAPTURE_RELATIVE));
  assert.match(body, /- 12:00 — line one line two/, "newlines collapse so the bullet stays one item");
});
