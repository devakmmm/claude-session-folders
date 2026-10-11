// Checks the rules the Visual Studio Marketplace and vsce enforce at publish time,
// so a broken manifest fails here instead of at upload.
// Rules: https://code.visualstudio.com/api/working-with-extensions/publishing-extension
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file));
const exists = (file) => fs.existsSync(path.join(root, file));
const pkg = () => JSON.parse(read('package.json'));

test('name is lowercase and url-safe', () => {
  assert.match(pkg().name, /^[a-z0-9][a-z0-9-]*$/);
});

test('publisher, semver version and engines.vscode are set', () => {
  const p = pkg();
  assert.ok(p.publisher, 'publisher is required to publish');
  assert.match(p.version, /^\d+\.\d+\.\d+$/);
  assert.ok(p.engines && p.engines.vscode, 'engines.vscode is required');
});

test('license is declared and the LICENSE file exists', () => {
  assert.ok(pkg().license);
  assert.ok(exists('LICENSE'));
});

test('repository points at a public https url', () => {
  assert.match(pkg().repository.url, /^https:\/\/github\.com\/devakmmm\//);
});

test('icon is a PNG of at least 128x128', () => {
  const icon = read(pkg().icon);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(icon.subarray(0, 8).equals(signature), 'icon must be a PNG, never an SVG');
  assert.ok(icon.readUInt32BE(16) >= 128 && icon.readUInt32BE(20) >= 128);
});

test('README and CHANGELOG have no SVG or non-https images', () => {
  for (const file of ['README.md', 'CHANGELOG.md']) {
    const text = read(file).toString();
    const images = [...text.matchAll(/!\[[^\]]*\]\(([^)]+)\)|<img[^>]+src="([^"]+)"/g)];
    for (const [, md, html] of images) {
      const url = md || html;
      assert.ok(!/\.svg(\?|$)/i.test(url), `${file}: SVG image ${url}`);
      assert.ok(url.startsWith('https://'), `${file}: image must be https: ${url}`);
    }
  }
});

test('the Claude data folder setting comes from user settings only, so a workspace cannot redirect reads or writes', () => {
  const p = pkg();
  assert.strictEqual(p.contributes.configuration.properties['sessionFolders.claudeDir'].scope, 'machine');
  assert.strictEqual(p.capabilities.untrustedWorkspaces.supported, 'limited');
  assert.deepStrictEqual(p.capabilities.untrustedWorkspaces.restrictedConfigurations, ['sessionFolders.claudeDir']);
});

test('at most 30 keywords', () => {
  assert.ok((pkg().keywords || []).length <= 30);
});

test('every file the manifest references exists', () => {
  const p = pkg();
  const containers = Object.values(p.contributes.viewsContainers || {}).flat();
  for (const file of [p.main, p.icon, ...containers.map((c) => c.icon)]) {
    assert.ok(exists(file), `missing ${file}`);
  }
});
