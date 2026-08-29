# 05 — Connectors (optional)

Connectors let your assistant read and act on data outside your machine. They're
enabled on **claude.ai → Settings → Connectors**, and they apply everywhere you
use Claude with that account — not just this project. None are required for the
kit. Enable only what you actually want the assistant touching.

| Connector | What it gives the assistant | Tradeoff |
|---|---|---|
| **Gmail** | Search threads, summarise your inbox, draft replies (you send them). | Claude can read your mail. |
| **Google Calendar** | See your schedule, spot conflicts, suggest and create events. | Claude can read and write calendar entries. |
| **Google Drive** | Read and search your documents. | Claude can read Drive files you grant. |

## Notes

- Authorisation is an OAuth flow in the browser. It can't be done from a
  headless run (so the Telegram bridge can't authorise a connector — do it once
  in an interactive session and it carries over).
- Each connector's tools show up as `mcp__...` tools inside Claude Code.
- To revoke: same Connectors settings page, or your Google account's
  **Security → Third-party access**.
- The daily brief (`setup/03-telegram-bridge/`) becomes much more useful with
  Calendar + Gmail connected — that's what it reads to build the "CALENDAR" and
  "INBOX" sections.
