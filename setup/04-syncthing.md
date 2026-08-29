# 04 — Syncthing (vault replication)

## Purpose

Keep the `second-brain/` vault byte-identical across your devices — laptop,
desktop, a home server — with no cloud account and no third party holding your
notes. Syncthing is open-source, peer-to-peer, and encrypted in transit.

If you only have one device right now, skip this. Onboarding leaves a
`<!-- TODO -->` in your `CLAUDE.md` and you can come back to it.

## Install

<https://syncthing.net/downloads/> — there's a build for every OS.

- **Windows:** SyncTrayzor is a convenient tray wrapper around it.
- **macOS:** `brew install syncthing` then `brew services start syncthing`.
- **Linux:** your package manager, or the release tarball; enable the
  `syncthing@<user>` systemd unit.

Syncthing opens a local web UI at <http://127.0.0.1:8384>.

## Share the vault

On **device A** (the one with your real vault):

1. Web UI → **Add Folder**.
2. Folder Path: your `second-brain/` directory.
3. Folder ID: something memorable like `secondbrain`.
4. Save.

## Pair device B

1. On **device B**: Web UI → **Actions → Show ID**. Copy the long device ID.
2. On **device A**: **Add Remote Device**, paste B's ID, and on the **Sharing**
   tab tick the `secondbrain` folder. Save.
3. On **device B**: a prompt appears to accept the new device, then another to
   accept the `secondbrain` folder — set its path and accept.
4. Repeat for any further devices.

## `.stignore`

Put this file at the root of the vault (`second-brain/.stignore`) so machine
junk doesn't sync:

```
node_modules
.env
*.log
.obsidian/workspace*.json
.vault-meta/locks
```

## Conflicts

Syncthing never overwrites blindly. If the same file changed on two devices
before they synced, it keeps the other version as
`<name>.sync-conflict-<date>-<device>.md`. Vault content is plain Markdown, so
resolving one is a quick manual merge and delete.

**Don't run the Telegram bridge writing to the vault (`/log`, or Claude editing
notes) on two machines at the same time.** Pick one "primary" machine for the
bridge.
