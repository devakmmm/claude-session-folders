# Session Folders for Claude Code

Keep Claude Code sessions about the same idea, build or ticket together, in named, colored
folders in the VS Code sidebar. Nothing about your sessions changes: the folders are a separate
list that points at them.

## What you get

- **Folders you make yourself.** Create a folder, give it a name and a color, and add the
  sessions that belong to it. A session can be in more than one folder.
- **Every other session underneath**, newest first, so the one you just worked on is at the top.
- **Click to reopen.** Clicking a session opens it in a Claude tab, or switches to it if it is
  already open. A session from another project offers to open that project in its own window,
  and a session that is running somewhere else asks before opening a second copy.
- **Live sessions marked.** Sessions that are running right now show a pulsing diamond, and the
  header counts them.
- **A warning before Claude Code deletes old sessions.** See [Old sessions](#old-sessions).

## Using it

Open the **Session Folders** view in the activity bar, then:

| To | Do this |
|---|---|
| Make a folder | **New folder** in the sidebar, or the folder button in the view's title bar |
| File a session | Hover it and click **Add**, drag it onto a folder, or right-click → **Add to Folder…** |
| File the session you are in | **Add This Session to a Folder…** in a Claude tab's title bar or the command palette |
| Move or remove | Hover a filed session → **Move** / **Remove**, drag it to another folder, or right-click |
| Rename, recolor, delete a folder | Hover the folder name, or right-click it |
| Work on several at once | Ctrl/Cmd-click or Shift-click sessions, then drag or use any action |

Deleting a folder asks first and never touches the sessions in it.

## Your sessions are never modified

The extension only reads Claude Code's session files. It never writes, moves, renames or deletes
anything under `~/.claude/projects`, and a test in this repository fails if any code other than
the one file that saves your folders can write to disk. It writes exactly two files of its own, next to Claude
Code's data:

- `~/.claude/session-folders.json` — your folders (names, colors, which sessions are in them).
- `~/.claude/session-folders.index.json` — a generated summary for agents (below).

If the folders file can't be read (for example while antivirus or a sync tool holds it), the
sidebar says so and saves nothing until it can be read again, so it never overwrites what it
couldn't read.

## Old sessions

Claude Code deletes session files older than its `cleanupPeriodDays` setting (30 days by default)
when it starts, including sessions you have put in folders. When that setting is under 365 days the
sidebar shows a notice with an **Open settings** button, and a filed session within 7 days of
deletion says so. To keep sessions for a year, set this in `~/.claude/settings.json`:

```json
{ "cleanupPeriodDays": 365 }
```

The extension never edits that file for you. Sessions from Claude Desktop are kept at any age, so
they are never warned about.

## For agents: the index file

`~/.claude/session-folders.index.json` is rewritten every time the sidebar refreshes and after every folder change. It
lists each folder with its sessions' ids, titles, working folders, transcript paths and last
activity, so an agent can find all the context for one idea. Only filed sessions appear. It is safe
to delete; it is rebuilt on the next refresh. Example (made-up values):

```json
{
  "version": 1,
  "generatedAt": "2026-10-11T15:04:05.000Z",
  "generator": "claude-session-folders 0.1.0",
  "note": "Generated. Do not edit; folders live in session-folders.json.",
  "folders": [
    {
      "id": "5b1e0c3a-…",
      "name": "Login page",
      "color": "orange",
      "sessions": [
        {
          "id": "4929ce25-…",
          "title": "Fix flaky test",
          "cwd": "/home/me/work/api",
          "file": "/home/me/.claude/projects/-home-me-work-api/4929ce25-….jsonl",
          "lastActive": "2026-10-09T18:22:41.000Z"
        },
        { "id": "0263bd4d-…", "title": "Old release notes", "deleted": true }
      ]
    }
  ],
  "health": { "sessions": 120, "unreadable": 0 },
  "retentionDays": 365
}
```

A session marked `"deleted": true` was in the folder but Claude Code has since deleted its file.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `sessionFolders.claudeDir` | empty (`~/.claude`) | Claude Code's data folder, if yours is somewhere else |

## Requirements

Opening sessions uses the official Claude Code extension. Without it, clicking a session offers
to copy `claude --resume <id>` so you can resume it yourself.

## Privacy

Everything stays on your machine. The extension makes no network requests and collects nothing.
It reads Claude Code's session transcripts in `~/.claude/projects`, its list of running sessions
in `~/.claude/sessions/*.json` (never the `*.key` files next to them), and `cleanupPeriodDays`
from `~/.claude/settings.json`.

## Author

Made by Devak Mehta: [GitHub](https://github.com/devakmmm) · [LinkedIn](https://www.linkedin.com/in/devak-mehta).

## Not affiliated with Anthropic

This is an independent community project. It is not made, endorsed or supported by
Anthropic. "Claude" and "Claude Code" are trademarks of Anthropic.

## License

[MIT](LICENSE)
