// PURE: every operation returns a new choices object and never changes the one it got.
// Nothing here touches the disk; store.js saves the result.
const crypto = require('node:crypto');

function newFolder(choices, name, color) {
  const folder = { id: crypto.randomUUID(), name, color, sessions: [] };
  return { ...choices, folders: [...choices.folders, folder] };
}

function updateFolder(choices, folderId, change) {
  return { ...choices, folders: choices.folders.map((f) => (f.id === folderId ? change(f) : f)) };
}

function renameFolder(choices, folderId, name) {
  return updateFolder(choices, folderId, (folder) => ({ ...folder, name }));
}

function setColor(choices, folderId, color) {
  return updateFolder(choices, folderId, (folder) => ({ ...folder, color }));
}

// Removes the folder only. Sessions are never touched; the same session in other folders stays.
function deleteFolder(choices, folderId) {
  return { ...choices, folders: choices.folders.filter((f) => f.id !== folderId) };
}

// entries: [{ id, title }]. A session keeps the title it had when it was first filed here.
function add(choices, entries, folderId) {
  return updateFolder(choices, folderId, (folder) => {
    const filed = new Set(folder.sessions.map((s) => s.id));
    const fresh = entries.filter((e) => !filed.has(e.id)).map(({ id, title }) => ({ id, title }));
    return { ...folder, sessions: [...folder.sessions, ...fresh] };
  });
}

function remove(choices, ids, folderId) {
  return updateFolder(choices, folderId, (folder) => ({
    ...folder, sessions: folder.sessions.filter((s) => !ids.includes(s.id)),
  }));
}

function move(choices, ids, fromId, toId) {
  const from = choices.folders.find((f) => f.id === fromId);
  const entries = from ? from.sessions.filter((s) => ids.includes(s.id)) : [];
  return add(remove(choices, ids, fromId), entries, toId);
}

const newestFirst = (a, b) => b.lastActive - a.lastActive;

// What the sidebar shows. A filed session whose file is gone (Claude Code deleted it) stays
// visible as "(deleted) <title when filed>" so nothing silently disappears; it can still be removed.
function buildView(choices, sessions) {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const view = choices.folders.map((folder) => {
    const live = folder.sessions.filter((e) => byId.has(e.id)).map((e) => byId.get(e.id)).sort(newestFirst);
    const deleted = folder.sessions.filter((e) => !byId.has(e.id))
      .map((e) => ({ id: e.id, title: `(deleted) ${e.title}`, deleted: true }));
    return { id: folder.id, name: folder.name, color: folder.color, sessions: [...live, ...deleted] };
  });
  const newest = (folder) => (folder.sessions[0] && !folder.sessions[0].deleted ? folder.sessions[0].lastActive : null);
  view.sort((a, b) => {
    const na = newest(a);
    const nb = newest(b);
    if (na !== null && nb !== null) return nb - na;
    if (na !== null || nb !== null) return na !== null ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const filed = new Set(choices.folders.flatMap((f) => f.sessions.map((e) => e.id)));
  const unfiled = sessions.filter((s) => !filed.has(s.id)).sort(newestFirst);
  return { folders: view, unfiled };
}

module.exports = { newFolder, renameFolder, setColor, deleteFolder, add, remove, move, buildView };
