// test/render.test.js
const test = require("node:test");
const assert = require("node:assert");
const {
  escapeHtml,
  toTelegramHtml,
  splitMarkdown,
  renderForTelegram,
  MAX_CHUNK,
} = require("../lib/render");

test("escapes the three characters Telegram HTML cares about", () => {
  assert.strictEqual(escapeHtml("a & b < c > d"), "a &amp; b &lt; c &gt; d");
});

test("converts bold, italic, inline code and links", () => {
  assert.strictEqual(toTelegramHtml("**bold**"), "<b>bold</b>");
  assert.strictEqual(toTelegramHtml("say _softly_"), "say <i>softly</i>");
  assert.strictEqual(toTelegramHtml("run `npm test`"), "run <code>npm test</code>");
  assert.strictEqual(
    toTelegramHtml("[docs](https://example.com/x)"),
    '<a href="https://example.com/x">docs</a>'
  );
});

test("does not apply markdown inside an inline code span", () => {
  assert.strictEqual(toTelegramHtml("`**not bold**`"), "<code>**not bold**</code>");
});

test("escapes HTML inside an inline code span", () => {
  assert.strictEqual(toTelegramHtml("`a<b>c`"), "<code>a&lt;b&gt;c</code>");
});

test("turns a fenced block into pre and escapes its contents", () => {
  assert.strictEqual(toTelegramHtml("```js\nif (a < b) {}\n```"), "<pre>if (a &lt; b) {}</pre>");
});

test("closes an unterminated fence", () => {
  assert.strictEqual(toTelegramHtml("```\nabc"), "<pre>abc</pre>");
});

test("renders headings as bold and bullets as dots", () => {
  assert.strictEqual(toTelegramHtml("## Today"), "<b>Today</b>");
  assert.strictEqual(toTelegramHtml("- item"), "• item");
});

test("short text is a single chunk", () => {
  assert.deepStrictEqual(splitMarkdown("hello"), ["hello"]);
});

test("splits on line boundaries and never exceeds maxLen", () => {
  const md = Array.from({ length: 400 }, (_, i) => `line ${i} padding padding padding`).join("\n");
  const chunks = splitMarkdown(md, 500);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length <= 500, `chunk of ${c.length} exceeded 500`);
});

test("never splits a word mid-way", () => {
  const md = Array.from({ length: 60 }, () => "abcdefghij").join("\n");
  for (const c of splitMarkdown(md, 100)) {
    for (const line of c.split("\n")) {
      assert.ok(line === "" || line === "abcdefghij", `word was split: ${JSON.stringify(line)}`);
    }
  }
});

test("closes and reopens a fence that straddles a chunk boundary", () => {
  const body = Array.from({ length: 40 }, (_, i) => `code line ${i}`).join("\n");
  const chunks = splitMarkdown("```js\n" + body + "\n```", 200);
  assert.ok(chunks.length > 1);
  for (const c of chunks) {
    const fences = (c.match(/^```/gm) || []).length;
    assert.strictEqual(fences % 2, 0, `chunk has an unbalanced fence:\n${c}`);
  }
  assert.ok(chunks[1].startsWith("```js"), "the continuation must reopen the fence with its language");
});

test("hard-splits a single line longer than maxLen", () => {
  const chunks = splitMarkdown("x".repeat(250), 100);
  assert.ok(chunks.length >= 3);
  for (const c of chunks) assert.ok(c.length <= 100);
});

test("round-trips Arabic without mangling it", () => {
  const arabic = "مرحبا يا ثامر";
  assert.strictEqual(toTelegramHtml(arabic), arabic);
  assert.deepStrictEqual(splitMarkdown(arabic, 3000), [arabic]);
});

test("renderForTelegram returns messages under the document threshold", () => {
  const out = renderForTelegram("**hi**");
  assert.strictEqual(out.mode, "messages");
  assert.deepStrictEqual(out.chunks, ["<b>hi</b>"]);
});

test("renderForTelegram switches to a document when very long", () => {
  const out = renderForTelegram("y".repeat(13000));
  assert.strictEqual(out.mode, "document");
  assert.ok(out.filename.endsWith(".md"));
  assert.strictEqual(out.buffer.length, 13000);
  assert.ok(out.caption.length > 0);
});

test("empty input produces a placeholder rather than an empty send", () => {
  assert.strictEqual(renderForTelegram("   ").chunks[0], "(empty response)");
});

test("MAX_CHUNK leaves room for tag expansion under Telegram's 4096 limit", () => {
  assert.ok(MAX_CHUNK <= 3000);
});

test("shouldSendAsDocument only fires past the threshold", () => {
  const { shouldSendAsDocument } = require("../lib/render");
  assert.strictEqual(shouldSendAsDocument("short"), false);
  assert.strictEqual(shouldSendAsDocument("z".repeat(12001)), true);
});

test("asDocument produces a utf8 buffer and an .md filename", () => {
  const { asDocument } = require("../lib/render");
  const doc = asDocument("مرحبا");
  assert.ok(doc.filename.endsWith(".md"));
  assert.strictEqual(doc.buffer.toString("utf8"), "مرحبا");
});
