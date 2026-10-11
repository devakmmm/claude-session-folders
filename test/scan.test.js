// Reading a session, scan health, and the running-session list that opening a session relies on.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { listSessions, readRunning } = require('../src/scan');
const f = require('./fixtures/claude');

const ID = '11111111-2222-3333-4444-555555555555';

test('lists a session with its id, file, cwd, last activity and entrypoint', async () => {
  const dir = f.makeClaudeDir();
  const file = f.addSession(dir, ID, [f.user('Fix the login bug'), f.assistant('On it.')]);
  const { sessions } = await listSessions(dir);
  assert.deepStrictEqual(sessions, [{
    id: ID,
    file,
    cwd: f.CWD,
    lastActive: fs.statSync(file).mtimeMs,
    title: 'Fix the login bug',
    entrypoint: 'claude-vscode',
  }]);
});

test('only <uuid>.jsonl files are sessions; set-aside copies and subagent transcripts are not', async () => {
  const dir = f.makeClaudeDir();
  f.addSession(dir, ID, [f.user('real session')]);
  f.writeFile(dir, `projects/${f.PROJECT}/${ID}.orphaned-1760000000.jsonl`, JSON.stringify(f.user('copy')) + '\n');
  f.writeFile(dir, `projects/${f.PROJECT}/${ID}.jsonl.superseded-1760000000`, JSON.stringify(f.user('old')) + '\n');
  f.writeFile(dir, `projects/${f.PROJECT}/${ID}/subagents/agent-a1.jsonl`, JSON.stringify(f.user('sub')) + '\n');
  f.writeFile(dir, `projects/${f.PROJECT}/memory/MEMORY.md`, '- note\n');
  const { sessions } = await listSessions(dir);
  assert.deepStrictEqual(sessions.map((s) => s.title), ['real session']);
});

test('title: last custom title, else last AI title, else first prompt, else (untitled)', async () => {
  const dir = f.makeClaudeDir();
  const ids = ['a', 'b', 'c', 'd'].map((c) => `${c.repeat(8)}-2222-3333-4444-555555555555`);
  f.addSession(dir, ids[0], [f.user('prompt'), f.aiTitle('AI'), f.customTitle('Mine v1'), f.customTitle('Mine v2'), f.aiTitle('AI later')]);
  f.addSession(dir, ids[1], [f.user('prompt'), f.aiTitle('AI v1'), f.aiTitle('AI v2')]);
  f.addSession(dir, ids[2], [f.user('prompt only')]);
  f.addSession(dir, ids[3], [f.assistant('no user prompt here')]);
  const { sessions } = await listSessions(dir);
  const titles = Object.fromEntries(sessions.map((s) => [s.id, s.title]));
  assert.deepStrictEqual(titles, {
    [ids[0]]: 'Mine v2',
    [ids[1]]: 'AI v2',
    [ids[2]]: 'prompt only',
    [ids[3]]: '(untitled) dddddddd',
  });
});

test('title from the first real prompt: skips meta records, <markup>, and tool results; reads text blocks; cuts to 80', async () => {
  const dir = f.makeClaudeDir();
  const long = 'Refactor the payment retry loop so that it backs off exponentially and logs each attempt clearly';
  f.addSession(dir, ID, [
    f.user('Caveat: injected context', { isMeta: true }),
    f.user('<command-name>/clear</command-name>'),
    f.user([{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]),
    f.user([{ type: 'image', source: {} }, { type: 'text', text: long }]),
    f.user('a later prompt'),
  ]);
  const { sessions } = await listSessions(dir);
  assert.strictEqual(sessions[0].title, long.slice(0, 80));
});

test('a half-written last line (Claude Code mid-write) is skipped', async () => {
  const dir = f.makeClaudeDir();
  f.addSession(dir, ID, [f.user('first'), f.aiTitle('Login bug'), '{"type":"assistant","message":{"rol']);
  const { sessions } = await listSessions(dir);
  assert.strictEqual(sessions[0].title, 'Login bug');
});

test('health counts sessions and the unreadable ones (no cwd anywhere); unreadable ones are still listed', async () => {
  const dir = f.makeClaudeDir();
  f.addSession(dir, ID, [f.user('fine')]);
  f.addSession(dir, '99999999-2222-3333-4444-555555555555', ['not json at all', '{"type":"summary"}']);
  const { sessions, health } = await listSessions(dir);
  assert.deepStrictEqual(health, { sessions: 2, unreadable: 1 });
  assert.strictEqual(sessions.length, 2);
});

test('no Claude data yet (no projects folder) is an empty list, not an error', async () => {
  const dir = f.makeClaudeDir();
  fs.rmSync(`${dir}/projects`, { recursive: true });
  assert.deepStrictEqual(await listSessions(dir), { sessions: [], health: { sessions: 0, unreadable: 0 } });
});

test('running list: reads sessions/*.json (sessionId, entrypoint) and never opens the *.key files', async (t) => {
  const dir = f.makeClaudeDir();
  f.writeFile(dir, 'sessions/4242.json', JSON.stringify({ pid: 4242, sessionId: ID, cwd: f.CWD, entrypoint: 'cli', status: 'busy' }));
  f.writeFile(dir, 'sessions/4242.key', 'placeholder, not a token');
  f.writeFile(dir, 'sessions/5151.json', '{"pid": 51');
  const opened = [];
  for (const [obj, name] of [[fs, 'readFileSync'], [fs, 'openSync'], [fs, 'createReadStream'], [fs.promises, 'readFile'], [fs.promises, 'open']]) {
    const original = obj[name];
    t.mock.method(obj, name, function (file, ...rest) {
      opened.push(String(file));
      return original.call(this, file, ...rest);
    });
  }
  assert.deepStrictEqual(await readRunning(dir), [{ sessionId: ID, entrypoint: 'cli' }]);
  assert.ok(opened.length > 0, 'expected the .json file to be read');
  assert.deepStrictEqual(opened.filter((p) => p.endsWith('.key')), []);
});

test('running list: no sessions folder is an empty list', async () => {
  assert.deepStrictEqual(await readRunning(f.makeClaudeDir()), []);
});

// Big files: the reader looks at a head and a tail window first and falls back to reading the
// whole file. These pin that nothing is lost when the windows miss what they need.
const filler = (kb) => Array.from({ length: kb }, (_, i) => ({ type: 'progress', n: i, data: 'x'.repeat(1000) }));

test('big file whose first line is huge: still finds cwd and the prompt', async () => {
  const dir = f.makeClaudeDir();
  const huge = 'Paste: ' + 'y'.repeat(100 * 1024);
  f.addSession(dir, ID, [f.user(huge, { cwd: 'C:\\big\\repo' }), ...filler(400)]);
  const { sessions } = await listSessions(dir);
  assert.strictEqual(sessions[0].cwd, 'C:\\big\\repo');
  assert.strictEqual(sessions[0].title, huge.slice(0, 80));
});

test('big file whose only title is in the middle: still finds the title', async () => {
  const dir = f.makeClaudeDir();
  f.addSession(dir, ID, [f.user('start'), ...filler(150), f.aiTitle('Mid-file title'), ...filler(400)]);
  const { sessions } = await listSessions(dir);
  assert.strictEqual(sessions[0].title, 'Mid-file title');
});
