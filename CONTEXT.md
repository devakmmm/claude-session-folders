# Session Folders for Claude Code

A VS Code extension that lets you keep related Claude Code sessions together in folders you name
and color, without ever changing the sessions themselves.

## Language

### Claude Code's side (read, never written)

**Session**:
One Claude Code conversation, identified by a session id and stored as one transcript.
_Avoid_: Conversation, chat, thread

**Transcript**:
The file `~/.claude/projects/<project-folder>/<session-id>.jsonl` that holds a session.
_Avoid_: Log, history file

**Project**:
The working folder (`cwd`) a session ran in.
_Avoid_: Repo, workspace (a workspace is VS Code's open folder; a session's project may differ)

**Running session**:
A session Claude Code lists in its running-session list (`~/.claude/sessions/*.json`) right now.
_Avoid_: Active, live, open

**Retention**:
Claude Code's `cleanupPeriodDays`: transcripts older than this are deleted at startup.
_Avoid_: Expiry, TTL

**Forked session**:
A new session made from an old one with `--fork-session`; it gets a new id.
_Avoid_: Copy, branch

### This extension's side

**Folder**:
A named, colored set of sessions the user made.
_Avoid_: Group (the official Claude Code extension's term), tag, collection

**Filed session**:
A session that is in at least one folder.

**Unfiled**:
Every session that is in no folder, shown as one flat list, newest first.
_Avoid_: Inbox, uncategorized

**Deleted session**:
A filed session whose transcript no longer exists (usually removed by retention); shown by the
title it had when it was filed.
_Avoid_: Missing, broken

**Choices file**:
`~/.claude/session-folders.json`, the user's folders; changed only by a user action.

**Index**:
`~/.claude/session-folders.index.json`, generated for agents; rewritten whole, never edited.

## Relationships

- A **Session** has exactly one **Transcript** and one **Project**.
- Resuming a **Session** continues the same **Transcript**; a **Forked session** starts a new one.
- A **Folder** holds zero or more **Sessions**; a **Session** can be in several **Folders**.
- A **Session** in no **Folder** is **Unfiled**.
- **Retention** can turn a **Filed session** into a **Deleted session**; the extension never does.
- The **Index** is derived from the **Choices file** plus the current **Transcripts**.

## Example dialogue

> **Dev:** "If I resume a filed **Session** tomorrow, do I have to file it again?"
> **Domain expert:** "No. Resuming continues the same **Transcript**, so it stays in its **Folder**.
> Only a **Forked session** gets a new id, and that one starts **Unfiled**."
> **Dev:** "And if **Retention** deletes it?"
> **Domain expert:** "It becomes a **Deleted session**: still listed in the **Folder** under the title
> it had when you filed it, so you know what was lost. The extension itself never deletes anything."

## Flagged ambiguities

- "group" means the official Claude Code extension's per-workspace groups; this extension says
  **Folder** everywhere so the two are never confused.
- "open" was used for both "shown in a Claude tab" and "running somewhere"; resolved: a session is
  **running** when Claude Code lists it as running; a Claude tab may or may not be showing it.
- "project" vs "workspace": a **Project** belongs to the session; the workspace is whatever folder
  VS Code has open. Sessions from another **Project** are opened in their own window.
