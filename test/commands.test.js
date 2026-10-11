// Opening a session, adding this session, and folder edits. A fake vscode records
// every prompt and answers from a script, in order.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createCommands } = require('../src/commands');
const store = require('../src/store');
const f = require('./fixtures/claude');

const NOW = Date.UTC(2026, 9, 11, 12);
const PRIMARY = 'claude-vscode.primaryEditor.open';

function fakeVscode({ answers = [], workspace = ['C:\\work\\api'], tabs = [], commands = [PRIMARY] } = {}) {
  const calls = [];
  const answer = (items) => {
    const a = answers.shift();
    return typeof a === 'function' ? a(items) : a;
  };
  const api = {
    Uri: { file: (p) => ({ fsPath: p }) },
    workspace: { workspaceFolders: workspace.map((p) => ({ uri: { fsPath: p } })) },
    window: {
      showQuickPick: async (items, options) => { calls.push(['pick', items, options]); return answer(items); },
      showInputBox: async (options) => { calls.push(['input', options]); return answer(); },
      showInformationMessage: async (message, ...rest) => { calls.push(['info', message, ...rest]); return answer(); },
      showWarningMessage: async (message, ...rest) => { calls.push(['warn', message, ...rest]); return answer(); },
      createTerminal: () => { throw new Error('createTerminal must never be called'); },
      tabGroups: { all: [{ tabs }] },
    },
    commands: {
      getCommands: async () => commands,
      executeCommand: async (...args) => { calls.push(['exec', ...args]); },
    },
    env: { clipboard: { writeText: async (text) => { calls.push(['clipboard', text]); } } },
  };
  return { api, calls };
}

const byLabel = (label) => (items) => items.find((i) => i.label.includes(label));

function setup(options = {}) {
  const dir = f.makeClaudeDir();
  const latest = { sessions: options.sessions || [], running: options.running || [], runningKnown: options.runningKnown !== false };
  const { api, calls } = fakeVscode(options);
  let refreshed = 0;
  const commands = createCommands(api, {
    claudeDir: () => dir,
    latest: () => latest,
    refresh: async () => { refreshed += 1; },
    now: () => NOW,
  });
  return { dir, calls, commands, refreshed: () => refreshed, folders: () => store.readChoices(dir).choices.folders };
}

test('New folder asks for a name, then a color, saves it and refreshes', async () => {
  const t = setup({ answers: ['Login page redesign', byLabel('Orange')] });
  await t.commands.newFolder();
  assert.deepStrictEqual(t.folders().map(({ name, color, sessions }) => ({ name, color, sessions })), [
    { name: 'Login page redesign', color: 'orange', sessions: [] },
  ]);
  assert.strictEqual(t.refreshed(), 1);
});

// Seeds the choices file directly.
function seed(t, list) {
  store.update(t.dir, () => ({ version: 1, folders: list }));
}

test('Delete folder asks first; dismissing keeps it, Delete removes only the folder', async () => {
  const t = setup({ answers: [undefined, 'Delete'] });
  seed(t, [{ id: 'f1', name: 'Docs', color: 'red', sessions: [{ id: 's1', title: 'a' }] }]);
  await t.commands.deleteFolder('f1');
  assert.strictEqual(t.folders().length, 1);
  await t.commands.deleteFolder('f1');
  assert.strictEqual(t.folders().length, 0);
  const asks = t.calls.filter((c) => c[0] === 'warn');
  assert.deepStrictEqual(asks[0].slice(1), ["Delete folder 'Docs'? Sessions are not touched.", 'Delete']);
});

test('Rename (prefilled), Color and Remove from Folder change just that folder', async () => {
  const t = setup({ answers: ['Docs v2', byLabel('Green')] });
  seed(t, [{ id: 'f1', name: 'Docs', color: 'red', sessions: [{ id: 's1', title: 'a' }, { id: 's2', title: 'b' }] }]);
  await t.commands.renameFolder('f1');
  await t.commands.setFolderColor('f1');
  await t.commands.removeFromFolder(['s1'], 'f1');
  assert.deepStrictEqual(t.folders(), [{ id: 'f1', name: 'Docs v2', color: 'green', sessions: [{ id: 's2', title: 'b' }] }]);
  assert.strictEqual(t.calls.find((c) => c[0] === 'input')[1].value, 'Docs');
});

