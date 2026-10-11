// Builds a SYNTHETIC Claude data dir in a temp folder. Every record here is hand-written in the
// shape Claude Code uses (key names checked 2026-10-11); no real transcript content.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CWD = 'C:\\work\\app';
const PROJECT = 'c--work-app';

function makeClaudeDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-'));
  fs.mkdirSync(path.join(dir, 'projects'));
  return dir;
}

function writeFile(dir, rel, text) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  return full;
}

function addSession(dir, id, records, project = PROJECT) {
  const text = records.map((r) => (typeof r === 'string' ? r : JSON.stringify(r)) + '\n').join('');
  return writeFile(dir, `projects/${project}/${id}.jsonl`, text);
}

const user = (content, extra = {}) => ({
  type: 'user', message: { role: 'user', content }, cwd: CWD, entrypoint: 'claude-vscode', ...extra,
});
const assistant = (text) => ({
  type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] }, cwd: CWD,
  entrypoint: 'claude-vscode',
});
const aiTitle = (title) => ({ type: 'ai-title', aiTitle: title });
const customTitle = (title) => ({ type: 'custom-title', customTitle: title });

module.exports = { CWD, PROJECT, makeClaudeDir, writeFile, addSession, user, assistant, aiTitle, customTitle };
