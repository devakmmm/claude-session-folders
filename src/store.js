// The only module that writes, and it writes only the two files below,
// inside claudeDir. test/readonly.test.js fails if any other src/ file gains a write call.
const fs = require('node:fs');
const path = require('node:path');

const { version: VERSION } = require('../package.json');

// The only two files this extension ever writes. Paths are built from these names only.
const CHOICES_FILE = 'session-folders.json';
const INDEX_FILE = 'session-folders.index.json';

// Only "file not found" means no folders. Anything else (bad JSON, unknown version, a read error
// while antivirus or a sync tool holds the file) is read-only mode: choices is null and nothing is
// written until the file can be read again, so we never overwrite what we couldn't read.
function readChoices(claudeDir) {
  let text;
  try {
    text = fs.readFileSync(path.join(claudeDir, CHOICES_FILE), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { choices: { version: 1, folders: [] }, readOnly: false };
    return { choices: null, readOnly: true, reason: err.message };
  }
  let choices;
  try {
    choices = JSON.parse(text);
  } catch (err) {
    return { choices: null, readOnly: true, reason: `not valid JSON: ${err.message}` };
  }
  if (!choices || choices.version !== 1 || !Array.isArray(choices.folders)) {
    return { choices: null, readOnly: true, reason: 'unknown version' };
  }
  return { choices, readOnly: false };
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Write a temp file, then rename it over the target, so a reader never sees half a file.
// One retry after 100 ms when Windows reports the target briefly held (EPERM/EBUSY).
function writeAtomic(target, text) {
  const temp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(temp, text);
  try {
    try {
      fs.renameSync(temp, target);
    } catch (err) {
      if (err.code !== 'EPERM' && err.code !== 'EBUSY') throw err;
      sleep(100);
      fs.renameSync(temp, target);
    }
  } catch (err) {
    fs.rmSync(temp, { force: true });
    throw err;
  }
}

// Read fresh, apply one folder operation, write. Called only on a user action.
function update(claudeDir, op) {
  const read = readChoices(claudeDir);
  if (read.readOnly) return read;
  const next = op(read.choices);
  writeAtomic(path.join(claudeDir, CHOICES_FILE), JSON.stringify(next, null, 2) + '\n');
  return { choices: next, readOnly: false };
}

// The generated index agents read: only filed sessions, rebuilt whole from the choices file
// as it is now. Not written in read-only mode, so it never disagrees with a file we couldn't read.
function writeIndex(claudeDir, { sessions, health, retentionDays }) {
  const read = readChoices(claudeDir);
  if (read.readOnly) return read;
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const index = {
    version: 1,
    generatedAt: new Date().toISOString(),
    generator: `claude-session-folders ${VERSION}`,
    note: 'Generated. Do not edit; folders live in session-folders.json.',
    folders: read.choices.folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      color: folder.color,
      sessions: folder.sessions.map((entry) => {
        const s = byId.get(entry.id);
        if (!s) return { id: entry.id, title: entry.title, deleted: true };
        return { id: s.id, title: s.title, cwd: s.cwd, file: s.file, lastActive: new Date(s.lastActive).toISOString() };
      }),
    })),
    health,
    retentionDays,
  };
  writeAtomic(path.join(claudeDir, INDEX_FILE), JSON.stringify(index, null, 2) + '\n');
  return read;
}

module.exports = { readChoices, update, writeIndex };
