const vscode = require('vscode');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const scan = require('./scan');
const store = require('./store');
const folders = require('./folders');
const { SessionsView, contextAction } = require('./view');
const { createCommands } = require('./commands');

const VISIBLE_DEBOUNCE_MS = 2000;
const MENU_ACTIONS = ['open', 'add', 'move', 'remove', 'rename', 'color', 'delete'];

function claudeDir() {
  const setting = vscode.workspace.getConfiguration('sessionFolders').get('claudeDir');
  return setting || path.join(os.homedir(), '.claude');
}

// "Open settings": opens Claude Code's settings.json for the user to edit. The extension never
// writes it; a missing file opens as an unsaved editor at that path.
async function openSettings() {
  const file = vscode.Uri.file(path.join(claudeDir(), 'settings.json'));
  let doc;
  try {
    doc = await vscode.workspace.openTextDocument(file);
  } catch {
    doc = await vscode.workspace.openTextDocument(file.with({ scheme: 'untitled' }));
  }
  await vscode.window.showTextDocument(doc);
}

function activate(context) {
  let lastScan = 0;
  // The last scan, for commands: sessions, Claude Code's running list, and whether that list exists.
  let latest = { sessions: [], running: [], runningKnown: false };

  const commands = createCommands(vscode, {
    claudeDir,
    latest: () => latest,
    refresh: () => refresh(),
    now: () => Date.now(),
  });

  // Every action the webview or its right-click menu can ask for. Ids come from data
  // attributes render.js wrote; toFolderId is set when sessions were dropped on a folder.
  const actions = {
    open: (m) => commands.open(m.sessionIds[0]),
    add: (m) => commands.addToFolder(m.sessionIds, m.toFolderId),
    move: (m) => commands.moveToFolder(m.sessionIds, m.folderId, m.toFolderId),
    remove: (m) => commands.removeFromFolder(m.sessionIds, m.folderId),
    rename: (m) => commands.renameFolder(m.folderId),
    color: (m) => commands.setFolderColor(m.folderId),
    delete: (m) => commands.deleteFolder(m.folderId),
    newFolder: () => commands.newFolder(),
    openSettings: () => openSettings(),
  };

  function run(message) {
    if (!message || !Object.hasOwn(actions, message.action)) return;
    // A failed save is shown, never swallowed.
    Promise.resolve(actions[message.action](message)).catch((err) => {
      vscode.window.showErrorMessage(`Session Folders: ${err.message}`);
    });
  }

  const sidebar = new SessionsView(vscode, context.extensionUri, {
    onAction: run,
    onVisible: () => {
      if (Date.now() - lastScan > VISIBLE_DEBOUNCE_MS) refresh();
    },
  });

  // A full scan takes well under a second for hundreds of sessions, so there is no cache or watcher.
  async function refresh() {
    lastScan = Date.now();
    const dir = claudeDir();
    try {
      const [{ sessions, health }, running] = await Promise.all([scan.listSessions(dir), scan.readRunning(dir)]);
      latest = { sessions, running, runningKnown: fs.existsSync(path.join(dir, 'sessions')) };
      const retentionDays = scan.readRetentionDays(dir);
      const read = store.readChoices(dir);
      sidebar.post({
        view: read.readOnly ? { folders: [], unfiled: [] } : folders.buildView(read.choices, sessions),
        running: running.map((r) => r.sessionId),
        health,
        retentionDays,
        now: Date.now(),
        readOnly: read.readOnly ? read.reason : null,
      });
      if (!read.readOnly) store.writeIndex(dir, { sessions, health, retentionDays });
    } catch (err) {
      vscode.window.showErrorMessage(`Session Folders couldn't read ${dir}: ${err.message}`);
    }
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('claudeSessionFolders.sessions', sidebar),
    vscode.commands.registerCommand('claudeSessionFolders.refresh', refresh),
    vscode.commands.registerCommand('claudeSessionFolders.addCurrentSession', () => commands.addCurrentSession()),
    vscode.commands.registerCommand('claudeSessionFolders.newFolder', () => commands.newFolder()),
    // Native right-click menu on rows and folders (webview/context); VS Code passes the element's
    // data-vscode-context.
    ...MENU_ACTIONS.map((action) => vscode.commands.registerCommand(
      `claudeSessionFolders.menu.${action}`, (menuContext) => run(contextAction(action, menuContext)),
    )),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('sessionFolders.claudeDir')) refresh();
    }),
  );
  refresh();
}

function deactivate() {}

module.exports = { activate, deactivate };
