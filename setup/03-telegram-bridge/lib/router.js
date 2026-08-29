// lib/router.js
// Dispatch. Replaces message-handler.js.
const { isAuthorized } = require("../owner-lock");
const {
  splitMarkdown,
  toTelegramHtml,
  shouldSendAsDocument,
  asDocument,
} = require("./render");
const { AbortedError } = require("./claude-runner");

const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

function parseCommand(text) {
  const m = String(text || "").match(/^\/([A-Za-z0-9_]+)(?:@\S+)?(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  return { name: m[1].toLowerCase(), args: (m[2] || "").trim() };
}

function createRouter({
  api,
  ownerId,
  commands,
  runner,
  queue,
  audit,
  sessions,
  log,
  now = () => Date.now(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
  progress = null,
  // Grab-bag merged into every command handler's ctx.extra. Generic on purpose:
  // /status needs poller state and process start time, a future command will
  // need something else, and neither should force a new named parameter here.
  extra = {},
  // Optional attachment port: { pick(msg), save(attachment), transcribe?(path),
  // speak?(text) }. Omitted entirely, the bridge behaves exactly as it did
  // before P5 -- attachments simply are not recognised.
  media = null,
}) {
  let currentRun = null;

  function describe(update) {
    if (update.message) {
      const m = update.message;
      return {
        kind: "message",
        msg: m,
        senderId: m.from && m.from.id,
        chatId: m.chat && m.chat.id,
        dateSec: m.date,
      };
    }
    if (update.callback_query) {
      const cq = update.callback_query;
      return {
        kind: "callback",
        cq,
        senderId: cq.from && cq.from.id,
        chatId: cq.message && cq.message.chat && cq.message.chat.id,
        dateSec: null,
      };
    }
    return { kind: "unknown" };
  }

  function gate(d) {
    // Both ids, exactly as v1 did. This is the entire security boundary.
    return isAuthorized(d.senderId, ownerId) && isAuthorized(d.chatId, ownerId);
  }

  async function send(chatId, text, extra = {}) {
    return api.sendMessage({ chat_id: chatId, text, ...extra });
  }

  async function sendReply(chatId, markdown) {
    const text = String(markdown || "").trim() || "(empty response)";

    if (shouldSendAsDocument(text)) {
      await api.sendDocument({ chat_id: chatId, ...asDocument(text) });
      return;
    }

    for (const md of splitMarkdown(text)) {
      try {
        await send(chatId, toTelegramHtml(md), { parse_mode: "HTML" });
      } catch (err) {
        // Malformed HTML must never swallow a reply. Resend the markdown source
        // with no parse_mode -- simpler and more readable than stripping tags.
        log(`HTML send rejected, resending as plain text: ${err.message}`);
        await send(chatId, md);
      }
    }
  }

  async function reportStale(staleMessages) {
    const lines = staleMessages.map((m) => {
      const when = new Date(m.date * 1000).toISOString().slice(0, 16).replace("T", " ");
      const body = String(m.text || "(non-text message)").slice(0, 300);
      return `- ${when} — ${body}`;
    });

    await send(
      staleMessages[0].chat.id,
      [
        "You sent these while I was down. I have NOT acted on them — too old to run safely.",
        "",
        ...lines,
        "",
        "Resend anything you still want done.",
      ].join("\n")
    );
  }

  async function runTurn(chatId, prompt, { spoken = false } = {}) {
    const job = queue.push(async () => {
      const controller = new AbortController();
      currentRun = { chatId, controller };
      const tracker = progress ? progress.start(chatId) : null;

      try {
        const result = await runner.run({
          prompt,
          sessionId: sessions.currentSessionId(),
          signal: controller.signal,
          // Fire and forget: tracker.update swallows its own errors, and the
          // runner already guards against a throwing listener. Awaiting here
          // would stall the event stream behind Telegram's edit latency.
          onEvent: tracker ? (event) => { tracker.update(event); } : undefined,
        });

        sessions.setCurrentSessionId(result.sessionId);
        audit.append({
          kind: "turn",
          chatId,
          prompt: prompt.slice(0, 2000),
          reply: String(result.text || "").slice(0, 4000),
          sessionId: result.sessionId,
          costUsd: result.costUsd,
        });

        if (tracker) await tracker.finish();
        await sendReply(chatId, result.text);

        // Spoken to, speak back -- but text goes out first and always, so a TTS
        // failure costs the owner the voice note, never the answer.
        if (spoken && media && media.speak) {
          try {
            await media.speak(chatId, result.text);
          } catch (err) {
            log(`Voice reply failed, text already sent: ${err.message}`);
          }
        }
      } catch (err) {
        if (tracker) await tracker.finish();
        if (err instanceof AbortedError || err.aborted) {
          await send(chatId, "Stopped.");
        } else {
          log(`Turn failed: ${err.stack || err}`);
          await send(chatId, `That broke:\n\n${String(err.message).slice(-1200)}`);
        }
      } finally {
        currentRun = null;
      }
    });

    if (!job.accepted) {
      await send(chatId, `Already ${job.depth} things queued — /stop to clear them.`);
      return;
    }

    // The queue swallows rejections to protect the chain, so handle ours here.
    job.done.catch((err) => log(`Unhandled turn error: ${err.stack || err}`));
  }

  async function handleMessage(d) {
    // An attachment arrives with no `text` -- only an optional caption -- so this
    // has to run before the empty-text bail below, or photos are silently dropped.
    const attachment = media ? media.pick(d.msg) : null;
    if (attachment) {
      await handleAttachment(d, attachment);
      return;
    }

    const text = String(d.msg.text || "").trim();
    if (!text) return;

    const cmd = parseCommand(text);
    if (cmd) {
      const entry = commands[cmd.name];
      if (!entry) {
        await send(d.chatId, `I have no /${cmd.name}. Try /help.`);
        return;
      }
      try {
        const reply = await entry.handler({
          args: cmd.args,
          chatId: d.chatId,
          msg: d.msg,
          api,
          sessions,
          audit,
          commands,
          extra,
          router: { abortCurrent, isRunning },
          log,
        });
        if (reply) await sendReply(d.chatId, reply);
      } catch (err) {
        log(`Command /${cmd.name} failed: ${err.stack || err}`);
        await send(d.chatId, `/${cmd.name} broke: ${String(err.message).slice(0, 400)}`);
      }
      return;
    }

    await runTurn(d.chatId, text);
  }

  // Turns an attachment into an ordinary Claude turn. Photos and documents are
  // handed over as a filesystem path -- Claude opens them with its own Read
  // tool, which is why they need no external dependency. A voice note is
  // transcribed first, if transcription is available.
  async function handleAttachment(d, attachment) {
    let saved;
    try {
      saved = await media.save(attachment);
    } catch (err) {
      log(`Attachment download failed: ${err.stack || err}`);
      await send(d.chatId, `Couldn't fetch that ${attachment.kind}: ${String(err.message).slice(0, 200)}`);
      return;
    }

    if (attachment.kind === "voice") {
      if (!media.transcribe) {
        await send(d.chatId, "I can't hear voice notes yet — send it as text for now.");
        return;
      }
      let transcript;
      try {
        transcript = await media.transcribe(saved.path);
      } catch (err) {
        log(`Transcription failed: ${err.stack || err}`);
        await send(d.chatId, `Couldn't transcribe that: ${String(err.message).slice(0, 200)}`);
        return;
      }
      if (!transcript || !transcript.trim()) {
        await send(d.chatId, "That came through silent — nothing to transcribe.");
        return;
      }
      // Echo what was heard, so a mis-hearing is obvious rather than acted on.
      await send(d.chatId, `🎙 "${transcript.trim()}"`);
      await runTurn(d.chatId, transcript.trim(), { spoken: true });
      return;
    }

    const caption = String(attachment.caption || "").trim();
    const prompt = [
      `the owner sent a ${attachment.kind} from Telegram. It is saved at:`,
      saved.path,
      "",
      caption ? `His caption: ${caption}` : "He sent it with no caption.",
      "",
      "Read the file and respond to it. If it is worth keeping, say so and offer to file it in the vault — do not file it unprompted.",
    ].join("\n");

    await runTurn(d.chatId, prompt);
  }

  async function handleCallback(d) {
    // Always acknowledge, or the client spins forever.
    try {
      await api.answerCallbackQuery({ callback_query_id: d.cq.id });
    } catch (err) {
      log(`answerCallbackQuery failed: ${err.message}`);
    }

    const entry = commands.__callback__;
    if (!entry) return;

    try {
      const reply = await entry.handler({
        data: d.cq.data,
        chatId: d.chatId,
        cq: d.cq,
        api,
        sessions,
        extra,
        log,
      });
      if (reply) await sendReply(d.chatId, reply);
    } catch (err) {
      log(`Callback handler failed: ${err.stack || err}`);
    }
  }

  async function handleUpdates(updates) {
    const fresh = [];
    const stale = [];

    for (const update of updates) {
      const d = describe(update);
      if (d.kind === "unknown") continue;

      if (!gate(d)) {
        log(`Dropped unauthorized update: sender=${d.senderId} chat=${d.chatId}`);
        continue;
      }

      // Spec A10: a week-old instruction must not fire against a changed vault.
      // Taps are never stale -- they are current by definition.
      if (d.kind === "message" && now() - d.dateSec * 1000 > staleAfterMs) {
        stale.push(d.msg);
        continue;
      }

      fresh.push(d);
    }

    if (stale.length) {
      try {
        await reportStale(stale);
      } catch (err) {
        log(`Failed to report stale backlog: ${err.stack || err}`);
      }
    }

    for (const d of fresh) {
      try {
        if (d.kind === "message") await handleMessage(d);
        else await handleCallback(d);
      } catch (err) {
        log(`Update handling failed: ${err.stack || err}`);
      }
    }
  }

  function abortCurrent() {
    if (!currentRun) return false;
    currentRun.controller.abort();
    return true;
  }

  function isRunning() {
    return currentRun !== null;
  }

  // Resolves once every queued turn has finished. handleUpdates deliberately
  // returns before a run completes so polling continues and /stop can still be
  // received mid-turn; this is how shutdown and tests wait for the tail.
  function whenIdle() {
    return queue.whenIdle();
  }

  return { handleUpdates, abortCurrent, isRunning, whenIdle };
}

module.exports = { createRouter, parseCommand, DEFAULT_STALE_AFTER_MS };
