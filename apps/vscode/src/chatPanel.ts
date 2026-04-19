import * as vscode from 'vscode';
import { createSession, startChatStream } from './kodaClient';

export class ChatPanel {
  static currentPanel: ChatPanel | undefined;
  private static readonly viewType = 'kodaChat';

  private readonly _panel: vscode.WebviewPanel;
  private _sessionId: string | undefined;
  private _cancelStream: (() => void) | undefined;
  private _disposables: vscode.Disposable[] = [];

  static createOrShow(context: vscode.ExtensionContext): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (ChatPanel.currentPanel) {
      ChatPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ChatPanel.viewType,
      'Koda Chat',
      column ?? vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    ChatPanel.currentPanel = new ChatPanel(panel, context);
  }

  private constructor(panel: vscode.WebviewPanel, _context: vscode.ExtensionContext) {
    this._panel = panel;
    this._panel.webview.html = this._getHtml();

    this._panel.onDidDispose(() => this._dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(
      (msg: { type: string; text?: string }) => this._handleMessage(msg),
      null,
      this._disposables,
    );

    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    createSession(cwd).then((id) => {
      this._sessionId = id;
    }).catch((e: Error) => {
      vscode.window.showErrorMessage(`Koda: failed to create session: ${e.message}`);
    });
  }

  private async _handleMessage(msg: { type: string; text?: string }): Promise<void> {
    if (msg.type !== 'chat' || !msg.text) return;
    if (!this._sessionId) {
      vscode.window.showErrorMessage('Koda: session not ready yet');
      return;
    }

    this._panel.webview.postMessage({ type: 'userMessage', text: msg.text });
    this._panel.webview.postMessage({ type: 'assistantStart' });

    this._cancelStream?.();
    this._cancelStream = startChatStream(this._sessionId, msg.text, {
      onText: (t) => {
        this._panel.webview.postMessage({ type: 'assistantToken', text: t });
      },
      onDone: () => {
        this._panel.webview.postMessage({ type: 'assistantDone' });
        this._cancelStream = undefined;
      },
      onError: (e) => {
        this._panel.webview.postMessage({ type: 'assistantError', text: e.message });
        this._cancelStream = undefined;
      },
    });
  }

  private _getHtml(): string {
    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Koda Chat</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }
  #messages {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .bubble {
    max-width: 90%;
    padding: 8px 12px;
    border-radius: 8px;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.5;
  }
  .bubble.user {
    align-self: flex-end;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .bubble.assistant {
    align-self: flex-start;
    background: var(--vscode-editor-inactiveSelectionBackground);
  }
  .bubble.error {
    align-self: flex-start;
    background: var(--vscode-inputValidation-errorBackground);
    color: var(--vscode-inputValidation-errorForeground);
  }
  #input-area {
    display: flex;
    padding: 8px;
    gap: 6px;
    border-top: 1px solid var(--vscode-panel-border);
  }
  #input {
    flex: 1;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 4px;
    padding: 6px 8px;
    font-family: inherit;
    font-size: inherit;
    resize: none;
    min-height: 36px;
    max-height: 120px;
  }
  #input:focus { outline: 1px solid var(--vscode-focusBorder); }
  button {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 4px;
    padding: 6px 14px;
    cursor: pointer;
    font-size: inherit;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
</style>
</head>
<body>
<div id="messages"></div>
<div id="input-area">
  <textarea id="input" placeholder="Ask Koda…" rows="1"></textarea>
  <button id="send">Send</button>
</div>
<script>
  const vscode = acquireVsCodeApi();
  const messages = document.getElementById('messages');
  const input = document.getElementById('input');
  const sendBtn = document.getElementById('send');

  function scrollBottom() {
    messages.scrollTop = messages.scrollHeight;
  }

  function addBubble(cls, text) {
    const el = document.createElement('div');
    el.className = 'bubble ' + cls;
    el.textContent = text;
    messages.appendChild(el);
    scrollBottom();
    return el;
  }

  let currentBubble = null;

  function send() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';
    vscode.postMessage({ type: 'chat', text });
  }

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.type === 'userMessage') {
      addBubble('user', msg.text);
    } else if (msg.type === 'assistantStart') {
      currentBubble = addBubble('assistant', '');
    } else if (msg.type === 'assistantToken') {
      if (currentBubble) {
        currentBubble.textContent += msg.text;
        scrollBottom();
      }
    } else if (msg.type === 'assistantDone') {
      currentBubble = null;
    } else if (msg.type === 'assistantError') {
      addBubble('error', 'Error: ' + msg.text);
      currentBubble = null;
    }
  });
</script>
</body>
</html>`;
  }

  private _dispose(): void {
    this._cancelStream?.();
    ChatPanel.currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) d.dispose();
    this._disposables = [];
  }
}
