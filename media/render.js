(function (root) {
  const DAY = 24 * 60 * 60 * 1000;
  // The header byline: the author's website and LinkedIn profile.
  const SITE = 'https://devak-mehta.vercel.app';
  const LINKEDIN = 'https://www.linkedin.com/in/devak-mehta';

  // Claude Code deletes session files older than cleanupPeriodDays when it starts.
  function retentionNotice(days) {
    return days < 365 ? `Claude Code deletes sessions after ${days} days, including ones in your folders.` : null;
  }

  // Desktop and Cowork sessions are kept at any age, so they never get the warning.
  function deletionWarning(session, days, now) {
    if (session.entrypoint === 'claude-desktop') return null;
    const left = (session.lastActive + days * DAY - now) / DAY;
    if (left > 7) return null;
    if (left <= 0) return 'deleted when Claude Code next starts';
    const n = Math.ceil(left);
    return `deleted in ${n} day${n === 1 ? '' : 's'}`;
  }

  // Titles come from transcripts and can contain anything: everything user-visible goes through here.
  function esc(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  // Folder colors; anything else in a hand-edited file shows as no color.
  const COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'none'];

  function age(ms) {
    const min = Math.floor(ms / 60000);
    if (min < 1) return 'now';
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h} h`;
    const d = Math.floor(h / 24);
    return `${d} day${d === 1 ? '' : 's'}`;
  }

  // Last part of cwd, for Windows and POSIX paths alike.
  const project = (cwd) => (cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() : '');

  // data-vscode-context feeds VS Code's native right-click menu (webview/context). A selected row
  // carries the whole selection, so the menu acts on all of it.
  function menuContext(section, folderId, sessionIds) {
    const context = { webviewSection: section };
    if (folderId) context.folderId = folderId;
    if (sessionIds) context.sessionIds = sessionIds;
    context.preventDefaultContextMenuItems = true;
    return `data-vscode-context="${esc(JSON.stringify(context))}"`;
  }

  // folderId: the folder this row is shown in, or null for Unfiled.
  function row(s, ctx, folderId) {
    const filed = folderId !== null;
    const sel = ctx.selected.container === (folderId || 'unfiled') && ctx.selected.ids.includes(s.id);
    const ids = sel ? ctx.selected.ids : [s.id];
    if (s.deleted) {
      return `<div class="row gone" data-session="${esc(s.id)}" ${menuContext('deletedSession', folderId, ids)} title="${esc(`${s.title}\n${s.id}`)}">`
        + `<span class="idle"></span><span class="t">${esc(s.title)}</span>${actions([['remove', 'Remove']])}</div>`;
    }
    const mark = ctx.running.has(s.id) ? 'live' : 'idle';
    const where = (ctx.inFolders.get(s.id) || []).join(', ');
    const tip = [s.title, where && `In: ${where}`, s.cwd, s.id].filter(Boolean).join('\n');
    const meta = [age(ctx.now - s.lastActive), project(s.cwd)].filter(Boolean).join(' · ');
    const warning = deletionWarning(s, ctx.retentionDays, ctx.now);
    const section = filed ? 'filedSession' : 'unfiledSession';
    return `<div class="row${sel ? ' sel' : ''}" data-session="${esc(s.id)}" data-action="open" tabindex="0" draggable="true"`
      + ` aria-selected="${sel}" ${menuContext(section, folderId, ids)} title="${esc(tip)}">`
      + `<span class="${mark}"></span><span class="t">${esc(s.title)}</span><span class="m">${esc(meta)}</span>`
      + (s.entrypoint === 'sdk-cli' ? '<span class="tag">headless</span>' : '')
      + (filed && warning ? `<span class="warn">${esc(warning)}</span>` : '')
      + actions(filed ? [['move', 'Move'], ['remove', 'Remove']] : [['add', 'Add']])
      + '</div>';
  }

  // Small buttons shown on hover / focus. Labels are fixed text, never user input.
  function actions(list) {
    return `<span class="acts">${list.map(([action, label]) => `<button data-action="${action}">${label}</button>`).join('')}</span>`;
  }

  // The health line (only when 10% or more can't be read) and the retention notice.
  function notices(state) {
    const out = [];
    const { sessions, unreadable } = state.health;
    if (sessions > 0 && unreadable / sessions >= 0.1) {
      out.push(`<p class="notice">${esc(`Couldn't read ${unreadable} of ${sessions} sessions — the session format may have changed.`)}</p>`);
    }
    const retention = retentionNotice(state.retentionDays);
    if (retention) {
      out.push(`<p class="notice">${esc(retention)} <button class="link" data-action="openSettings">Open settings</button></p>`);
    }
    return out.join('');
  }

  function folder(f, ctx) {
    const color = COLORS.includes(f.color) ? f.color : 'none';
    const open = !ctx.collapsed.has(f.id);
    return `<section class="folder" data-folder="${esc(f.id)}">`
      + `<div class="fh" role="button" tabindex="0" data-action="toggle" aria-expanded="${open}" ${menuContext('folder', f.id)}>`
      + `<span class="dia c-${color}"></span><span class="fname">${esc(f.name)}</span>`
      + `<span class="count">${f.sessions.length}</span>`
      + actions([['rename', 'Rename'], ['color', 'Color'], ['delete', 'Delete']])
      + '</div>'
      + (open ? f.sessions.map((s) => row(s, ctx, f.id)).join('') : '')
      + '</section>';
  }

  // ui: per-viewer view state kept by the webview (collapsed folder ids, the current selection).
  function render(state, ui = {}) {
    const inFolders = new Map();
    for (const f of state.view.folders) {
      for (const s of f.sessions) inFolders.set(s.id, [...(inFolders.get(s.id) || []), f.name]);
    }
    const ctx = {
      running: new Set(state.running), now: state.now, retentionDays: state.retentionDays, inFolders,
      collapsed: new Set(ui.collapsed || []),
      selected: ui.selected || { container: null, ids: [] },
    };
    return '<header class="head"><span class="arcr" aria-hidden="true"></span>'
      + '<span class="brand"><span class="title">Session Folders</span><span class="byline">'
      + `<a class="by" href="${SITE}" title="Devak Mehta's website">by devakmmm &#8599;</a><span class="sep">·</span>`
      + `<a class="by" href="${LINKEDIN}" title="Devak Mehta on LinkedIn">LinkedIn &#8599;</a></span></span>`
      + `<span class="livecount">${ctx.running.size} LIVE</span></header>`
      + notices(state)
      + (state.readOnly ? readOnlyMessage(state.readOnly) : body(state, ctx));
  }

  // The folders file couldn't be read, so nothing is shown as filed and nothing is saved.
  function readOnlyMessage(reason) {
    return `<p class="notice" title="${esc(reason)}">Folders file is busy or unreadable — not saving anything until it can be read.</p>`;
  }

  function body(state, ctx) {
    return '<div class="body">'
      + '<button class="new" data-action="newFolder">New folder</button>'
      + (state.view.folders.length ? '' : '<p class="hint">No folders yet. Create one, then add sessions to it.</p>')
      + state.view.folders.map((f) => folder(f, ctx)).join('')
      + `<div class="label">Unfiled <span class="count">${state.view.unfiled.length}</span></div>`
      + state.view.unfiled.map((s) => row(s, ctx, null)).join('')
      + '</div>';
  }

  const api = { render, retentionNotice, deletionWarning, project };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SessionFoldersRender = api;
})(this);
