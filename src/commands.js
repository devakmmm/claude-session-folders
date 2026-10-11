// What the user can do. Every folder change goes through store.update; nothing
// here writes a file itself, opens a terminal, or runs `claude`. Takes `vscode` as a parameter so
// it can be tested with a fake.
const path = require('node:path');
const store = require('./store');
const folders = require('./folders');
const { project } = require('../media/render');

// The official Claude Code extension's open command and its tab's webview type.
const OPEN_COMMAND = 'claude-vscode.primaryEditor.open';
const CLAUDE_PANEL = 'claudeVSCodePanel';
const RECENT_MS = 60 * 1000;
const WHERE = { 'claude-vscode': 'VS Code', cli: 'a terminal', 'claude-desktop': 'Claude Desktop', 'sdk-cli': 'a script' };

const COLORS = [
  ['Red', 'red'], ['Orange', 'orange'], ['Yellow', 'yellow'], ['Green', 'green'],
  ['Blue', 'blue'], ['Purple', 'purple'], ['No color', 'none'],
];

// deps: { claudeDir(), latest() -> { sessions, running, runningKnown }, refresh(), now() }
function createCommands(vscode, deps) {
  const { window } = vscode;

  // Applies one folder operation. In read-only mode nothing is saved and the user is told why.
  async function save(op) {
    const result = store.update(deps.claudeDir(), op);
    if (result.readOnly) {
      window.showWarningMessage('Folders file is busy or unreadable — not saving anything until it can be read.');
      return null;
    }
    await deps.refresh();
    return result.choices;
  }

  async function pickColor() {
    const pick = await window.showQuickPick(COLORS.map(([label, color]) => ({ label, color })), { placeHolder: 'Folder color' });
    return pick && pick.color;
  }

  // Returns the new folder's id, or undefined if the user backed out.
  async function newFolder() {
    const name = await window.showInputBox({
      prompt: 'Folder name',
      placeHolder: 'e.g. Login page redesign',
      validateInput: (value) => (value.trim() ? null : 'Enter a name'),
    });
    if (!name || !name.trim()) return undefined;
    const color = await pickColor();
    if (!color) return undefined;
    const choices = await save((c) => folders.newFolder(c, name.trim(), color));
    return choices ? choices.folders[choices.folders.length - 1].id : undefined;
  }

  function folderById(folderId) {
    const { choices } = store.readChoices(deps.claudeDir());
    return choices && choices.folders.find((x) => x.id === folderId);
  }

  // The one destructive action (no Undo in v0.1), so it confirms first. Sessions are never touched.
  async function deleteFolder(folderId) {
    const folder = folderById(folderId);
    if (!folder) return;
    const answer = await window.showWarningMessage(`Delete folder '${folder.name}'? Sessions are not touched.`, 'Delete');
    if (answer === 'Delete') await save((c) => folders.deleteFolder(c, folderId));
  }

  async function renameFolder(folderId) {
    const folder = folderById(folderId);
    if (!folder) return;
    const name = await window.showInputBox({
      prompt: 'Folder name',
      value: folder.name,
      validateInput: (value) => (value.trim() ? null : 'Enter a name'),
    });
    if (name && name.trim()) await save((c) => folders.renameFolder(c, folderId, name.trim()));
  }

  async function setFolderColor(folderId) {
    if (!folderById(folderId)) return;
    const color = await pickColor();
    if (color) await save((c) => folders.setColor(c, folderId, color));
  }

  async function removeFromFolder(ids, folderId) {
    await save((c) => folders.remove(c, ids, folderId));
  }

  // Folders in sidebar order (newest activity first), then "New folder…". Returns a folder id.
  async function pickFolder(excludeId) {
    const read = store.readChoices(deps.claudeDir());
    if (read.readOnly) {
      window.showWarningMessage('Folders file is busy or unreadable — not saving anything until it can be read.');
      return undefined;
    }
    const items = folders.buildView(read.choices, deps.latest().sessions).folders
      .filter((x) => x.id !== excludeId)
      .map((x) => ({ label: x.name, description: `${x.sessions.length} sessions`, id: x.id }));
    items.push({ label: '$(add) New folder…', create: true });
    const pick = await window.showQuickPick(items, { placeHolder: 'Choose a folder' });
    if (!pick) return undefined;
    return pick.create ? newFolder() : pick.id;
  }

  // Each session is filed with the title it has now.
  function entries(ids) {
    const byId = new Map(deps.latest().sessions.map((s) => [s.id, s]));
    return ids.map((id) => ({ id, title: byId.has(id) ? byId.get(id).title : id }));
  }

  // toId is known when the sessions were dropped on a folder; otherwise the user picks one.
  async function addToFolder(ids, toId) {
    const folderId = toId || await pickFolder();
    if (folderId) await save((c) => folders.add(c, entries(ids), folderId));
  }

  async function moveToFolder(ids, fromId, toId) {
    const folderId = toId || await pickFolder(fromId);
    if (folderId) await save((c) => folders.move(c, ids, fromId, folderId));
  }

  function inWorkspace(cwd) {
    return (vscode.workspace.workspaceFolders || []).some((ws) => {
      const rel = path.relative(ws.uri.fsPath, cwd);
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    });
  }

  // This workspace's sessions, newest first, so one Enter picks the session you are in.
  async function addCurrentSession() {
    const mine = deps.latest().sessions
      .filter((s) => s.cwd && inWorkspace(s.cwd))
      .sort((a, b) => b.lastActive - a.lastActive);
    if (!mine.length) {
      window.showInformationMessage('No Claude Code sessions for this workspace yet.');
      return;
    }
    const pick = await window.showQuickPick(mine.map((s) => ({ label: s.title, id: s.id })), { placeHolder: 'Which session?' });
    if (pick) await addToFolder([pick.id]);
  }

  function openInClaudeTab(title) {
    return window.tabGroups.all.flatMap((g) => g.tabs)
      .some((tab) => tab.label === title && tab.input && String(tab.input.viewType).includes(CLAUDE_PANEL));
  }

  // Never two writers on one session, never a session running in the wrong folder.
  async function open(id) {
    const latest = deps.latest();
    const s = latest.sessions.find((x) => x.id === id);
    if (!s) return;
    if (!s.cwd) {
      window.showInformationMessage(`Couldn't read which folder '${s.title}' ran in, so it isn't opened here.`);
      return;
    }
    // 1. Another project: open nothing here; offer its own window.
    if (!inWorkspace(s.cwd)) {
      const name = project(s.cwd);
      const button = `Open ${name} in New Window`;
      const answer = await window.showInformationMessage(`'${s.title}' belongs to ${name}. Open it there so it runs in its own folder.`, button);
      if (answer === button) await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(s.cwd), { forceNewWindow: true });
      return;
    }
    if (!(await vscode.commands.getCommands(true)).includes(OPEN_COMMAND)) {
      const answer = await window.showInformationMessage('Install the Claude Code extension to open sessions.', 'Copy resume command');
      if (answer === 'Copy resume command') await vscode.env.clipboard.writeText(`claude --resume ${s.id}`);
      return;
    }
    // 2. Already open here: the official command switches to the existing tab.
    if (openInClaudeTab(s.title)) {
      await vscode.commands.executeCommand(OPEN_COMMAND, s.id);
      window.showInformationMessage(`'${s.title}' is already open — switched to it.`);
      return;
    }
    // 3. Running elsewhere: on Claude Code's running list, or (list unreadable) written < 60 s ago.
    const listed = latest.running.find((r) => r.sessionId === s.id);
    const recent = !latest.runningKnown && deps.now() - s.lastActive < RECENT_MS;
    if (listed || recent) {
      const where = WHERE[(listed || s).entrypoint] || 'another window';
      const answer = await window.showWarningMessage(`'${s.title}' is running in ${where}. Open here anyway?`, { modal: true }, 'Open here');
      if (answer !== 'Open here') return;
    }
    // 4. Otherwise.
    await vscode.commands.executeCommand(OPEN_COMMAND, s.id);
  }

  return {
    newFolder, renameFolder, setFolderColor, deleteFolder, removeFromFolder, addToFolder, moveToFolder, addCurrentSession, open,
  };
}

module.exports = { createCommands };
