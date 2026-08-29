// lib/render.js
// Claude answers in markdown; Telegram wants HTML. HTML is chosen over MarkdownV2
// because MarkdownV2 requires escaping 18 characters and a single stray '.' breaks
// the entire message. HTML has three escapes and fails safe.
//
// Chunking happens on the MARKDOWN, before conversion. Chunking HTML would split
// inside a tag or leave <pre> unclosed, which Telegram rejects with a 400.
const MAX_CHUNK = 3000; // markdown chars; conversion adds tags, ceiling is 4096
const DOC_THRESHOLD = 12000;

// Placeholder that parks inline code spans while markdown is applied around them.
// Deliberately plain ASCII: a raw NUL here does NOT match inside a RegExp pattern
// in V8, so the restore step silently failed. Also avoids _ and * so the italic
// rules below cannot chew the placeholder itself.
const CODE_OPEN = "%%CODE";
const CODE_CLOSE = "%%";

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inlineMd(text) {
  // Pull code spans out first so markdown inside them is left alone, then put them
  // back last. Otherwise `**not bold**` would render as bold.
  const codes = [];
  let s = String(text).replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `${CODE_OPEN}${codes.length - 1}${CODE_CLOSE}`;
  });

  s = escapeHtml(s);
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<i>$2</i>");
  s = s.replace(/(^|[\s(])_([^_\n]+)_/g, "$1<i>$2</i>");
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');

  s = s.replace(
    /%%CODE(\d+)%%/g,
    (_, i) => `<code>${escapeHtml(codes[Number(i)])}</code>`
  );
  return s;
}

function toTelegramHtml(markdown) {
  const out = [];
  let inFence = false;
  let fenceBuf = [];

  for (const line of String(markdown).split("\n")) {
    if (/^```/.test(line.trim())) {
      if (!inFence) {
        inFence = true;
        fenceBuf = [];
      } else {
        inFence = false;
        out.push(`<pre>${escapeHtml(fenceBuf.join("\n"))}</pre>`);
      }
      continue;
    }
    if (inFence) {
      fenceBuf.push(line);
      continue;
    }

    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      out.push(`<b>${inlineMd(heading[1])}</b>`);
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      out.push(`• ${inlineMd(bullet[1])}`);
      continue;
    }

    out.push(inlineMd(line));
  }

  // An unterminated fence still has to render as something valid.
  if (inFence) out.push(`<pre>${escapeHtml(fenceBuf.join("\n"))}</pre>`);

  return out.join("\n");
}

function splitMarkdown(markdown, maxLen = MAX_CHUNK) {
  const text = String(markdown);
  if (text.length <= maxLen) return [text];

  // Pre-split any single line that is itself too long, so the packer below can
  // always place a line without overflowing.
  const lines = [];
  for (const line of text.split("\n")) {
    if (line.length <= maxLen) {
      lines.push(line);
      continue;
    }
    for (let i = 0; i < line.length; i += maxLen) lines.push(line.slice(i, i + maxLen));
  }

  const chunks = [];
  let cur = [];
  let curLen = 0;
  let fenceOpen = false;
  let fenceLang = "";

  function flush(isFinal) {
    if (!cur.length) return;
    let body = cur.join("\n");
    if (fenceOpen && !isFinal) body += "\n```";
    if (body.trim()) chunks.push(body);

    if (!isFinal && fenceOpen) {
      cur = ["```" + fenceLang];
      curLen = cur[0].length + 1;
    } else {
      cur = [];
      curLen = 0;
    }
  }

  for (const line of lines) {
    if (cur.length && curLen + line.length + 1 > maxLen) flush(false);
    cur.push(line);
    curLen += line.length + 1;

    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      if (!fenceOpen) {
        fenceOpen = true;
        fenceLang = fence[1];
      } else {
        fenceOpen = false;
        fenceLang = "";
      }
    }
  }
  flush(true);

  return chunks;
}

function renderForTelegram(markdown, { maxChunk = MAX_CHUNK, docThreshold = DOC_THRESHOLD } = {}) {
  const text = String(markdown || "").trim() || "(empty response)";

  if (text.length > docThreshold) {
    return {
      mode: "document",
      filename: `transcript-${Date.now()}.md`,
      buffer: Buffer.from(text, "utf8"),
      caption: `Long answer — ${text.length} characters, sent as a file.`,
    };
  }

  return { mode: "messages", chunks: splitMarkdown(text, maxChunk).map(toTelegramHtml) };
}

function shouldSendAsDocument(text, threshold = DOC_THRESHOLD) {
  return String(text || "").trim().length > threshold;
}

function asDocument(text) {
  const body = String(text || "");
  return {
    filename: `transcript-${Date.now()}.md`,
    buffer: Buffer.from(body, "utf8"),
    caption: `Long answer — ${body.length} characters, sent as a file.`,
  };
}

module.exports = {
  shouldSendAsDocument,
  asDocument,
  escapeHtml,
  inlineMd,
  toTelegramHtml,
  splitMarkdown,
  renderForTelegram,
  MAX_CHUNK,
  DOC_THRESHOLD,
};
