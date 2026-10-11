// The sidebar's HTML. Titles come from transcripts and can contain anything, so every title
// and folder name must come out as text, never as markup.
const test = require('node:test');
const assert = require('node:assert');
const { render } = require('../media/render');

const NOW = Date.UTC(2026, 9, 11, 12);
const HOUR = 60 * 60 * 1000;
const session = (id, title, extra = {}) => ({
  id, title, file: `${id}.jsonl`, cwd: 'C:\\work\\api', lastActive: NOW - 2 * HOUR, entrypoint: 'claude-vscode', ...extra,
});
const state = (over = {}) => ({
  view: { folders: [], unfiled: [] },
  running: [],
  health: { sessions: 0, unreadable: 0 },
  retentionDays: 365,
  now: NOW,
  readOnly: null,
  ...over,
});

test('titles and folder names render as text, never as markup', () => {
  const html = render(state({
    view: {
      folders: [{ id: 'f1', name: '<img src=x onerror=alert(1)>', color: 'orange', sessions: [session('s1', '"quoted" & <b>bold</b>')] }],
      unfiled: [session('s2', '<script>alert(1)</script>')],
    },
  }));
  assert.doesNotMatch(html, /<script|<img|<b>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&quot;quoted&quot; &amp; &lt;b&gt;bold&lt;\/b&gt;/);
});

test('running sessions get the live diamond and the header counts them; folder colors come from the palette only', () => {
  const html = render(state({
    view: {
      folders: [
        { id: 'f1', name: 'Docs', color: 'orange', sessions: [session('s1', 'live one'), session('s2', 'idle one')] },
        { id: 'f2', name: 'Odd', color: 'hot pink', sessions: [] },
      ],
      unfiled: [session('s3', 'also live')],
    },
    running: ['s1', 's3'],
  }));
  assert.match(html, /2 LIVE/);
  assert.strictEqual((html.match(/class="live"/g) || []).length, 2);
  assert.match(html, /data-session="s1"[^>]*><span class="live"><\/span>/);
  assert.match(html, /data-session="s2"[^>]*><span class="idle"><\/span>/);
  assert.match(html, /class="dia c-orange"/);
  assert.match(html, /class="dia c-none"/);
  assert.doesNotMatch(html, /hot pink/);
});

test('session rows: age · project, a headless tag for sdk-cli runs, deleted rows greyed, tooltip with folders, cwd and id', () => {
  const html = render(state({
    view: {
      folders: [
        { id: 'f1', name: 'Docs', color: 'orange', sessions: [session('s1', 'filed twice'), { id: 'gone', title: '(deleted) old work', deleted: true }] },
        { id: 'f2', name: 'Review', color: 'blue', sessions: [session('s1', 'filed twice')] },
      ],
      unfiled: [session('s2', 'nightly report', { entrypoint: 'sdk-cli', lastActive: NOW - 3 * 24 * HOUR, cwd: '/home/dev/web' })],
    },
  }));
  assert.match(html, /<span class="t">filed twice<\/span><span class="m">2 h · api<\/span>/);
  assert.match(html, /<span class="t">nightly report<\/span><span class="m">3 days · web<\/span><span class="tag">headless<\/span>/);
  assert.match(html, /<div class="row gone" data-session="gone"[^>]*><span class="idle"><\/span><span class="t">\(deleted\) old work<\/span><span class="acts">/);
  assert.match(html, /title="filed twice\nIn: Docs, Review\nC:\\work\\api\ns1"/);
});

