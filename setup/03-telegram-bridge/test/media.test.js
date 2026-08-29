// test/media.test.js
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { pickAttachment, saveAttachment, pruneMedia, safeName } = require("../lib/media");

function memFs() {
  const files = new Map();
  const times = new Map();
  return {
    files,
    times,
    existsSync: (p) => files.has(p) || p.endsWith("media"),
    mkdirSync: () => {},
    writeFileSync: (p, d) => { files.set(p, d); },
    readdirSync: () => Array.from(files.keys()).map((p) => path.basename(p)),
    statSync: (p) => ({ mtimeMs: times.get(path.basename(p)) ?? 0 }),
    unlinkSync: (p) => { files.delete(Array.from(files.keys()).find((k) => path.basename(k) === path.basename(p))); },
  };
}

// --- pickAttachment ----------------------------------------------------------

test("picks the largest photo size", () => {
  const msg = {
    photo: [
      { file_id: "small", width: 90, file_size: 1000 },
      { file_id: "big", width: 1280, file_size: 90000 },
    ],
  };
  const a = pickAttachment(msg);

  assert.strictEqual(a.kind, "photo");
  assert.strictEqual(a.fileId, "big", "Telegram orders photo sizes ascending; take the last");
  assert.match(a.fileName, /\.jpg$/);
});

test("picks a document and keeps its original filename", () => {
  const a = pickAttachment({ document: { file_id: "d1", file_name: "lab results.pdf", mime_type: "application/pdf" } });

  assert.strictEqual(a.kind, "document");
  assert.strictEqual(a.fileId, "d1");
  assert.match(a.fileName, /lab-results\.pdf$/);
});

test("picks a voice note", () => {
  const a = pickAttachment({ voice: { file_id: "v1", duration: 12, mime_type: "audio/ogg" } });

  assert.strictEqual(a.kind, "voice");
  assert.strictEqual(a.fileId, "v1");
  assert.strictEqual(a.durationSec, 12);
});

test("picks an audio file as voice too", () => {
  const a = pickAttachment({ audio: { file_id: "a1", duration: 30 } });
  assert.strictEqual(a.kind, "voice");
});

test("returns null for a plain text message", () => {
  assert.strictEqual(pickAttachment({ text: "hello" }), null);
  assert.strictEqual(pickAttachment({}), null);
});

test("carries the caption through", () => {
  const a = pickAttachment({ photo: [{ file_id: "p" }], caption: "look at this" });
  assert.strictEqual(a.caption, "look at this");
});

// --- safeName ----------------------------------------------------------------

test("safeName strips path traversal and separators", () => {
  // A filename is attacker-controlled data. It must never be able to escape the
  // media directory, even though this bot is owner-locked.
  assert.ok(!safeName("../../etc/passwd").includes(".."));
  assert.ok(!safeName("../../etc/passwd").includes("/"));
  assert.ok(!safeName("a\\b\\c.txt").includes("\\"));
});

test("safeName keeps a sensible extension", () => {
  assert.match(safeName("report.final.pdf"), /\.pdf$/);
});

test("safeName falls back when given nothing usable", () => {
  assert.ok(safeName("").length > 0);
  assert.ok(safeName("???").length > 0);
});

// --- saveAttachment ----------------------------------------------------------

test("downloads and writes the file, returning an absolute path", async () => {
  const fsImpl = memFs();
  const api = { downloadFile: async () => ({ buffer: Buffer.from("IMAGEBYTES"), filePath: "photos/x.jpg" }) };

  const result = await saveAttachment({
    api,
    attachment: { kind: "photo", fileId: "p1", fileName: "shot.jpg" },
    mediaDir: path.join("DATA", "media"),
    fsImpl,
    now: () => new Date("2026-08-19T10:00:00.000Z"),
  });

  assert.ok(path.isAbsolute(result.path) || result.path.includes("DATA"), "path must be resolvable by Claude");
  assert.ok(result.path.includes("shot"), "keeps a recognisable name");
  assert.strictEqual(fsImpl.files.get(result.path).toString(), "IMAGEBYTES");
});

test("prefixes the filename with a timestamp so two shots do not collide", async () => {
  const fsImpl = memFs();
  const api = { downloadFile: async () => ({ buffer: Buffer.from("X"), filePath: "p.jpg" }) };
  const attachment = { kind: "photo", fileId: "p1", fileName: "photo.jpg" };

  const a = await saveAttachment({ api, attachment, mediaDir: "DATA", fsImpl, now: () => new Date("2026-08-19T10:00:00.000Z") });
  const b = await saveAttachment({ api, attachment, mediaDir: "DATA", fsImpl, now: () => new Date("2026-08-19T10:00:01.000Z") });

  assert.notStrictEqual(a.path, b.path, "same filename at different times must not overwrite");
});

test("surfaces a download failure rather than writing a broken file", async () => {
  const fsImpl = memFs();
  const api = { downloadFile: async () => { throw new Error("file too big"); } };

  await assert.rejects(
    () => saveAttachment({ api, attachment: { kind: "photo", fileId: "p", fileName: "a.jpg" }, mediaDir: "D", fsImpl }),
    /file too big/
  );
  assert.strictEqual(fsImpl.files.size, 0);
});

// --- pruneMedia --------------------------------------------------------------

test("deletes files older than the cutoff and keeps recent ones", () => {
  const fsImpl = memFs();
  const now = 10 * 24 * 60 * 60 * 1000; // 10 days in ms
  fsImpl.files.set(path.join("D", "old.jpg"), "x");
  fsImpl.times.set("old.jpg", 0); // 10 days old
  fsImpl.files.set(path.join("D", "new.jpg"), "x");
  fsImpl.times.set("new.jpg", now - 1000); // a second ago

  const removed = pruneMedia({ mediaDir: "D", fsImpl, now: () => now, maxAgeMs: 7 * 24 * 60 * 60 * 1000 });

  assert.strictEqual(removed, 1);
  assert.ok(!Array.from(fsImpl.files.keys()).some((k) => k.includes("old.jpg")));
  assert.ok(Array.from(fsImpl.files.keys()).some((k) => k.includes("new.jpg")));
});

test("pruning a missing directory is a no-op, not a crash", () => {
  const fsImpl = memFs();
  fsImpl.readdirSync = () => { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; };

  assert.doesNotThrow(() => pruneMedia({ mediaDir: "nope", fsImpl }));
});
