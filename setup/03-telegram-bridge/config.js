// config.js
// Single source of truth for configuration. `.env` is authoritative over ambient
// environment variables (override: true) — that was a deliberate v1 fix, keep it.
require("dotenv").config({ path: require("path").join(__dirname, ".env"), override: true });

const path = require("path");

// Kit note: this file was pinned to one machine's paths in the original. Here
// CLAUDE_CWD is required from .env (your project directory) so the bridge has
// no hidden default, and VAULT_PATH derives from it unless you override it.
// Use forward slashes even on Windows — Node accepts them everywhere and they
// can't be mangled by a lost backslash escape.

// Permission posture for every headless `claude` run. 'acceptEdits' is the safe
// default: Claude applies file edits but still stops for other sensitive
// actions. 'bypassPermissions' disables every prompt — powerful, and a real
// risk if the bot token leaks or the owner lock is misconfigured. Change this
// only once you understand the bridge and have tested the owner lock.
const VALID_PERMISSION_MODES = ["acceptEdits", "bypassPermissions", "default", "plan"];
const DEFAULT_PERMISSION_MODE = "acceptEdits";

function normalisePermissionMode(value) {
  if (!value) return DEFAULT_PERMISSION_MODE;
  if (!VALID_PERMISSION_MODES.includes(value)) {
    throw new Error(
      `PERMISSION_MODE "${value}" is not one of ${VALID_PERMISSION_MODES.join(", ")}`
    );
  }
  return value;
}

function loadConfig(env = process.env) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN missing from .env");
  }

  const claudeCwd = env.CLAUDE_CWD;
  if (!claudeCwd) {
    throw new Error("CLAUDE_CWD missing from .env — set it to your project directory (the folder holding your CLAUDE.md)");
  }

  return Object.freeze({
    token,
    ownerId: env.OWNER_TELEGRAM_ID || "",
    claudeCwd,
    // /hot reads from the vault and /log appends to it, both without invoking
    // Claude — that's the point of those commands. Defaults to <project>/second-brain.
    vaultPath: env.VAULT_PATH || path.join(claudeCwd, "second-brain"),
    permissionMode: normalisePermissionMode(env.PERMISSION_MODE),
    // Optional local speech-to-text. Both live under vendor/ (not shipped in the
    // kit — ~2GB of downloaded artefacts). If either is absent, lib/stt.js
    // returns null and the bridge says voice is unavailable instead of failing.
    whisperPath: env.WHISPER_PATH || path.join(__dirname, "vendor", "whisper", "Release", "whisper-cli.exe"),
    whisperModelPath: env.WHISPER_MODEL_PATH || path.join(__dirname, "vendor", "ggml-large-v3-turbo.bin"),
    claudeExecutable: env.CLAUDE_EXECUTABLE_PATH || "claude",
    dataDir: path.join(__dirname, "data"),
    // Accept both env names, prefer the unsuffixed one actually in use.
    briefPrompt: env.PROACTIVE_CHECKIN_PROMPT || env.PROACTIVE_CHECKIN_PROMPT_TEMPLATE || "",
  });
}

module.exports = { loadConfig, normalisePermissionMode, DEFAULT_PERMISSION_MODE, VALID_PERMISSION_MODES };
