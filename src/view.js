// The sidebar webview. It only shows what it is sent: state goes in by postMessage,
// and every user action comes back as a message for commands.js to carry out. Takes `vscode` as a
// parameter so it can be tested without VS Code.
class SessionsView {
  // hooks: { onAction(message), onVisible() }
  constructor(vscode, extensionUri, hooks) {
    this.vscode = vscode;
    this.extensionUri = extensionUri;
    this.hooks = hooks;
    this.view = null;
    this.state = null;
  }

  resolveWebviewView(view) {
    this.view = view;
    const { webview } = view;
    const media = this.vscode.Uri.joinPath(this.extensionUri, 'media');
    webview.options = { enableScripts: true, localResourceRoots: [media] };
    webview.html = page(webview, (file) => webview.asWebviewUri(this.vscode.Uri.joinPath(media, file)));
    webview.onDidReceiveMessage((message) => {
      // Messages posted before the webview's script loads can be lost, so it asks once it is ready.
      if (message.type === 'ready') this.send();
      else if (message.type === 'drop') {
        const action = dropAction(message);
        if (action && this.hooks.onAction) this.hooks.onAction(action);
      } else if (this.hooks.onAction) this.hooks.onAction(message);
    });
    view.onDidChangeVisibility(() => {
      if (view.visible && this.hooks.onVisible) this.hooks.onVisible();
    });
  }

  post(state) {
    this.state = state;
    this.send();
  }

  send() {
    if (this.view && this.state) this.view.webview.postMessage({ type: 'state', state: this.state });
  }
}

// No inline script or style anywhere: the policy allows files from media/ only.
function page(webview, asset) {
  const src = webview.cspSource;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${src}; script-src ${src}; img-src ${src};">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${asset('view.css')}">
</head>
<body>
<div id="root"></div>
<script src="${asset('render.js')}"></script>
<script src="${asset('view.js')}"></script>
</body>
</html>`;
}

// Drag rules: from a folder = move, from Unfiled = add, onto a session (no target folder) or
// back onto the same folder = nothing.
function dropAction({ sessionIds, fromFolderId, toFolderId }) {
  if (!toFolderId || toFolderId === fromFolderId) return null;
  return { action: fromFolderId ? 'move' : 'add', sessionIds, folderId: fromFolderId || null, toFolderId };
}

// A right-click menu command gets the data-vscode-context of the row or folder it was opened on.
function contextAction(action, context) {
  return { action, sessionIds: context.sessionIds || [], folderId: context.folderId || null };
}

module.exports = { SessionsView, dropAction, contextAction };
