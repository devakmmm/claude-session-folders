// The permanent rule: nothing under <claudeDir>/projects is ever written, renamed, moved or
// deleted. (a) Statically, only src/store.js may call anything that writes. (b) At runtime, a full
// scan plus every folder operation leaves every session file byte-for-byte unchanged.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const scan = require('../src/scan');
const store = require('../src/store');
const folders = require('../src/folders');
const { snapshot } = require('../scripts/fingerprint');
const f = require('./fixtures/claude');

const SRC = path.join(__dirname, '..', 'src');
const WRITE_CALL = new RegExp('\\b(' + [
  'writeFile', 'appendFile', 'rename', 'unlink', 'rm', 'rmdir', 'mkdir', 'mkdtemp', 'copyFile', 'cp',
  'truncate', 'ftruncate', 'symlink', 'link', 'utimes', 'chmod', 'write', 'writev',
].map((name) => `${name}(?:Sync)?`).join('|') + '|createWriteStream)\\s*\\(');
const OPEN_FOR_WRITE = /\bopen(?:Sync)?\s*\([^)]*['"`](?:w|a|r\+|wx|ax|w\+|a\+)['"`]/;

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? jsFiles(full) : e.name.endsWith('.js') ? [full] : [];
  });
}

test('only src/store.js contains code that can write files', () => {
  const writers = jsFiles(SRC).filter((file) => {
    const code = fs.readFileSync(file, 'utf8');
    return WRITE_CALL.test(code) || OPEN_FOR_WRITE.test(code);
  });
  assert.deepStrictEqual(writers.map((file) => path.relative(SRC, file)), ['store.js']);
});

function allFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)))
    .sort();
}

test('scanning and every folder operation leave every session file byte-for-byte unchanged', async () => {
  const dir = f.makeClaudeDir();
  f.addSession(dir, '11111111-2222-3333-4444-555555555555', [f.user('first'), f.aiTitle('First')]);
  f.addSession(dir, '22222222-2222-3333-4444-555555555555', [f.user('second'), f.customTitle('Second')], 'c--work-web');
  f.writeFile(dir, 'projects/c--work-app/11111111-2222-3333-4444-555555555555/subagents/agent-a1.jsonl', '{"type":"user"}\n');
  f.writeFile(dir, 'sessions/4242.json', JSON.stringify({ pid: 4242, sessionId: '11111111-2222-3333-4444-555555555555', entrypoint: 'cli' }));
  const hashesBefore = snapshot(dir);
  const filesBefore = allFiles(dir);

  const { sessions, health } = await scan.listSessions(dir);
  await scan.readRunning(dir);
  const [a, b] = sessions.map((s) => ({ id: s.id, title: s.title }));
  store.update(dir, (c) => folders.newFolder(folders.newFolder(c, 'One', 'red'), 'Two', 'blue'));
  const [one, two] = store.readChoices(dir).choices.folders.map((x) => x.id);
  store.update(dir, (c) => folders.add(c, [a, b], one));
  store.update(dir, (c) => folders.move(c, [a.id], one, two));
  store.update(dir, (c) => folders.remove(c, [b.id], one));
  store.update(dir, (c) => folders.setColor(folders.renameFolder(c, two, 'Two renamed'), two, 'none'));
  store.update(dir, (c) => folders.deleteFolder(c, one));
  store.writeIndex(dir, { sessions, health, retentionDays: 30 });

  assert.deepStrictEqual(snapshot(dir), hashesBefore);
  assert.deepStrictEqual(allFiles(dir), [...filesBefore, 'session-folders.index.json', 'session-folders.json'].sort());
});
