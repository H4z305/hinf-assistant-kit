# 01 — Claude Code plugins

Plugins add skills, agents, and MCP servers to Claude Code. Add them with
`/plugin` inside an interactive `claude` session, or `claude plugin` on the CLI.

> MCP servers that need OAuth (GitHub, Google, etc.) must be authorised in an
> interactive session or through claude.ai → Settings → Connectors. They cannot
> be authorised from a headless run (like the Telegram bridge).

## Marketplaces to add

```
/plugin marketplace add anthropics/claude-plugins-official
/plugin marketplace add obra/superpowers-marketplace
/plugin marketplace add AgriciDaniel/claude-obsidian
```

(The third one is used in `02-second-brain.md`.)

## Recommended plugins

| Plugin | Why |
|---|---|
| `superpowers` | Brainstorming, writing plans, TDD, systematic debugging — structured workflows for real work. |
| `claude-md-management` | Audit and improve your `CLAUDE.md` as it grows. |
| `claude-code-setup` | Recommends hooks / subagents / skills for a given project. |
| `code-review` | Review a diff or PR for correctness and cleanup. |
| `pr-review-toolkit` | Deeper multi-angle review (tests, silent failures, type design). |
| `commit-commands` | `/commit`, `/commit-push-pr` — tidy git flow. |
| `feature-dev` | Guided feature development with codebase understanding. |
| `plugin-dev` | Build your own plugins, skills, hooks, agents later. |
| `skill-creator` | Create and test your own skills. |
| `math-olympiad` | Optional — adversarially-verified proofs, good ML-maths practice. |

## Bioinformatics / research bundle — highest value for your goals

The `bio-research` plugin group. It provides MCP servers:

- **PubMed** — search articles, fetch metadata and full text, find related work.
- **bioRxiv / medRxiv** — preprint search by date, category, funder.
- **ClinicalTrials.gov** — trials by condition, sponsor, eligibility; endpoint analysis.
- **ChEMBL** — compounds, targets, bioactivity (IC50/Ki), mechanisms, ADMET.
- **Open Targets** — target–disease association data via GraphQL.
- **Consensus** — evidence-weighted answers with paper citations.

and skills:

- `nextflow-development` — build and run Nextflow pipelines.
- `single-cell-rna-qc` — scRNA-seq quality control walkthrough.
- `scvi-tools` — probabilistic single-cell modelling.
- `instrument-data-to-allotrope` — convert instrument output to the Allotrope format.
- `scientific-problem-selection` — pick tractable research problems.

Some sub-servers (BioRender, Synapse, Wiley) need their own accounts and are
optional — skip them until you have a reason.

## Verify

```
claude plugin list
```

Then in a chat, `/help` should list the new skills (`/wiki`, `/brainstorming`,
the `bio-research` skills, …).
