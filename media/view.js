// Webview side of the sidebar. Draws whatever state the extension posts (render.js escapes every
// title), keeps per-viewer view state (collapsed folders, the selection), and posts user actions
// and drops back. It never touches files.
(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');
  const ui = Object.assign({ collapsed: [] }, vscode.getState());
  ui.selected = { container: null, ids: [] }; // not kept across reloads
  let state = null;
  let lastClicked = null;
  let drag = null;

  function draw() {
    if (state) root.innerHTML = SessionFoldersRender.render(state, ui);
  }

  function toggle(folderId) {
    ui.collapsed = ui.collapsed.includes(folderId)
      ? ui.collapsed.filter((id) => id !== folderId)
      : [...ui.collapsed, folderId];
    vscode.setState({ collapsed: ui.collapsed });
    draw();
  }

  // A selection lives in one container (a folder id, or 'unfiled') so a move has one source.
  const containerOf = (rowEl) => (rowEl.closest('[data-folder]') ? rowEl.closest('[data-folder]').dataset.folder : 'unfiled');

  function rowsIn(container) {
    const scope = container === 'unfiled' ? root.querySelectorAll('.body > [data-session]') : root.querySelectorAll('[data-folder] [data-session]');
    return [...scope].filter((el) => containerOf(el) === container).map((el) => el.dataset.session);
  }

  function select(rowEl, range) {
    const container = containerOf(rowEl);
    const id = rowEl.dataset.session;
    if (ui.selected.container !== container) ui.selected = { container, ids: [] };
    if (range && lastClicked && lastClicked.container === container) {
      const order = rowsIn(container);
      const [a, b] = [order.indexOf(lastClicked.id), order.indexOf(id)].sort((x, y) => x - y);
      ui.selected.ids = [...new Set([...ui.selected.ids, ...order.slice(a, b + 1)])];
    } else {
      ui.selected.ids = ui.selected.ids.includes(id) ? ui.selected.ids.filter((x) => x !== id) : [...ui.selected.ids, id];
    }
    lastClicked = { container, id };
    draw();
  }

  // The row's own id, or the whole selection when the row is part of it.
  function idsFor(rowEl) {
    const id = rowEl.dataset.session;
    const inSelection = ui.selected.container === containerOf(rowEl) && ui.selected.ids.includes(id);
    return inSelection ? ui.selected.ids : [id];
  }

  function clearSelection() {
    ui.selected = { container: null, ids: [] };
    lastClicked = null;
  }

  function act(event) {
    const el = event.target.closest('[data-action]');
    if (!el) return;
    const { action } = el.dataset;
    const folder = el.closest('[data-folder]');
    const row = el.closest('[data-session]');
    if (action === 'toggle') return toggle(folder.dataset.folder);
    if (action === 'open' && (event.ctrlKey || event.metaKey || event.shiftKey)) return select(row, event.shiftKey);
    const sessionIds = row ? idsFor(row) : [];
    if (action === 'open') {
      clearSelection();
      draw();
    }
    vscode.postMessage({ type: 'action', action, folderId: folder ? folder.dataset.folder : null, sessionIds });
  }

  // Drops land on a folder, but not on a session row inside it (dropping onto a session does nothing).
  function dropTarget(el) {
    if (el.closest('[data-session]')) return null;
    return el.closest('[data-folder]');
  }

  function clearDropMarks() {
    root.querySelectorAll('.folder.drop').forEach((el) => el.classList.remove('drop'));
  }

  window.addEventListener('message', (event) => {
    if (event.data.type === 'state') {
      state = event.data.state;
      draw();
    }
  });
  root.addEventListener('click', act);
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      clearSelection();
      draw();
    } else if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-action="toggle"], [data-action="open"]')) {
      event.preventDefault();
      act(event);
    }
  });
  root.addEventListener('dragstart', (event) => {
    const row = event.target.closest('[data-session]');
    if (!row) return;
    const folder = row.closest('[data-folder]');
    drag = { sessionIds: idsFor(row), fromFolderId: folder ? folder.dataset.folder : null };
    event.dataTransfer.setData('text/plain', drag.sessionIds.join('\n'));
    event.dataTransfer.effectAllowed = 'move';
  });
  root.addEventListener('dragover', (event) => {
    const target = drag && dropTarget(event.target);
    clearDropMarks();
    if (!target) return;
    event.preventDefault();
    target.classList.add('drop');
  });
  root.addEventListener('dragend', () => {
    drag = null;
    clearDropMarks();
  });
  root.addEventListener('drop', (event) => {
    event.preventDefault();
    const target = dropTarget(event.target);
    if (drag) vscode.postMessage({ type: 'drop', ...drag, toFolderId: target ? target.dataset.folder : null });
    drag = null;
    clearDropMarks();
  });

  vscode.postMessage({ type: 'ready' });
})();
