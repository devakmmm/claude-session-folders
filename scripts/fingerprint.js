// Release check: proves no session transcript was deleted, cut short or edited.
//   node scripts/fingerprint.js snapshot <claudeDir> <snapshot.json>
//   node scripts/fingerprint.js verify   <claudeDir> <snapshot.json>
// Every *.jsonl under <claudeDir>/projects (sessions and subagent transcripts) may grow, because
// Claude Code appends to live sessions, but must never shrink, vanish or change its old bytes.
// Read-only on <claudeDir>. Never packaged (.vscodeignore).
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function listFiles(claudeDir) {
  const root = path.join(claudeDir, 'projects');
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(path.relative(claudeDir, full).split(path.sep).join('/'));
      }
    }
  };
  walk(root);
  return files;
}

// Hashes the first `length` bytes (the whole file when omitted).
function sha256(file, length) {
  const bytes = fs.readFileSync(file);
  return crypto.createHash('sha256').update(bytes.subarray(0, length)).digest('hex');
}

function snapshot(claudeDir) {
  const files = {};
  for (const file of listFiles(claudeDir)) {
    const full = path.join(claudeDir, file);
    files[file] = { size: fs.statSync(full).size, sha256: sha256(full) };
  }
  return { files };
}

function verify(claudeDir, snap) {
  const failures = [];
  for (const [file, old] of Object.entries(snap.files)) {
    const full = path.join(claudeDir, file);
    if (!fs.existsSync(full)) failures.push({ file, reason: 'deleted' });
    else if (fs.statSync(full).size < old.size) failures.push({ file, reason: 'shrank' });
    else if (sha256(full, old.size) !== old.sha256) failures.push({ file, reason: 'changed' });
  }
  const added = listFiles(claudeDir).filter((file) => !(file in snap.files));
  return { pass: failures.length === 0, failures, added };
}

function main([command, claudeDir, file]) {
  if (command === 'snapshot' && claudeDir && file) {
    const snap = snapshot(claudeDir);
    fs.writeFileSync(file, JSON.stringify(snap, null, 2));
    console.log(`snapshot: ${Object.keys(snap.files).length} session files -> ${file}`);
    return 0;
  }
  if (command === 'verify' && claudeDir && file) {
    const result = verify(claudeDir, JSON.parse(fs.readFileSync(file, 'utf8')));
    for (const { file: f, reason } of result.failures) console.log(`${reason}: ${f}`);
    console.log(`new files: ${result.added.length}`);
    console.log(result.pass ? 'PASS' : `FAIL: ${result.failures.length} session files shrank, changed or vanished`);
    return result.pass ? 0 : 1;
  }
  console.log('usage: node scripts/fingerprint.js snapshot|verify <claudeDir> <snapshot.json>');
  return 2;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { snapshot, verify };
