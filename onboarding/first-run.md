# First-Run Onboarding Runbook

You (Claude Code) are executing this for a user who just opened the HINF
Assistant Kit for the first time. Work through the numbered sections **in
order, one at a time**. After each section, stop, show what you did or are
about to do, and wait for the user to confirm before continuing.

**Never invent an answer.** If the user says "skip" to any interview question,
write `<!-- TODO: <the question text> -->` where that answer would have gone,
and move on.

Every generative step checks for an existing file first and asks before
overwriting.

---

## 1. Explain what's about to happen

Tell the user, briefly:

- There's a short interview (identity, then context, then comms).
- Then you write their `CLAUDE.md`, copy the vault into place, and — with
  their approval at each step — install the Claude Code plugins and optionally
  set up the Telegram bridge and Syncthing.
- Nothing is sent anywhere. Everything stays on their machine.
- Any question can be answered "skip".

Wait for "go" before starting the interview.

---

## 2. Interview — identity

Ask these **one at a time**. Record each answer against the placeholder token
shown.

1. "What should the assistant be called?" → `<<ASSISTANT_NAME>>`
2. "Where should the project live? Default is `C:\<name>` on Windows or
   `~/<name>` on macOS/Linux — press enter to accept or give a path." →
   `<<PROJECT_DIR>>`. Then set `<<VAULT_PATH>>` = `<<PROJECT_DIR>>/second-brain`.
3. "Tone — warm, neutral, or blunt?" → `<<TONE>>`
4. "Pushback — should it challenge your decisions hard, or mostly defer to
   you?" → `<<STRICTNESS>>`
5. "Initiative — proactive (suggests next steps unprompted) or reactive
   (waits to be asked)?" → `<<PROACTIVITY>>`
6. "Your pronouns?" → `<<USER_PRONOUNS>>`
7. "Any contexts where you want replies in Arabic — e.g. family documents? If
   not, I'll set English only." → `<<LANGUAGE_NOTE>>` (if none:
   `Reply in English.`)

Show the collected answers back as a list and confirm before section 3.

---

## 3. Interview — context

Ask one at a time:

1. "What OS and shell are you on?" — you may detect it and just confirm.
2. "Is Node.js installed?" — run `node -v` yourself and report the result.
   Record whether it's present and the version.
3. "Which HINF level are you in right now?" → `<<CURRENT_LEVEL>>`
4. "What's your term code? e.g. `2026-473`" → `<<TERM_CODE>>`
5. "Which specialty and college electives have you picked, or plan to?" — show
   the two elective pools from `program-context/hinf-degree-roadmap.md` so they
   can choose from the list. → `<<ELECTIVES>>`
6. "The vault ships with three seeded areas: `HINF Degree`, `Bioinformatics`,
   `AI-ML`. Keep all three, rename any, or drop any?" — apply their answer when
   you place the vault in section 6.

Confirm before section 4.

---

## 4. Interview — comms

Ask:

1. "Set up the Telegram bridge now, or leave it for later? (It lets you
   message the assistant from your phone.)"
2. "Set up Syncthing now, or later? It needs a second device already running
   Syncthing — if you don't have one yet, choose later."

Record both as now / later. Confirm before section 5.

---

## 5. Generate `CLAUDE.md`

1. If `<<PROJECT_DIR>>/CLAUDE.md` already exists: show the user a diff of what
   you're about to write against it, and ask before overwriting.
2. Copy `onboarding/CLAUDE.template.md` to `<<PROJECT_DIR>>/CLAUDE.md`.
3. Replace every `<<TOKEN>>` with the interview answer. For any skipped answer,
   write `<!-- TODO: <the question> -->` instead of the token.
4. Build `<<COMMS_SECTION>>`:
   - Telegram = now → line: `Telegram bridge configured; source in setup/03-telegram-bridge/.`
   - Telegram = later → `<!-- TODO: Telegram bridge not set up. See setup/03-telegram-bridge/SETUP.md -->`
   - Syncthing = now → line: `Syncthing configured for the vault. See setup/04-syncthing.md.`
   - Syncthing = later → `<!-- TODO: Syncthing not set up. See setup/04-syncthing.md -->`
   Put both lines (or both TODOs) into the section.
5. Also update the vault's own `second-brain/CLAUDE.md` (after section 6 copies
   it): replace `**Owner:** <!-- TODO: your name -->` with the user's name if
   they gave one.
6. Show the finished `<<PROJECT_DIR>>/CLAUDE.md` in full and get an explicit
   "approved" before continuing.

---

## 6. Place the vault

1. Ask where the vault should live (default `<<PROJECT_DIR>>/second-brain`).
2. If the destination exists and is non-empty: stop, show what's there, ask
   before merging.
3. Copy the kit's `second-brain/` directory to that path.
4. Apply the section 3 question 6 answer: rename or delete the seed area
   folders under `wiki/areas/` as the user asked. If renamed, update the links
   in `wiki/index.md`.
5. Confirm `wiki/index.md` still shows `Sources ingested: 0` and
   `.vault-meta/mode.json` still says `"mode": "para"`.

---

## 7. Install plugins

1. Open `setup/01-plugins.md` and work through it with the user, section by
   section, confirming each marketplace add and plugin install.
2. Open `setup/02-second-brain.md`: add the `AgriciDaniel/claude-obsidian`
   marketplace, install the `claude-obsidian` plugin, and make sure the
   `Path:` line in the "The vault (second brain)" section of
   `<<PROJECT_DIR>>/CLAUDE.md` is the absolute path to the vault you placed in
   section 6.

---

## 8. Comms, if elected

- Telegram = now → open `setup/03-telegram-bridge/SETUP.md` and follow it end
  to end.
- Syncthing = now → open `setup/04-syncthing.md` and follow it.
- Either one deferred → do nothing here; the TODO is already in
  `<<PROJECT_DIR>>/CLAUDE.md`.

---

## 9. First log entry

Append to `<<PROJECT_DIR>>/second-brain/wiki/log.md`, under a dated heading for
today, a short bullet list: what was configured (assistant name, plugins,
Telegram/Syncthing if done) and what was deferred.

---

## 10. Hand off

1. Replace the kit-root `CLAUDE.md` (the bootstrap copy) with a one-line
   pointer: `See <<PROJECT_DIR>>/CLAUDE.md` — or delete it if the project dir
   *is* the kit root.
2. Tell the user onboarding is done. List every open `<!-- TODO -->` you left,
   so they know what's still unset.