test('notices: health line at 10% unreadable or more, retention notice with Open settings, deletion warning on filed rows only', () => {
  const old = (id) => session(id, `old ${id}`, { lastActive: NOW - 26 * 24 * HOUR });
  const html = render(state({
    view: { folders: [{ id: 'f1', name: 'Docs', color: 'red', sessions: [old('s1')] }], unfiled: [old('s2')] },
    health: { sessions: 20, unreadable: 2 },
    retentionDays: 30,
  }));
  assert.match(html, /Couldn&#39;t read 2 of 20 sessions — the session format may have changed\./);
  assert.match(html, /Claude Code deletes sessions after 30 days, including ones in your folders\./);
  assert.match(html, /<button[^>]*data-action="openSettings"[^>]*>Open settings<\/button>/);
  assert.strictEqual((html.match(/deleted in 4 days/g) || []).length, 1);
  assert.match(html, /old s1<\/span><span class="m">[^<]*<\/span><span class="warn">deleted in 4 days<\/span>/);

  const calm = render(state({ health: { sessions: 20, unreadable: 1 }, retentionDays: 365 }));
  assert.doesNotMatch(calm, /Couldn&#39;t read|deletes sessions|openSettings/);
});

test('actions: rows open on click; hover offers Move/Remove in a folder, Add when unfiled; folder headers offer Rename/Color/Delete', () => {
  const html = render(state({
    view: {
      folders: [{ id: 'f1', name: 'Docs', color: 'red', sessions: [session('s1', 'filed'), { id: 'gone', title: '(deleted) old', deleted: true }] }],
      unfiled: [session('s2', 'loose')],
    },
  }));
  const rowOf = (id) => html.match(new RegExp(`<div class="row[^"]*" data-session="${id}"[\\s\\S]*?</div>`))[0];
  const actionsIn = (fragment) => [...fragment.matchAll(/data-action="([a-z]+)"/gi)].map((m) => m[1]);
  assert.deepStrictEqual(actionsIn(rowOf('s1')), ['open', 'move', 'remove']);
  assert.deepStrictEqual(actionsIn(rowOf('s2')), ['open', 'add']);
  assert.deepStrictEqual(actionsIn(rowOf('gone')), ['remove']);
  assert.match(rowOf('s1'), /tabindex="0"/);
  const header = html.match(/<div class="fh"[\s\S]*?<\/div>/)[0];
  assert.deepStrictEqual(actionsIn(header), ['toggle', 'rename', 'color', 'delete']);
});

test('drag and right-click: live rows are draggable; each row and folder carries its menu context; a selection travels together', () => {
  const html = render(state({
    view: {
      folders: [{ id: 'f1', name: 'Docs', color: 'red', sessions: [session('s1', 'a'), session('s2', 'b'), session('s3', 'c'), { id: 'gone', title: '(deleted) d', deleted: true }] }],
      unfiled: [session('s4', 'e')],
    },
  }), { selected: { container: 'f1', ids: ['s1', 's3'] } });
  const tagOf = (id) => html.match(new RegExp(`<div class="row[^"]*" data-session="${id}"[^>]*>`))[0];
  const contextOf = (tag) => JSON.parse(tag.match(/data-vscode-context="([^"]*)"/)[1].replace(/&quot;/g, '"'));
  const menu = { preventDefaultContextMenuItems: true };
  assert.deepStrictEqual(contextOf(tagOf('s1')), { webviewSection: 'filedSession', folderId: 'f1', sessionIds: ['s1', 's3'], ...menu });
  assert.deepStrictEqual(contextOf(tagOf('s2')), { webviewSection: 'filedSession', folderId: 'f1', sessionIds: ['s2'], ...menu });
  assert.deepStrictEqual(contextOf(tagOf('gone')), { webviewSection: 'deletedSession', folderId: 'f1', sessionIds: ['gone'], ...menu });
  assert.deepStrictEqual(contextOf(tagOf('s4')), { webviewSection: 'unfiledSession', sessionIds: ['s4'], ...menu });
  assert.deepStrictEqual(contextOf(html.match(/<div class="fh"[^>]*>/)[0]), { webviewSection: 'folder', folderId: 'f1', ...menu });
  assert.match(tagOf('s1'), /class="row sel"/);
  assert.match(tagOf('s1'), /draggable="true"/);
  assert.doesNotMatch(tagOf('s2'), /class="row sel"/);
  assert.doesNotMatch(tagOf('gone'), /draggable/);
});

test('read-only mode shows the message and no lists (we could not read what is filed)', () => {
  const html = render(state({ readOnly: 'EBUSY: resource busy or locked', view: { folders: [], unfiled: [session('s1', 'visible?')] } }));
  assert.match(html, /Folders file is busy or unreadable — not saving anything until it can be read\./);
  assert.doesNotMatch(html, /visible\?|Unfiled|data-action="newFolder"/);
});

test('the header credits the author: "by devakmmm" opens the website and "LinkedIn" the profile, also in read-only mode', () => {
  for (const html of [render(state()), render(state({ readOnly: 'EBUSY: resource busy or locked' }))]) {
    const header = html.match(/<header class="head">[\s\S]*?<\/header>/)[0];
    assert.match(header, /<a class="by" href="https:\/\/devak-mehta\.vercel\.app"[^>]*>by devakmmm/);
    assert.match(header, /<a class="by" href="https:\/\/www\.linkedin\.com\/in\/devak-mehta"[^>]*>LinkedIn/);
  }
});

test('a New folder button and a first-run hint; a collapsed folder keeps its header and hides its rows', () => {
  const empty = render(state({ view: { folders: [], unfiled: [session('s1', 'first session')] } }));
  assert.match(empty, /<button[^>]*data-action="newFolder"[^>]*>New folder<\/button>/);
  assert.match(empty, /No folders yet\. Create one, then add sessions to it\./);

  const s = state({ view: {
    folders: [
      { id: 'f1', name: 'Closed', color: 'red', sessions: [session('s1', 'hidden row')] },
      { id: 'f2', name: 'Open', color: 'blue', sessions: [session('s2', 'shown row')] },
    ],
    unfiled: [],
  } });
  const html = render(s, { collapsed: ['f1'] });
  assert.match(html, /data-folder="f1"[\s\S]*?data-action="toggle" aria-expanded="false"/);
  assert.match(html, /data-folder="f2"[\s\S]*?data-action="toggle" aria-expanded="true"/);
  assert.doesNotMatch(html, /hidden row/);
  assert.match(html, /shown row/);
  assert.doesNotMatch(html, /No folders yet/);
});
