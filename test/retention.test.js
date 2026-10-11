// Claude Code deletes session files older than cleanupPeriodDays (default 30) when it starts,
// with no trash. The sidebar says so, and warns on a filed session that is about to go.
const test = require('node:test');
const assert = require('node:assert');
const { readRetentionDays } = require('../src/scan');
const { retentionNotice, deletionWarning } = require('../media/render');
const f = require('./fixtures/claude');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 11, 12);

test('retention days come from settings.json cleanupPeriodDays; missing file, key or bad JSON means 30', () => {
  const dir = f.makeClaudeDir();
  assert.strictEqual(readRetentionDays(dir), 30);
  f.writeFile(dir, 'settings.json', '{"model": "opus"}');
  assert.strictEqual(readRetentionDays(dir), 30);
  f.writeFile(dir, 'settings.json', '{ not json');
  assert.strictEqual(readRetentionDays(dir), 30);
  f.writeFile(dir, 'settings.json', '{"cleanupPeriodDays": 90}');
  assert.strictEqual(readRetentionDays(dir), 90);
});

test('the notice shows under 365 days and not at 365 or more', () => {
  assert.strictEqual(retentionNotice(30), 'Claude Code deletes sessions after 30 days, including ones in your folders.');
  assert.strictEqual(retentionNotice(364), 'Claude Code deletes sessions after 364 days, including ones in your folders.');
  assert.strictEqual(retentionNotice(365), null);
  assert.strictEqual(retentionNotice(1000), null);
});

test('a session within 7 days of the cutoff is warned; Claude Desktop sessions are kept at any age', () => {
  const at = (daysAgo, entrypoint = 'claude-vscode') => ({ lastActive: NOW - daysAgo * DAY, entrypoint });
  assert.strictEqual(deletionWarning(at(20), 30, NOW), null);
  assert.strictEqual(deletionWarning(at(23), 30, NOW), 'deleted in 7 days');
  assert.strictEqual(deletionWarning(at(29.5), 30, NOW), 'deleted in 1 day');
  assert.strictEqual(deletionWarning(at(31), 30, NOW), 'deleted when Claude Code next starts');
  assert.strictEqual(deletionWarning(at(29.5, 'claude-desktop'), 30, NOW), null);
});
