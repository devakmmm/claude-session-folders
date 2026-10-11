// The user choices file, the generated index, and atomic writes. store.js is the only
// module allowed to write, and it writes only these two files.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const store = require('../src/store');
const folders = require('../src/folders');
const f = require('./fixtures/claude');

const choicesFile = (dir) => path.join(dir, 'session-folders.json');
const indexFile = (dir) => path.join(dir, 'session-folders.index.json');

test('no choices file yet means no folders; an update saves and reads back', async () => {
  const dir = f.makeClaudeDir();
  assert.deepStrictEqual(store.readChoices(dir), { choices: { version: 1, folders: [] }, readOnly: false });
  const result = store.update(dir, (c) => folders.newFolder(c, 'Login page', 'orange'));
  assert.strictEqual(result.readOnly, false);
  const read = store.readChoices(dir);
  assert.deepStrictEqual(read, result);
  assert.strictEqual(read.choices.folders[0].name, 'Login page');
});

test('an update starts from the file as it is now, so an edit made elsewhere is kept', () => {
  const dir = f.makeClaudeDir();
  store.update(dir, (c) => folders.newFolder(c, 'Mine', 'blue'));
  const edited = JSON.parse(fs.readFileSync(choicesFile(dir), 'utf8'));
  edited.folders.push({ id: 'other-window', name: 'From another window', color: 'red', sessions: [] });
  fs.writeFileSync(choicesFile(dir), JSON.stringify(edited));
  const { choices } = store.update(dir, (c) => folders.renameFolder(c, c.folders[0].id, 'Mine renamed'));
  assert.deepStrictEqual(choices.folders.map((x) => x.name), ['Mine renamed', 'From another window']);
});

// Anything other than "file not found" means we can't trust what we'd overwrite: read-only mode,
// and neither file is written until the choices file can be read again.
for (const [label, content] of [['unparseable', '{"version": 1, "folders": ['], ['an unknown version', '{"version": 2, "folders": []}']]) {
  test(`a choices file that is ${label} puts the store in read-only mode and nothing is written`, () => {
    const dir = f.makeClaudeDir();
    fs.writeFileSync(choicesFile(dir), content);
    assert.strictEqual(store.readChoices(dir).readOnly, true);
    assert.strictEqual(store.update(dir, (c) => folders.newFolder(c, 'X', 'none')).readOnly, true);
    assert.strictEqual(fs.readFileSync(choicesFile(dir), 'utf8'), content);
    assert.strictEqual(fs.existsSync(indexFile(dir)), false);
  });
}

test('a choices file another program is holding (EBUSY) puts the store in read-only mode', (t) => {
  const dir = f.makeClaudeDir();
  fs.writeFileSync(choicesFile(dir), JSON.stringify({ version: 1, folders: [] }));
  const original = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (file, ...rest) => {
    if (String(file).endsWith('session-folders.json')) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
    return original(file, ...rest);
  });
  const read = store.readChoices(dir);
  assert.strictEqual(read.readOnly, true);
  assert.match(read.reason, /EBUSY/);
  assert.strictEqual(store.update(dir, (c) => folders.newFolder(c, 'X', 'none')).readOnly, true);
});

test('the index lists folders with their filed sessions (cwd, file, last activity), health and retention', () => {
  const dir = f.makeClaudeDir();
  const live = { id: 's1', file: 'C:\\c\\s1.jsonl', cwd: 'C:\\work\\api', lastActive: Date.UTC(2026, 9, 9, 12), title: 'fix flaky test', entrypoint: 'claude-vscode' };
  const unfiled = { ...live, id: 's9', title: 'not filed' };
  store.update(dir, () => ({
    version: 1,
    folders: [{ id: 'f1', name: 'Docs', color: 'orange', sessions: [{ id: 's1', title: 'old title' }, { id: 'gone', title: 'deleted work' }] }],
  }));
  store.writeIndex(dir, { sessions: [live, unfiled], health: { sessions: 2, unreadable: 0 }, retentionDays: 365 });
  const index = JSON.parse(fs.readFileSync(indexFile(dir), 'utf8'));
  assert.ok(!Number.isNaN(Date.parse(index.generatedAt)));
  delete index.generatedAt;
  assert.deepStrictEqual(index, {
    version: 1,
    generator: `claude-session-folders ${require('../package.json').version}`,
    note: 'Generated. Do not edit; folders live in session-folders.json.',
    folders: [{
      id: 'f1', name: 'Docs', color: 'orange',
      sessions: [
        { id: 's1', title: 'fix flaky test', cwd: 'C:\\work\\api', file: 'C:\\c\\s1.jsonl', lastActive: '2026-10-09T12:00:00.000Z' },
        { id: 'gone', title: 'deleted work', deleted: true },
      ],
    }],
    health: { sessions: 2, unreadable: 0 },
    retentionDays: 365,
  });
});

const noSessions = { sessions: [], health: { sessions: 0, unreadable: 0 }, retentionDays: 30 };
const leftovers = (dir) => fs.readdirSync(dir).filter((n) => n.includes('.tmp-'));

test('a write that cannot be renamed into place removes its temp file and fails loudly; the folders file is kept', () => {
  const dir = f.makeClaudeDir();
  store.update(dir, (c) => folders.newFolder(c, 'Kept', 'green'));
  fs.mkdirSync(indexFile(dir)); // something in the way of the index file
  assert.throws(() => store.writeIndex(dir, noSessions));
  assert.deepStrictEqual(leftovers(dir), []);
  assert.strictEqual(store.readChoices(dir).choices.folders[0].name, 'Kept');
});

test('a rename blocked for a moment (EBUSY, e.g. antivirus) is retried once and succeeds', (t) => {
  const dir = f.makeClaudeDir();
  const original = fs.renameSync;
  let calls = 0;
  t.mock.method(fs, 'renameSync', (from, to) => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
    return original(from, to);
  });
  store.update(dir, (c) => folders.newFolder(c, 'Retried', 'purple'));
  assert.strictEqual(calls, 2);
  assert.strictEqual(store.readChoices(dir).choices.folders[0].name, 'Retried');
  assert.deepStrictEqual(leftovers(dir), []);
});

test('in read-only mode the index is left exactly as it was', () => {
  const dir = f.makeClaudeDir();
  store.update(dir, (c) => folders.newFolder(c, 'Before', 'blue'));
  store.writeIndex(dir, noSessions);
  const before = fs.readFileSync(indexFile(dir), 'utf8');
  fs.writeFileSync(choicesFile(dir), '{ broken');
  assert.strictEqual(store.writeIndex(dir, noSessions).readOnly, true);
  assert.strictEqual(fs.readFileSync(indexFile(dir), 'utf8'), before);
});
