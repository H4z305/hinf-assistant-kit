// lib/claude-runner.js
// Spawns the headless `claude` CLI and streams its events back.
//
// Uses --output-format stream-json --verbose, verified against claude 2.1.218:
// it emits newline-delimited JSON, and the final `result` event carries the same
// result / session_id / total_cost_usd fields the plain json format returns. So
// the resolve contract is unchanged and callers that ignore onEvent see no
// difference -- but a caller that wants live progress can now have it.
const { spawn: defaultSpawn } = require("child_process");

const DEFAULT_TIMEOUT_MS = 600000;

class AbortedError extends Error {
  constructor() {
    super("run aborted");
    this.name = "AbortedError";
    this.aborted = true;
  }
}

// Pure, so line-splitting is testable without spawning anything.
//
// stdout arrives in arbitrary chunks and a JSON object WILL be split mid-line,
// so only complete lines are parsed and the remainder is carried forward. A
// malformed line is skipped rather than thrown: hook output and warnings
// interleave with the event stream, and one bad line must not kill a turn.
function parseNdjsonChunk(buffer, chunk) {
  const combined = buffer + chunk;
  const lines = combined.split("\n");
  const remainder = lines.pop(); // possibly incomplete

  const events = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch (err) {
      // Not JSON -- skip it.
    }
  }

  return { events, buffer: remainder };
}

function createClaudeRunner({
  spawnFn = defaultSpawn,
  claudeExecutable,
  cwd,
  permissionMode = "acceptEdits",
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  function run({ prompt, sessionId, signal, onEvent }) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;
      let onAbort = null;

      function settle(fn, value) {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (signal && onAbort) signal.removeEventListener("abort", onAbort);
        fn(value);
      }

      if (signal && signal.aborted) return settle(reject, new AbortedError());

      const args = [
        "-p", prompt,
        "--permission-mode", permissionMode,
        "--output-format", "stream-json",
        "--verbose",
      ];
      if (sessionId) args.push("--resume", sessionId);

      // No `env` key here on purpose. The child inherits the full parent
      // environment, which is what makes the OAuth-based `claude` login work.
      // Do not narrow this to an allowlist without understanding that first.
      //
      // stdin is explicitly closed ("ignore"). Node's default spawn stdio
      // leaves stdin as an open, unconnected pipe -- the CLI can't tell that
      // apart from "a slow command is about to pipe something in", so it
      // waits ~3s, then either proceeds (usually) or intermittently exits 1
      // with "Warning: no stdin data received in 3s" as the only stderr line
      // (observed in bot.log/proactive.log, roughly 1 in 7 runs). The CLI's
      // own warning names the fix: "redirect stdin explicitly: < /dev/null".
      // We never send prompt via stdin (it's the -p arg), so closing it is safe.
      const child = spawnFn(claudeExecutable, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });

      // Explicit encoding so a multi-byte UTF-8 character (Arabic, for instance)
      // split across a chunk boundary is not corrupted.
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      let buffer = "";
      let stderr = "";
      let resultEvent = null;

      child.stdout.on("data", (chunk) => {
        const parsed = parseNdjsonChunk(buffer, chunk);
        buffer = parsed.buffer;

        for (const event of parsed.events) {
          if (event && event.type === "result") resultEvent = event;
          if (onEvent) {
            try {
              onEvent(event);
            } catch (err) {
              // A broken listener must never take down the run.
            }
          }
        }
      });

      child.stderr.on("data", (d) => { stderr += d; });

      timer = setTimeout(() => {
        child.kill();
        settle(reject, new Error(`claude timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      if (signal) {
        onAbort = () => {
          child.kill();
          settle(reject, new AbortedError());
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }

      child.on("error", (err) => settle(reject, err));

      child.on("close", (code) => {
        if (settled) return;

        if (code !== 0) {
          return settle(reject, new Error(`claude exited ${code}: ${stderr.slice(-1500)}`));
        }

        // Exit 0 with no result event is silent truncation. It must not be
        // allowed to look like success.
        if (!resultEvent) {
          return settle(
            reject,
            new Error(`claude exited 0 but produced no result event; stderr tail: ${stderr.slice(-500)}`)
          );
        }

        if (
          typeof resultEvent.session_id !== "string" ||
          typeof resultEvent.result !== "string"
        ) {
          return settle(
            reject,
            new Error(`unexpected claude result shape: ${JSON.stringify(resultEvent).slice(0, 500)}`)
          );
        }

        settle(resolve, {
          text: resultEvent.result,
          sessionId: resultEvent.session_id,
          isError: resultEvent.is_error,
          costUsd: resultEvent.total_cost_usd,
        });
      });
    });
  }

  return { run };
}

module.exports = { createClaudeRunner, AbortedError, parseNdjsonChunk, DEFAULT_TIMEOUT_MS };
