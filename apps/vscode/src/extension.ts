import * as vscode from 'vscode';
import { ChatPanel } from './chatPanel';
import { runFixLoop } from './runFixLoop';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('koda.openChat', () => {
      ChatPanel.createOrShow(context);
    }),
    vscode.commands.registerCommand('koda.runAndFix', () => {
      runFixLoop(context);
    }),
  );
}

export function deactivate(): void {}
