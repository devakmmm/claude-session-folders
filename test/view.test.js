// The sidebar webview. Strict content security policy, scripts and styles only from media/,
// no inline script; state goes in by postMessage and user actions come back the same way.
const test = require('node:test');
const assert = require('node:assert');
const { SessionsView, dropAction, contextAction } = require('../src/view');

// The small part of the VS Code API the view uses.
function fakeVscode() {
  return { Uri: { joinPath: (base, ...parts) => ({ path: [base.path, ...parts].join('/') }) } };
}

function fakeWebviewView() {
  const posted = [];
  const listeners = {};
  const webview = {
    cspSource: 'https://webview.test',
    options: {},
    html: '',
    asWebviewUri: (uri) => `https://webview.test${uri.path}`,
    postMessage: (message) => { posted.push(message); return Promise.resolve(true); },
    onDidReceiveMessage: (cb) => { listeners.message = cb; return { dispose() {} }; },
  };
  const view = {
    webview,
    visible: true,
    onDidChangeVisibility: (cb) => { listeners.visibility = cb; return { dispose() {} }; },
  };
  return { view, webview, posted, listeners };
}

const EXT = { path: '/ext' };

test('the webview gets a strict content security policy, media/ files only, and no inline script', () => {
  const { view, webview } = fakeWebviewView();
  new SessionsView(fakeVscode(), EXT, {}).resolveWebviewView(view);
  assert.strictEqual(webview.options.enableScripts, true);
  assert.deepStrictEqual(webview.options.localResourceRoots, [{ path: '/ext/media' }]);
  assert.match(webview.html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src https:\/\/webview\.test; script-src https:\/\/webview\.test; img-src https:\/\/webview\.test;">/);
  const scripts = webview.html.match(/<script[^>]*>/g);
  assert.deepStrictEqual(scripts, [
    '<script src="https://webview.test/ext/media/render.js">',
    '<script src="https://webview.test/ext/media/view.js">',
  ]);
  assert.doesNotMatch(webview.html, /<script>|<style|\sstyle="|\son[a-z]+="/);
  assert.match(webview.html, /<link rel="stylesheet" href="https:\/\/webview\.test\/ext\/media\/view\.css">/);
});

test('state is posted to the webview, and posted again when the webview says it is ready', () => {
  const { view, posted, listeners } = fakeWebviewView();
  const sidebar = new SessionsView(fakeVscode(), EXT, {});
  sidebar.resolveWebviewView(view);
  const state = { view: { folders: [], unfiled: [] }, running: [] };
  sidebar.post(state);
  listeners.message({ type: 'ready' });
  assert.deepStrictEqual(posted, [{ type: 'state', state }, { type: 'state', state }]);
});

test('other messages from the webview go to the action handler; becoming visible is reported', () => {
  const { view, listeners } = fakeWebviewView();
  const actions = [];
  let visible = 0;
  new SessionsView(fakeVscode(), EXT, { onAction: (m) => actions.push(m), onVisible: () => { visible += 1; } }).resolveWebviewView(view);
  listeners.message({ type: 'action', action: 'newFolder' });
  listeners.visibility();
  view.visible = false;
  listeners.visibility();
  assert.deepStrictEqual(actions, [{ type: 'action', action: 'newFolder' }]);
  assert.strictEqual(visible, 1);
});

// Drag rules: from a folder = move, from Unfiled = add, onto a session (no folder) = nothing.
test('a drop from a folder moves, from Unfiled adds, onto a session or the same folder does nothing', () => {
  const drop = (fromFolderId, toFolderId) => dropAction({ type: 'drop', sessionIds: ['s1', 's2'], fromFolderId, toFolderId });
  assert.deepStrictEqual(drop('f1', 'f2'), { action: 'move', sessionIds: ['s1', 's2'], folderId: 'f1', toFolderId: 'f2' });
  assert.deepStrictEqual(drop(null, 'f2'), { action: 'add', sessionIds: ['s1', 's2'], folderId: null, toFolderId: 'f2' });
  assert.strictEqual(drop('f1', null), null);
  assert.strictEqual(drop('f1', 'f1'), null);
});

test('drops from the webview reach the action handler as move/add; ignored drops do not', () => {
  const { view, listeners } = fakeWebviewView();
  const actions = [];
  new SessionsView(fakeVscode(), EXT, { onAction: (m) => actions.push(m) }).resolveWebviewView(view);
  listeners.message({ type: 'drop', sessionIds: ['s1'], fromFolderId: null, toFolderId: 'f2' });
  listeners.message({ type: 'drop', sessionIds: ['s1'], fromFolderId: 'f1', toFolderId: null });
  assert.deepStrictEqual(actions, [{ action: 'add', sessionIds: ['s1'], folderId: null, toFolderId: 'f2' }]);
});

test('right-click menu commands get the ids from the row or folder they were opened on', () => {
  assert.deepStrictEqual(
    contextAction('move', { webviewSection: 'filedSession', folderId: 'f1', sessionIds: ['s1', 's2'] }),
    { action: 'move', sessionIds: ['s1', 's2'], folderId: 'f1' },
  );
  assert.deepStrictEqual(
    contextAction('rename', { webviewSection: 'folder', folderId: 'f3' }),
    { action: 'rename', sessionIds: [], folderId: 'f3' },
  );
});
