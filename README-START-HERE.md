# HINF Assistant Kit — Start Here

This is a starting point for three things a Health Informatics student heading
into AI and bioinformatics can run on their own machine:

- a **personal AI assistant** (Claude Code with a persona and your program context),
- a **second brain** — a self-organising note vault that Claude reads from and writes to,
- optional **phone access** to the assistant over Telegram, and **device sync** for the vault.

It was built from a friend's working setup. Nothing personal to them is included —
every choice about who *you* are and how the assistant should behave is asked
during setup, not assumed.

---

## The three layers, all optional

1. **Knowledge** — the `second-brain/` vault plus the `claude-obsidian` Claude Code
   plugin. Drop in a source, ask a question, get an answer cited to your own notes.
2. **Interface** — a small local service (`setup/03-telegram-bridge/`) that lets you
   message your assistant from your phone and get real answers back.
3. **Replication** — Syncthing (`setup/04-syncthing.md`), so the vault stays
   mirrored across your laptop, desktop, or a home server with no cloud account.

They connect only through files on disk, so you can set up any one of them, or all
three, in any order.

---

## Install order

1. Copy this whole folder somewhere permanent — e.g. `C:\hinf-assistant-kit` on
   Windows, or `~/hinf-assistant-kit` on macOS/Linux.
2. Install Claude Code and sign in: <https://code.claude.com/docs>
3. In this folder, copy `CLAUDE.bootstrap.md` to a new file named `CLAUDE.md`.
4. Open the folder in Claude Code and say: `run onboarding`
5. Answer the interview. Claude writes your real `CLAUDE.md`, sets up the vault,
   installs the plugins, and — if you want them — wires up Telegram and Syncthing.
   It checks with you before each step.

Everything after that lives in the **project directory** you choose during the
interview (default `C:\<assistant-name>` or `~/<assistant-name>`), not in this
kit folder.

---

## One thing to understand before you set up Telegram

The phone bridge runs Claude Code automatically whenever you text it. It can be
configured two ways:

- **`acceptEdits`** (the kit's default) — Claude applies file edits but still
  stops to confirm other sensitive actions.
- **`bypassPermissions`** — Claude runs with **no permission prompts at all**.
  Convenient, and a real risk if your bot token leaks or the owner lock is
  misconfigured.

The friend whose setup this is based on chose `bypassPermissions` deliberately,
for their own machine. Treat that as a decision to make once you understand the
bridge — not a default to copy. Full explanation in
`setup/03-telegram-bridge/SETUP.md`.

---

## What's in here

<!-- file map added at the end of the build (Task 9) -->

---

## Getting help

Ask the classmate who gave you this kit. The design reasoning lives in their copy
of the plan and spec.
