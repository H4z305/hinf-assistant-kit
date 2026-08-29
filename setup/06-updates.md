# 06 — Getting updates

## If you took the plain-folder copy

Nothing to do. You have a snapshot. If your friend later sends a newer folder,
copy the `setup/` and `onboarding/` folders over yours — your generated
`CLAUDE.md`, your `.env`, and your real vault live in your **project
directory**, not in the kit folder, so nothing of yours is touched.

## If your friend gave you a private GitHub repo URL

```bash
git clone <the-url> hinf-assistant-kit
cd hinf-assistant-kit
```

To pull updates later:

```bash
git pull
```

After a pull:

- Re-running any `setup/*.md` guide is safe — the steps check for existing
  state and ask before overwriting.
- To re-run the interview: open the folder in Claude Code and say
  `run onboarding` again. It diffs against your existing `CLAUDE.md` rather than
  clobbering it.
- The Telegram bridge: `cd setup/03-telegram-bridge && npm install` again in
  case dependencies changed, then restart it.

## What never gets overwritten

Your project directory (`CLAUDE.md`, `.env`, your vault with all your notes) is
separate from this kit folder. `git pull` only ever touches the kit.
