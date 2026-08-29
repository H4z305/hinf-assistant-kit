---
type: meta
title: "Getting Started"
updated: 2026-08-29
tags: [meta, onboarding]
status: evergreen
related: ["[[index]]", "[[overview]]"]
---

# Getting Started

A second brain built on the `claude-obsidian` pattern in PARA mode.

## Daily use

| Say this | Claude does this |
|---|---|
| `ingest [file]` | Reads a source dropped in `.raw/`, builds linked wiki pages under the right PARA folder |
| `what do you know about X?` | Reads the index and hot cache, answers with citations to your notes |
| `/save` | Files the current conversation as a note (lands in `wiki/projects/inbox/` for triage) |
| `/autoresearch [topic]` | Runs search, fetch, and synthesis on its own, files results in `wiki/resources/<topic>/` |
| `lint the wiki` | Finds orphan pages, dead links, stale claims |
| `update hot cache` | Refreshes [[hot]], the short-term context summary read first each session |

## Where things live

- `wiki/projects/` — active work with a deadline and an outcome
- `wiki/areas/` — ongoing responsibilities, no end date
- `wiki/resources/` — reference material by topic
- `wiki/archives/` — finished/closed work

See [[overview]] for the current map and [[index]] for the full catalog.
