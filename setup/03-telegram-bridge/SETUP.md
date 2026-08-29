# 03 — Telegram bridge

## What this is

A small local Node service. It long-polls Telegram; when **you** (and only you)
message it, it runs `claude` headlessly in your project directory and replies
with the result. A companion script (`proactive-checkin.js`) can push a
scheduled daily brief.

Everything stays on your machine. Authentication is your already-logged-in
`claude` CLI — **never an `ANTHROPIC_API_KEY`**. Do not add one anywhere; it
would reintroduce per-token billing and bypass your subscription login.

This copy has been lightly adapted from the original: `CLAUDE_CWD` is required
from `.env` (no hidden machine-specific default), and the Claude permission mode
is configurable via `PERMISSION_MODE` (default `acceptEdits`).

## Prerequisites

- **Node.js ≥ 20** — check with `node -v`. Get it from <https://nodejs.org>.
- **Claude Code** installed and signed in (`claude` runs from your shell).
- A **Telegram** account.

## Step 1 — Create your bot and get the token

1. Open Telegram, search for **@BotFather**, press **Start**.
2. Send `/newbot`.
3. Give it a display name (anything), then a username that must end in `bot`
   (e.g. `my_study_assistant_bot`).
4. BotFather replies with a token like `123456789:AAH-xxxxxxxxxxxxxxxxxxxxxxxxxxxx`.
   That is your `TELEGRAM_BOT_TOKEN`. Treat it like a password.

## Step 2 — Get your owner ID (the ID of who is allowed to message)

The bridge refuses every message whose sender ID is not your `OWNER_TELEGRAM_ID`.
Two ways to find yours:

- **Easy:** message **@userinfobot** on Telegram. It replies with your numeric
  `Id`. That number is your `OWNER_TELEGRAM_ID`.
- **From the bridge itself:** leave `OWNER_TELEGRAM_ID` blank for now, finish
  the steps below, run `node bot.js`, send your bot any message. The message is
  rejected, but `bot.log` records the sender ID of that rejected message. Copy
  it into `.env` and restart.

> The same mechanism is how you'd allow a *different* person later: whoever
> messages the bot shows up in `bot.log` by ID; only the ID in
> `OWNER_TELEGRAM_ID` is ever answered. There is one owner, not a list.

## Step 3 — Install

```bash
cd setup/03-telegram-bridge
npm install
```

## Step 4 — Configure

```bash
cp .env.example .env
```

Fill in `.env`:

| Key | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | from Step 1 |
| `OWNER_TELEGRAM_ID` | from Step 2 (or leave blank and use the bot.log method) |
| `CLAUDE_CWD` | absolute path to your project dir (the folder with your `CLAUDE.md`), e.g. `C:/my-assistant` |
| `VAULT_PATH` | optional; defaults to `<CLAUDE_CWD>/second-brain` |
| `PERMISSION_MODE` | leave as `acceptEdits` for now |

## Step 5 — The permission-mode decision

`PERMISSION_MODE` controls every headless `claude` run the bridge makes:

- **`acceptEdits`** (default) — Claude applies file edits but still stops for
  other sensitive actions.
- **`bypassPermissions`** — no permission prompts at all. Convenient, and a real
  risk: the only thing between a leaked bot token and unrestricted action on
  your machine is `owner-lock.js`. Test the owner lock (Step 7) before you ever
  consider changing this. It is a deliberate choice, not a default to inherit.

Unknown values are rejected at startup, so a typo can't silently widen access.

## Step 6 — Test the happy path

```bash
node bot.js
```

Message your bot "hello". You should get a Claude reply within a few seconds.

## Step 7 — Test the owner lock (do this before trusting it)

From a **different Telegram account** (a friend's phone, a second account),
message the bot. It must **not** reply, and `bot.log` should show the rejected
sender ID. If a non-owner gets any real answer, stop and fix `OWNER_TELEGRAM_ID`
before going further.

## Step 8 — Voice notes (optional, off by default)

`lib/stt.js` / `lib/tts.js` support Telegram voice messages, but speech-to-text
needs a local Whisper build under `vendor/` that this kit does **not** ship
(~2 GB). Without it the bridge just says voice is unavailable; text works fine.
Setting Whisper up is out of scope here — see the comments in `lib/stt.js` if
you want it later.

## Step 8b — Daily brief location (optional)

The proactive check-in (`proactive-checkin.js`) adds weather and prayer-time
lines to a morning brief. They're region-specific:

- `BRIEF_CITY` / `BRIEF_COUNTRY` — used for prayer times (Aladhan, Umm al-Qura
  method). Leave `BRIEF_CITY` blank and the brief just omits the prayer line.
- `BRIEF_LAT` / `BRIEF_LON` — weather coordinates. Default is the Qassim region;
  set your own if you're elsewhere.

The brief itself is composed by Claude with your calendar/Gmail/vault tools, so
most of it works regardless of these.

## Step 9 — Always-on (optional, opt-in)

Running `node bot.js` in a terminal stops when you close the terminal. To keep
it running:

- **Windows:** `register-watchdog.ps1` + `start-hidden.vbs` keep it alive across
  reboots; `register-checkin-task.ps1` schedules the daily brief. These register
  Scheduled Tasks — a standing change to your system. Run them only once you've
  decided you want that.
- **macOS / Linux:** use `pm2 start bot.js`, a `systemd --user` unit, or
  `launchd`. Not scripted in this kit yet.

## Stop

`stop.bat` on Windows, or Ctrl-C in the terminal running `node bot.js`.

## Tests

```bash
npm test
```

Runs the full suite (Node's built-in test runner). The `config` and
`claude-runner` suites assert the adapted behaviour: `CLAUDE_CWD` is required,
`vaultPath` derives from it, and `PERMISSION_MODE` defaults to `acceptEdits`.
