// test/telegram-api.test.js
const test = require("node:test");
const assert = require("node:assert");
const { createTelegramApi, TelegramError } = require("../lib/telegram-api");

function fakeFetch(responses) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  fetchFn.calls = calls;
  return fetchFn;
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

test("posts JSON to the right method and unwraps result", async () => {
  const fetchFn = fakeFetch([jsonResponse({ ok: true, result: { id: 7 } })]);
  const api = createTelegramApi({ token: "TOK", fetchFn });

  const result = await api.callApi("getMe", { a: 1 });

  assert.deepStrictEqual(result, { id: 7 });
  assert.strictEqual(fetchFn.calls[0].url, "https://api.telegram.org/botTOK/getMe");
  assert.strictEqual(fetchFn.calls[0].init.method, "POST");
  assert.strictEqual(fetchFn.calls[0].init.headers["Content-Type"], "application/json");
  assert.deepStrictEqual(JSON.parse(fetchFn.calls[0].init.body), { a: 1 });
});

test("throws TelegramError when the API returns ok:false", async () => {
  const fetchFn = fakeFetch([
    jsonResponse({ ok: false, description: "Unauthorized" }, { ok: false, status: 401 }),
  ]);
  const api = createTelegramApi({ token: "TOK", fetchFn });

  await assert.rejects(() => api.callApi("getMe"), (err) => {
    assert.ok(err instanceof TelegramError);
    assert.strictEqual(err.status, 401);
    return true;
  });
});

test("surfaces retry_after from a 429 body", async () => {
  const fetchFn = fakeFetch([
    jsonResponse(
      { ok: false, error_code: 429, parameters: { retry_after: 12 } },
      { ok: false, status: 429 }
    ),
  ]);
  const api = createTelegramApi({ token: "TOK", fetchFn });

  await assert.rejects(() => api.callApi("sendMessage"), (err) => {
    assert.strictEqual(err.retryAfter, 12);
    return true;
  });
});

test("never puts the token in the error message", async () => {
  const fetchFn = fakeFetch([jsonResponse({ ok: false }, { ok: false, status: 500 })]);
  const api = createTelegramApi({ token: "SECRET-TOKEN", fetchFn });

  await assert.rejects(() => api.callApi("getMe"), (err) => {
    assert.ok(!err.message.includes("SECRET-TOKEN"), "token leaked into error message");
    return true;
  });
});

test("throws TelegramError when the body is not JSON", async () => {
  const fetchFn = fakeFetch([
    { ok: true, status: 200, json: async () => { throw new Error("not json"); } },
  ]);
  const api = createTelegramApi({ token: "TOK", fetchFn });

  await assert.rejects(() => api.callApi("getMe"), (err) => {
    assert.ok(err instanceof TelegramError);
    return true;
  });
});

test("getUpdates passes offset, timeout and allowed_updates through", async () => {
  const fetchFn = fakeFetch([jsonResponse({ ok: true, result: [] })]);
  const api = createTelegramApi({ token: "TOK", fetchFn });

  await api.getUpdates({ offset: 5, timeout: 25, allowed_updates: ["message"] });

  assert.deepStrictEqual(JSON.parse(fetchFn.calls[0].init.body), {
    offset: 5,
    timeout: 25,
    allowed_updates: ["message"],
  });
});

test("deleteMyCommands passes the scope through", async () => {
  const fetchFn = fakeFetch([jsonResponse({ ok: true, result: true })]);
  const api = createTelegramApi({ token: "TOK", fetchFn });

  const result = await api.deleteMyCommands({ scope: { type: "all_private_chats" } });

  assert.strictEqual(result, true);
  assert.deepStrictEqual(JSON.parse(fetchFn.calls[0].init.body), {
    scope: { type: "all_private_chats" },
  });
});

test("downloadFile resolves getFile then fetches the file path", async () => {
  const fetchFn = fakeFetch([
    jsonResponse({ ok: true, result: { file_path: "voice/file_1.oga" } }),
    { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode("AUDIO").buffer },
  ]);
  const api = createTelegramApi({ token: "TOK", fetchFn });

  const { buffer, filePath } = await api.downloadFile("FID");

  assert.strictEqual(filePath, "voice/file_1.oga");
  assert.strictEqual(buffer.toString(), "AUDIO");
  assert.strictEqual(fetchFn.calls[1].url, "https://api.telegram.org/file/botTOK/voice/file_1.oga");
});
