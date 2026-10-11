# Folders live in two plain files next to Claude's data

---
status: accepted (2026-10-11)
---

Folders are stored in `~/.claude/session-folders.json` (the user's choices, changed only by a user
action) and a generated `~/.claude/session-folders.index.json` (folders with each session's title,
project and transcript path, rewritten whole after every scan). We chose plain files over VS Code's
private extension storage, which is what the official extension uses for its groups, because agents
and scripts must be able to read which sessions belong together. They are two files, not one, so a
rescan can never overwrite a user's edit. Both carry `"version": 1`; a version the extension doesn't
know puts it in read-only mode instead of overwriting.

## Considered Options

- VS Code globalState: simplest, but invisible to agents and other tools.
- One combined file: one writer would rewrite generated data and user choices together, so a stale
  rescan could drop an edit.
- A file per repository: sessions are personal and span projects, so a per-repo file splits a
  ticket's sessions apart.

## Consequences

- Renaming these files or changing their shape after release breaks agents that read them; any
  change bumps `version` and keeps reading version 1.
- Claude Code's retention sweep only deletes listed paths (transcripts, file-history, plans and so
  on), not these root-level files.
