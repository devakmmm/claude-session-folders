// Folder operations are pure (they return a new choices object and never change the one
// they were given), and buildView turns choices + scanned sessions into what the sidebar shows.
const test = require('node:test');
const assert = require('node:assert');
const folders = require('../src/folders');

const EMPTY = { version: 1, folders: [] };

// Runs op on a deep copy and asserts the original was left exactly as it was.
function pure(choices, op) {
  const before = structuredClone(choices);
  const after = op(choices);
  assert.deepStrictEqual(choices, before, 'the input choices were changed');
  assert.notStrictEqual(after, choices);
  return after;
}

test('newFolder adds an empty folder with a random id, name and color', () => {
  const after = pure(EMPTY, (c) => folders.newFolder(c, 'Login page redesign', 'orange'));
  assert.strictEqual(after.folders.length, 1);
  const [folder] = after.folders;
  assert.match(folder.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.deepStrictEqual({ ...folder, id: 'x' }, { id: 'x', name: 'Login page redesign', color: 'orange', sessions: [] });
});

const withFolders = () => ({
  version: 1,
  folders: [
    { id: 'f1', name: 'Login page', color: 'orange', sessions: [{ id: 's1', title: 'fix flaky test' }] },
    { id: 'f2', name: 'Login', color: 'blue', sessions: [] },
  ],
});

test('add files sessions with the title they have now, and never twice', () => {
  const after = pure(withFolders(), (c) => folders.add(c, [{ id: 's1', title: 'renamed since' }, { id: 's2', title: 'release notes' }], 'f1'));
  assert.deepStrictEqual(after.folders[0].sessions, [
    { id: 's1', title: 'fix flaky test' },
    { id: 's2', title: 'release notes' },
  ]);
  assert.deepStrictEqual(after.folders[1], withFolders().folders[1]);
});

test('remove takes sessions out of that folder only', () => {
  const start = folders.add(withFolders(), [{ id: 's1', title: 'fix flaky test' }], 'f2');
  const after = pure(start, (c) => folders.remove(c, ['s1'], 'f1'));
  assert.deepStrictEqual(after.folders.map((f) => f.sessions.map((s) => s.id)), [[], ['s1']]);
});

test('move = remove from one folder + add to another, keeping the title it was filed with', () => {
  const after = pure(withFolders(), (c) => folders.move(c, ['s1'], 'f1', 'f2'));
  assert.deepStrictEqual(after.folders.map((f) => f.sessions), [[], [{ id: 's1', title: 'fix flaky test' }]]);
});

test('renameFolder and setColor change only that folder', () => {
  const renamed = pure(withFolders(), (c) => folders.renameFolder(c, 'f2', 'Login + SSO'));
  const colored = pure(renamed, (c) => folders.setColor(c, 'f2', 'none'));
  assert.deepStrictEqual(colored.folders[1], { id: 'f2', name: 'Login + SSO', color: 'none', sessions: [] });
  assert.deepStrictEqual(colored.folders[0], withFolders().folders[0]);
});

test('deleteFolder removes the folder only; the same session filed elsewhere stays', () => {
  const start = folders.add(withFolders(), [{ id: 's1', title: 'fix flaky test' }], 'f2');
  const after = pure(start, (c) => folders.deleteFolder(c, 'f1'));
  assert.deepStrictEqual(after.folders.map((f) => f.id), ['f2']);
  assert.deepStrictEqual(after.folders[0].sessions, [{ id: 's1', title: 'fix flaky test' }]);
});

// Shaped like scan.listSessions output.
const session = (id, cwd, lastActive) => ({ id, file: `${id}.jsonl`, cwd, lastActive, title: `title ${id}`, entrypoint: 'claude-vscode' });
const SESSIONS = [
  session('s1', 'C:\\work\\api', 100),
  session('s2', 'C:\\work\\api', 300),
  session('s3', '/home/dev/web', 200),
  session('s4', 'C:\\work\\api', 50),
  session('s5', '/home/dev/web', 400),
  session('s6', null, 10),
];

test('buildView: folders newest first (empty ones last, by name); sessions newest first; a deleted session still shows', () => {
  const choices = {
    version: 1,
    folders: [
      { id: 'f3', name: 'Zeta', color: 'none', sessions: [] },
      { id: 'f1', name: 'Docs', color: 'orange', sessions: [{ id: 's1', title: 'a' }, { id: 'gone', title: 'old work' }, { id: 's2', title: 'b' }] },
      { id: 'f5', name: 'Only deleted', color: 'red', sessions: [{ id: 'gone2', title: 'older work' }] },
      { id: 'f2', name: 'Login', color: 'blue', sessions: [{ id: 's3', title: 'c' }] },
      { id: 'f4', name: 'Alpha', color: 'green', sessions: [] },
    ],
  };
  const view = folders.buildView(choices, SESSIONS);
  assert.deepStrictEqual(view.folders.map((f) => f.name), ['Docs', 'Login', 'Alpha', 'Only deleted', 'Zeta']);
  assert.deepStrictEqual(view.folders[0], {
    id: 'f1', name: 'Docs', color: 'orange',
    sessions: [SESSIONS[1], SESSIONS[0], { id: 'gone', title: '(deleted) old work', deleted: true }],
  });
});

test('buildView: every session in no folder, as one flat list, newest first (no grouping)', () => {
  const choices = { version: 1, folders: [{ id: 'f1', name: 'Docs', color: 'orange', sessions: [{ id: 's1', title: 'a' }, { id: 's3', title: 'c' }] }] };
  assert.deepStrictEqual(folders.buildView(choices, SESSIONS).unfiled, [SESSIONS[4], SESSIONS[1], SESSIONS[3], SESSIONS[5]]);
});
