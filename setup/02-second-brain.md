# 02 — Second brain (claude-obsidian + the vault)

## Install the plugin

```
/plugin marketplace add AgriciDaniel/claude-obsidian
/plugin install claude-obsidian
```

Source and full docs: <https://github.com/AgriciDaniel/claude-obsidian> (MIT).

## Use the vault

This kit already ships a scaffolded, empty PARA vault at `second-brain/`.
Onboarding copies it into your project directory. That's the recommended path —
you keep the three seeded areas (`HINF Degree`, `Bioinformatics`, `AI-ML`) and
start ingesting straight away.

If you'd rather start from the plugin's own scaffold: delete the copied
`second-brain/` folder and run `/wiki` — it builds the PARA structure fresh and
walks you through mode selection.

## Set the methodology mode

The shipped vault is already PARA (`.vault-meta/mode.json` → `"mode": "para"`).
To confirm or change:

```
bash bin/setup-mode.sh
```

## Point your assistant at the vault

In `<your project dir>/CLAUDE.md`, the "The vault (second brain)" section has a
`Path:` line. It must be the **absolute path** to the copied vault, e.g.
`C:/my-assistant/second-brain`. Onboarding sets this; check it if you moved the
vault later.

## Open it in Obsidian (optional)

Obsidian → **Open folder as vault** → select the `second-brain/` directory. You
get the graph view and editor; Claude and Obsidian edit the same Markdown files.

## Routine

- Drop a source in `.raw/`, then say `ingest <filename>`.
- Ask questions normally — Claude reads `wiki/index.md` and `wiki/hot.md` first,
  then drills in, and cites the pages it used.
- Say `lint the wiki` every 10–15 ingests to catch orphan pages and dead links.
- Say `update hot cache` at the end of a session so the next one starts with
  context.

## Verify

In a chat: `what do you know about my degree plan?`

Claude should read `program-context/hinf-degree-roadmap.md` (via the vault path
in your `CLAUDE.md`) and answer with a citation to that file.
