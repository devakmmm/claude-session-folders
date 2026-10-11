// The append-only rule: a session file may grow (Claude Code appends to it) but must never
// shrink, change its existing bytes, or disappear. Synthetic files in a temp dir only.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { snapshot, verify } = require('../scripts/fingerprint');

const SESSION = 'projects/c--work-app/11111111-2222-3333-4444-555555555555.jsonl';

function makeClaudeDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-'));
  write(dir, SESSION, '{"type":"user","message":"hello"}\n{"type":"assistant","message":"hi"}\n');
  return dir;
}

function write(dir, rel, text) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
}

test('unchanged files pass', () => {
  const dir = makeClaudeDir();
  const snap = snapshot(dir);
  assert.strictEqual(verify(dir, snap).pass, true);
});

test('a deleted file fails', () => {
  const dir = makeClaudeDir();
  const snap = snapshot(dir);
  fs.rmSync(path.join(dir, SESSION));
  const result = verify(dir, snap);
  assert.strictEqual(result.pass, false);
  assert.deepStrictEqual(result.failures, [{ file: SESSION, reason: 'deleted' }]);
});

test('a truncated file fails', () => {
  const dir = makeClaudeDir();
  const snap = snapshot(dir);
  fs.truncateSync(path.join(dir, SESSION), 10);
  const result = verify(dir, snap);
  assert.strictEqual(result.pass, false);
  assert.deepStrictEqual(result.failures, [{ file: SESSION, reason: 'shrank' }]);
});

test('a byte edited in place (same size) fails', () => {
  const dir = makeClaudeDir();
  const snap = snapshot(dir);
  const full = path.join(dir, SESSION);
  fs.writeFileSync(full, fs.readFileSync(full, 'utf8').replace('hello', 'HELLO'));
  const result = verify(dir, snap);
  assert.strictEqual(result.pass, false);
  assert.deepStrictEqual(result.failures, [{ file: SESSION, reason: 'changed' }]);
});

test('an appended file passes (Claude Code itself appends to live sessions)', () => {
  const dir = makeClaudeDir();
  const snap = snapshot(dir);
  fs.appendFileSync(path.join(dir, SESSION), '{"type":"user","message":"more"}\n');
  assert.deepStrictEqual(verify(dir, snap), { pass: true, failures: [], added: [] });
});

test('a new file passes and is reported', () => {
  const dir = makeClaudeDir();
  const snap = snapshot(dir);
  const added = 'projects/c--work-app/99999999-8888-7777-6666-555555555555.jsonl';
  write(dir, added, '{"type":"user","message":"new"}\n');
  assert.deepStrictEqual(verify(dir, snap), { pass: true, failures: [], added: [added] });
});

test('transcripts at any depth count; files Claude Code rewrites (memory, titles) are ignored', () => {
  const dir = makeClaudeDir();
  const subagent = 'projects/c--work-app/11111111-2222-3333-4444-555555555555/subagents/agent-a1.jsonl';
  const memory = 'projects/c--work-app/memory/MEMORY.md';
  write(dir, subagent, '{"type":"user","message":"sub"}\n');
  write(dir, memory, '- a long memory line\n');
  const snap = snapshot(dir);
  fs.truncateSync(path.join(dir, subagent), 3);
  write(dir, memory, '- short\n');
  assert.deepStrictEqual(verify(dir, snap).failures, [{ file: subagent, reason: 'shrank' }]);
});

test('command line: snapshot writes a file, verify exits 0 on PASS and 1 on FAIL', () => {
  const { spawnSync } = require('node:child_process');
  const script = path.join(__dirname, '..', 'scripts', 'fingerprint.js');
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  const dir = makeClaudeDir();
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fp-out-')), 'snap.json');

  assert.strictEqual(run('snapshot', dir, out).status, 0);
  assert.ok(JSON.parse(fs.readFileSync(out, 'utf8')).files[SESSION]);

  const pass = run('verify', dir, out);
  assert.strictEqual(pass.status, 0);
  assert.match(pass.stdout, /PASS/);

  fs.truncateSync(path.join(dir, SESSION), 5);
  const fail = run('verify', dir, out);
  assert.strictEqual(fail.status, 1);
  assert.match(fail.stdout, /FAIL/);
  assert.match(fail.stdout, /shrank/);
});
