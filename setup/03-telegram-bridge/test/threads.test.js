// test/threads.test.js
const test = require("node:test");
const assert = require("node:assert");
const { createThreads, slugify } = require("../lib/threads");

function memFs() {
  const files = new Map();
  return {
    files,
    existsSync: (p) => files.has(p),
    readFileSync: (p) => {
      if (!files.has(p)) {
        const err = new Error("ENOENT");
        err.code = "ENOENT";
        throw err;
      }
      return files.get(p);
    },
    writeFileSync: (p, data) => { files.set(p, data); },
  };
}

// --- slugify -----------------------------------------------------------------

test("slugify lowercases and hyphenates", () => {
  assert.strictEqual(slugify("Grey Court stuff"), "grey-court-stuff");
});

test("slugify strips punctuation", () => {
  assert.strictEqual(slugify("what?! about @career..."), "what-about-career");
});

test("slugify caps at 24 characters", () => {
  const long = "a".repeat(50);
  assert.strictEqual(slugify(long).length, 24);
});

test("slugify collapses to empty for pure punctuation", () => {
  assert.strictEqual(slugify("???"), "");
});

// --- createThreads -------------------------------------------------------------

test("starts with main as the current thread", () => {
  const t = createThreads({ filePath: "threads.json", fsImpl: memFs() });
  assert.strictEqual(t.currentName(), "main");
  assert.strictEqual(t.currentSessionId(), null);
});

test("create slugifies the name and switches to it", () => {
  const t = createThreads({ filePath: "threads.json", fsImpl: memFs() });
  const result = t.create("Career Roadmap");

  assert.deepStrictEqual(result, { ok: true, name: "career-roadmap" });
  assert.strictEqual(t.currentName(), "career-roadmap");
});

test("create rejects a duplicate name", () => {
  const t = createThreads({ filePath: "threads.json", fsImpl: memFs() });
  t.create("career");
  const second = t.create("Career");

  assert.strictEqual(second.ok, false);
  assert.match(second.reason, /exists/i);
});

test("create rejects a name that slugifies to nothing", () => {
  const t = createThreads({ filePath: "threads.json", fsImpl: memFs() });
  const result = t.create("???");

  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /name/i);
});

test("create with no usable name still produces a working auto-named thread via new.js -- but the port itself requires a name", () => {
  const t = createThreads({ filePath: "threads.json", fsImpl: memFs() });
  const result = t.create("thread-2");
  assert.strictEqual(result.ok, true);
});

test("switchTo an unknown name returns false and leaves current unchanged", () => {
  const t = createThreads({ filePath: "threads.json", fsImpl: memFs() });
  const before = t.currentName();
  const switched = t.switchTo("nonexistent");

  assert.strictEqual(switched, false);
  assert.strictEqual(t.currentName(), before);
});

test("switchTo a real name changes current and preserves its session", () => {
  const t = createThreads({ filePath: "threads.json", fsImpl: memFs() });
  t.create("career");
  t.setCurrentSessionId("sess-career");
  t.create("grey-court"); // switches to grey-court
  t.setCurrentSessionId("sess-grey");

  assert.strictEqual(t.switchTo("career"), true);
  assert.strictEqual(t.currentSessionId(), "sess-career");

  assert.strictEqual(t.switchTo("grey-court"), true);
  assert.strictEqual(t.currentSessionId(), "sess-grey");
});

test("setCurrentSessionId only affects the active thread", () => {
  const t = createThreads({ filePath: "threads.json", fsImpl: memFs() });
  t.setCurrentSessionId("main-sess");
  t.create("side-quest");
  t.setCurrentSessionId("side-sess");

  t.switchTo("main");
  assert.strictEqual(t.currentSessionId(), "main-sess");
});

test("reset clears only the active thread's session", () => {
  const t = createThreads({ filePath: "threads.json", fsImpl: memFs() });
  t.setCurrentSessionId("main-sess");
  t.create("side");
  t.setCurrentSessionId("side-sess");

  t.reset();
  assert.strictEqual(t.currentSessionId(), null);

  t.switchTo("main");
  assert.strictEqual(t.currentSessionId(), "main-sess");
});

test("list marks the current thread and sorts by recency", () => {
  let clock = 1000;
  const t = createThreads({ filePath: "threads.json", fsImpl: memFs(), now: () => clock });
  clock += 100; // main was created first; alpha must be strictly later to sort first
  t.create("alpha");

  const list = t.list();
  const alpha = list.find((x) => x.name === "alpha");
  const main = list.find((x) => x.name === "main");

  assert.strictEqual(alpha.isCurrent, true);
  assert.strictEqual(main.isCurrent, false);
  assert.strictEqual(list[0].name, "alpha", "most recently touched thread comes first");
});

test("list reports hasSession accurately", () => {
  const t = createThreads({ filePath: "threads.json", fsImpl: memFs() });
  t.create("empty-thread");
  t.switchTo("main");
  t.setCurrentSessionId("real-session");

  const list = t.list();
  assert.strictEqual(list.find((x) => x.name === "main").hasSession, true);
  assert.strictEqual(list.find((x) => x.name === "empty-thread").hasSession, false);
});

test("state survives a reload from the same backing file", () => {
  const fsImpl = memFs();
  const a = createThreads({ filePath: "threads.json", fsImpl });
  a.create("career");
  a.setCurrentSessionId("sess-1");

  const b = createThreads({ filePath: "threads.json", fsImpl });
  assert.strictEqual(b.currentName(), "career");
  assert.strictEqual(b.currentSessionId(), "sess-1");
});

test("a missing file falls back to a fresh main thread rather than throwing", () => {
  const t = createThreads({ filePath: "does-not-exist.json", fsImpl: memFs() });
  assert.strictEqual(t.currentName(), "main");
});

test("a corrupt file falls back to a fresh main thread rather than throwing", () => {
  const fsImpl = memFs();
  fsImpl.writeFileSync("threads.json", "{not valid json");
  const t = createThreads({ filePath: "threads.json", fsImpl });

  assert.strictEqual(t.currentName(), "main");
});
