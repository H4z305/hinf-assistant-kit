// lib/telegram-api.js
// The ONLY place that knows how to talk HTTP to Telegram. Raw fetch is used
// deliberately: proactive-checkin.js proved this exact transport works through
// Thamer's network while the long-poll library did not.
const DEFAULT_BASE_URL = "https://api.telegram.org";

class TelegramError extends Error {
  constructor(method, status, body) {
    // The token lives in the URL, so the URL must never reach the message.
    super(`Telegram ${method} failed (HTTP ${status}): ${describe(body)}`);
    this.name = "TelegramError";
    this.status = status;
    this.body = body;
    this.retryAfter = body && body.parameters ? body.parameters.retry_after : undefined;
  }
}

function describe(body) {
  if (!body) return "no body";
  if (body.description) return body.description;
  try {
    return JSON.stringify(body).slice(0, 300);
  } catch (err) {
    return "unserialisable body";
  }
}

function createTelegramApi({ token, fetchFn = fetch, baseUrl = DEFAULT_BASE_URL }) {
  const apiRoot = `${baseUrl}/bot${token}`;
  const fileRoot = `${baseUrl}/file/bot${token}`;

  async function callApi(method, params = {}, { signal } = {}) {
    const res = await fetchFn(`${apiRoot}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal,
    });

    let body;
    try {
      body = await res.json();
    } catch (err) {
      throw new TelegramError(method, res.status, { description: "response was not JSON" });
    }

    if (!res.ok || !body.ok) throw new TelegramError(method, res.status, body);
    return body.result;
  }

  async function sendFile(method, field, { chat_id, buffer, filename, caption }) {
    const form = new FormData();
    form.append("chat_id", String(chat_id));
    if (caption) form.append("caption", caption);
    form.append(field, new Blob([buffer]), filename);

    const res = await fetchFn(`${apiRoot}/${method}`, { method: "POST", body: form });

    let body;
    try {
      body = await res.json();
    } catch (err) {
      throw new TelegramError(method, res.status, { description: "response was not JSON" });
    }
    if (!res.ok || !body.ok) throw new TelegramError(method, res.status, body);
    return body.result;
  }

  async function downloadFile(fileId) {
    const { file_path: filePath } = await callApi("getFile", { file_id: fileId });
    const res = await fetchFn(`${fileRoot}/${filePath}`);
    if (!res.ok) {
      throw new TelegramError("getFile:download", res.status, { description: "file fetch failed" });
    }
    return { buffer: Buffer.from(await res.arrayBuffer()), filePath };
  }

  return {
    callApi,
    downloadFile,
    getUpdates: (params) => callApi("getUpdates", params),
    sendMessage: (params) => callApi("sendMessage", params),
    editMessageText: (params) => callApi("editMessageText", params),
    deleteMessage: (params) => callApi("deleteMessage", params),
    sendChatAction: (params) => callApi("sendChatAction", params),
    answerCallbackQuery: (params) => callApi("answerCallbackQuery", params),
    setMyCommands: (params) => callApi("setMyCommands", params),
    deleteMyCommands: (params) => callApi("deleteMyCommands", params),
    setMyDescription: (params) => callApi("setMyDescription", params),
    setMyShortDescription: (params) => callApi("setMyShortDescription", params),
    sendDocument: (params) => sendFile("sendDocument", "document", params),
    sendVoice: (params) => sendFile("sendVoice", "voice", params),
  };
}

module.exports = { createTelegramApi, TelegramError, DEFAULT_BASE_URL };