const HOUR = 60 * 60 * 1000;
const session = (id, title, cwd, hoursAgo, extra = {}) => ({
  id, title, cwd, file: `${id}.jsonl`, lastActive: NOW - hoursAgo * HOUR, entrypoint: 'claude-vscode', ...extra,
});
const SESSIONS = [
  session('s1', 'api older', 'C:\\work\\api', 5),
  session('s2', 'api newest', 'C:\\work\\api', 1),
  session('s3', 'web newest overall', 'C:\\work\\web', 0.5),
];

test('Move to Folder offers the other folders and moves, keeping the filed title', async () => {
  const t = setup({ sessions: SESSIONS, answers: [byLabel('Review')] });
  seed(t, [
    { id: 'f1', name: 'Docs', color: 'red', sessions: [{ id: 's1', title: 'filed title' }] },
    { id: 'f2', name: 'Review', color: 'blue', sessions: [] },
  ]);
  await t.commands.moveToFolder(['s1'], 'f1');
  assert.deepStrictEqual(t.folders().map((x) => x.sessions), [[], [{ id: 's1', title: 'filed title' }]]);
  const offered = t.calls.find((c) => c[0] === 'pick')[1].map((i) => i.label);
  assert.ok(!offered.some((l) => l.includes('Docs')), 'the source folder is not offered');
  assert.ok(offered.some((l) => l.includes('New folder')));
});

test('Add to Folder with "New folder…" creates the folder and files the sessions into it', async () => {
  const t = setup({ sessions: SESSIONS, answers: [byLabel('New folder'), 'Login', byLabel('Blue')] });
  await t.commands.addToFolder(['s1', 's3']);
  assert.deepStrictEqual(t.folders().map(({ name, sessions }) => ({ name, sessions })), [
    { name: 'Login', sessions: [{ id: 's1', title: 'api older' }, { id: 's3', title: 'web newest overall' }] },
  ]);
});

test('a drop names its target folder, so add and move skip the folder picker', async () => {
  const t = setup({ sessions: SESSIONS });
  seed(t, [
    { id: 'f1', name: 'Docs', color: 'red', sessions: [{ id: 's1', title: 'filed title' }] },
    { id: 'f2', name: 'Review', color: 'blue', sessions: [] },
  ]);
  await t.commands.addToFolder(['s2', 's3'], 'f2');
  await t.commands.moveToFolder(['s1'], 'f1', 'f2');
  assert.deepStrictEqual(t.folders().map((x) => x.sessions.map((s) => s.id)), [[], ['s2', 's3', 's1']]);
  assert.deepStrictEqual(t.calls.filter((c) => c[0] === 'pick'), []);
});

test('Add This Session offers this workspace\'s sessions newest first, so one Enter picks the one you are in', async () => {
  const t = setup({ sessions: SESSIONS, answers: [(items) => items[0], byLabel('Docs')] });
  seed(t, [{ id: 'f1', name: 'Docs', color: 'red', sessions: [] }]);
  await t.commands.addCurrentSession();
  const offered = t.calls.find((c) => c[0] === 'pick')[1].map((i) => i.label);
  assert.deepStrictEqual(offered, ['api newest', 'api older']);
  assert.deepStrictEqual(t.folders()[0].sessions, [{ id: 's2', title: 'api newest' }]);
});

test('Add This Session with no sessions in this workspace says so', async () => {
  const t = setup({ sessions: SESSIONS, workspace: ['C:\\work\\other'] });
  await t.commands.addCurrentSession();
  assert.deepStrictEqual(t.calls.map((c) => c.slice(0, 2)), [['info', 'No Claude Code sessions for this workspace yet.']]);
});

// Opening a session, checked in this order: another project, already open here, running elsewhere, otherwise open.
const execs = (t) => t.calls.filter((c) => c[0] === 'exec').map((c) => c.slice(1));

