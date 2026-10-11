// READ-ONLY reader of Claude Code's data dir. Session files are opened for
// reading only; nothing here writes, renames or deletes anything.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

// A session file is named exactly <uuid>.jsonl. Claude Code's set-aside copies
// (<id>.orphaned-….jsonl, <id>.jsonl.superseded-…) and <id>/subagents/ are not sessions.
const SESSION_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/;

// A real user prompt: a non-meta user record whose text doesn't start with '<' (command and
// system markup). Tool results are user records with no text blocks, so they yield nothing.
function realPrompt(record) {
  if (record.type !== 'user' || record.isMeta || !record.message) return null;
  const content = record.message.content;
  const text = typeof content === 'string'
    ? content
    : (Array.isArray(content) ? content : []).filter((b) => b && b.type === 'text').map((b) => b.text).join(' ');
  const trimmed = text.trim();
  return trimmed && !trimmed.startsWith('<') ? trimmed.slice(0, 80) : null;
}

const HEAD = 64 * 1024;
const TAIL = 256 * 1024;
const noFacts = () => ({ cwd: null, prompt: null, customTitle: null, aiTitle: null });

function parse(line) {
  try {
    const record = JSON.parse(line);
    return record && typeof record === 'object' ? record : null;
  } catch {
    return null; // a line cut by a window edge, or a partial last line while Claude Code is writing
  }
}

// Feeds one line. `start` lines (the head, or a full read) may supply cwd and the first prompt;
// any line may supply a title (last one wins). Lines that can't change the result aren't parsed.
function observe(facts, line, start) {
  const wantStart = start && (!facts.cwd || !facts.prompt);
  if (!wantStart && !line.includes('Title')) return;
  const record = parse(line);
  if (!record) return;
  if (wantStart && !facts.cwd && typeof record.cwd === 'string') facts.cwd = record.cwd;
  if (wantStart && !facts.prompt) facts.prompt = realPrompt(record);
  if (typeof record.customTitle === 'string') facts.customTitle = record.customTitle;
  if (typeof record.aiTitle === 'string') facts.aiTitle = record.aiTitle;
}

function entrypointIn(lines) {
  for (const line of lines) {
    if (!line.includes('entrypoint')) continue;
    const record = parse(line);
    if (record && typeof record.entrypoint === 'string') return record.entrypoint;
  }
  return null;
}

// The first 64 KB and the last 256 KB as lines (the whole file when it is smaller than both).
async function readWindows(file) {
  const handle = await fs.promises.open(file, 'r');
  try {
    const { size, mtimeMs } = await handle.stat();
    const lines = async (position, length) => {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      return buffer.toString('utf8', 0, bytesRead).split('\n');
    };
    if (size <= HEAD + TAIL) {
      const all = await lines(0, size);
      return { size, mtimeMs, head: all, tail: all };
    }
    return { size, mtimeMs, head: await lines(0, HEAD), tail: await lines(size - TAIL, TAIL) };
  } finally {
    await handle.close();
  }
}

async function readSession(file) {
  const { size, mtimeMs, head, tail } = await readWindows(file);
  let facts = noFacts();
  for (const line of head) observe(facts, line, true);
  for (const line of tail) observe(facts, line, false);
  // The windows missed something only a whole read can find: cwd (a huge first line) or a title
  // that sits only in the middle of a big file. Stream the whole file; never hold it in memory.
  if (size > HEAD + TAIL && (!facts.cwd || (!facts.customTitle && !facts.aiTitle))) {
    facts = noFacts();
    const input = fs.createReadStream(file, { flags: 'r', encoding: 'utf8' });
    for await (const line of readline.createInterface({ input, crlfDelay: Infinity })) {
      observe(facts, line, true);
    }
  }
  const id = path.basename(file, '.jsonl');
  return {
    id,
    file,
    cwd: facts.cwd,
    lastActive: mtimeMs,
    title: facts.customTitle || facts.aiTitle || facts.prompt || `(untitled) ${id.slice(0, 8)}`,
    entrypoint: entrypointIn([...tail].reverse()) || entrypointIn(head),
  };
}

async function listSessions(claudeDir) {
  const root = path.join(claudeDir, 'projects');
  const sessions = [];
  if (!fs.existsSync(root)) return { sessions, health: { sessions: 0, unreadable: 0 } };
  for (const project of await fs.promises.readdir(root, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    for (const name of await fs.promises.readdir(path.join(root, project.name))) {
      if (SESSION_FILE.test(name)) sessions.push(await readSession(path.join(root, project.name, name)));
    }
  }
  const unreadable = sessions.filter((s) => s.cwd === null).length;
  return { sessions, health: { sessions: sessions.length, unreadable } };
}

// Claude Code's running-session list: one <pid>.json per live session. Only *.json files are
// read; the *.key files next to them hold tokens and are never opened.
async function readRunning(claudeDir) {
  const dir = path.join(claudeDir, 'sessions');
  if (!fs.existsSync(dir)) return [];
  const running = [];
  for (const name of await fs.promises.readdir(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const { sessionId, entrypoint } = JSON.parse(await fs.promises.readFile(path.join(dir, name), 'utf8'));
      if (typeof sessionId === 'string') running.push({ sessionId, entrypoint });
    } catch {
      continue; // a file Claude Code is still writing
    }
  }
  return running;
}

// Claude Code's cleanupPeriodDays from settings.json (read-only); its default is 30.
function readRetentionDays(claudeDir) {
  try {
    const { cleanupPeriodDays } = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8'));
    return Number.isInteger(cleanupPeriodDays) && cleanupPeriodDays >= 1 ? cleanupPeriodDays : 30;
  } catch {
    return 30; // no settings file yet, or one we can't parse: Claude Code uses its default too
  }
}

module.exports = { listSessions, readRunning, readRetentionDays };
