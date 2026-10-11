# Never modify, move or delete sessions

---
status: accepted (2026-10-11)
---

The extension only reads Claude Code's transcripts; its only writes are its own choices file and
index. Other session managers offer move, rename-on-disk, split and cleanup, and those are the
features most likely to cost someone their history, which is the one thing a user can't get back.
Folder membership lives in our own file instead. A test fails the build if any code outside the
storage module can write, rename or delete files, and every release is first run against copies of
real sessions with every real transcript fingerprinted before and after.

## Consequences

- No "clean up empty sessions" or "move to another project" features, ever.
- Opening a session hands it to Claude Code, which does write. So opening is guarded: a running
  session asks first, and a session from another project opens in its own window.
- Claude Code's own retention can still delete transcripts; the extension warns about it and keeps
  showing a deleted filed session by its title.