test('open: a session from another project opens nothing here and offers a new window', async () => {
  const t = setup({ sessions: SESSIONS, answers: [undefined, 'Open web in New Window'] });
  await t.commands.open('s3');
  assert.deepStrictEqual(execs(t), []);
  await t.commands.open('s3');
  assert.deepStrictEqual(t.calls[0].slice(0, 3), ['info', "'web newest overall' belongs to web. Open it there so it runs in its own folder.", 'Open web in New Window']);
  assert.deepStrictEqual(execs(t), [['vscode.openFolder', { fsPath: 'C:\\work\\web' }, { forceNewWindow: true }]]);
});

test('open: a session already open in a Claude tab here switches to that tab', async () => {
  const tabs = [{ label: 'api older', input: { viewType: 'mainThreadWebview-claudeVSCodePanel' } }];
  const t = setup({ sessions: SESSIONS, tabs });
  await t.commands.open('s1');
  assert.deepStrictEqual(execs(t), [[PRIMARY, 's1']]);
  assert.deepStrictEqual(t.calls.find((c) => c[0] === 'info').slice(1), ["'api older' is already open — switched to it."]);
});

test('open: a session running elsewhere (on the running list) asks before opening a second copy', async () => {
  const t = setup({ sessions: SESSIONS, running: [{ sessionId: 's1', entrypoint: 'cli' }], answers: [undefined, 'Open here'] });
  await t.commands.open('s1');
  assert.deepStrictEqual(execs(t), []);
  await t.commands.open('s1');
  assert.deepStrictEqual(t.calls[0].slice(1), ["'api older' is running in a terminal. Open here anyway?", { modal: true }, 'Open here']);
  assert.deepStrictEqual(execs(t), [[PRIMARY, 's1']]);
});

test('open: without a running list, a session written in the last 60 s counts as running', async () => {
  const fresh = [session('s1', 'just written', 'C:\\work\\api', 30 / 3600), session('s2', 'quiet', 'C:\\work\\api', 2 / 60)];
  const t = setup({ sessions: fresh, runningKnown: false, answers: [undefined] });
  await t.commands.open('s1');
  assert.strictEqual(t.calls[0][1], "'just written' is running in VS Code. Open here anyway?");
  await t.commands.open('s2');
  assert.deepStrictEqual(execs(t), [[PRIMARY, 's2']]);
});

test('open: a session whose folder could not be read is not opened here', async () => {
  const t = setup({ sessions: [session('s9', 'unreadable', null, 1)] });
  await t.commands.open('s9');
  assert.deepStrictEqual(execs(t), []);
  assert.deepStrictEqual(t.calls[0].slice(0, 2), ['info', "Couldn't read which folder 'unreadable' ran in, so it isn't opened here."]);
});

test('folder edits in read-only mode save nothing and say why', async () => {
  const t = setup({ answers: ['Never saved', byLabel('Red')] });
  fs.writeFileSync(path.join(t.dir, 'session-folders.json'), '{ broken');
  await t.commands.newFolder();
  assert.strictEqual(fs.readFileSync(path.join(t.dir, 'session-folders.json'), 'utf8'), '{ broken');
  assert.deepStrictEqual(t.calls.at(-1).slice(0, 2), ['warn', 'Folders file is busy or unreadable — not saving anything until it can be read.']);
  assert.strictEqual(t.refreshed(), 0);
});

test('open: otherwise opens it with the Claude Code extension', async () => {
  const t = setup({ sessions: SESSIONS });
  await t.commands.open('s2');
  assert.deepStrictEqual(execs(t), [[PRIMARY, 's2']]);
  assert.deepStrictEqual(t.calls.filter((c) => c[0] !== 'exec'), []);
});

test('open: without the Claude Code extension, offers the resume command instead; never a terminal', async () => {
  const t = setup({ sessions: SESSIONS, commands: [], answers: ['Copy resume command'] });
  await t.commands.open('s2');
  assert.deepStrictEqual(t.calls.map((c) => c.slice(0, 3)), [
    ['info', 'Install the Claude Code extension to open sessions.', 'Copy resume command'],
    ['clipboard', 'claude --resume s2'],
  ]);
  const src = path.join(__dirname, '..', 'src');
  for (const file of fs.readdirSync(src)) {
    assert.doesNotMatch(fs.readFileSync(path.join(src, file), 'utf8'), /createTerminal|sendText/, file);
  }
});
