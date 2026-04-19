import * as vscode from 'vscode';
import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createSession, startChatStream, getConfig } from './kodaClient';
import { ChatPanel } from './chatPanel';

const MAX_ITERATIONS = 3;
const TEST_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = 4000;

function detectTestCommand(cwd: string): string | null {
  try {
    const pkgPath = path.join(cwd, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { scripts?: Record<string, string> };
    if (pkg.scripts?.test) return 'npm test';
    if (pkg.scripts?.['test:run']) return 'npm run test:run';
  } catch {
    // not a node project
  }
  if (fs.existsSync(path.join(cwd, 'Makefile'))) {
    const mk = fs.readFileSync(path.join(cwd, 'Makefile'), 'utf-8');
    if (/^test:/m.test(mk)) return 'make test';
  }
  if (fs.existsSync(path.join(cwd, 'pytest.ini')) || fs.existsSync(path.join(cwd, 'setup.py'))) {
    return 'pytest';
  }
  return null;
}

function runCommand(cmd: string, cwd: string): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    const [bin, ...args] = cmd.split(' ');
    const proc = cp.spawn(bin!, args, { cwd, shell: true, timeout: TEST_TIMEOUT_MS });
    let out = '';
    proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { out += d.toString(); });
    proc.on('close', (code) => {
      resolve({ exitCode: code ?? 1, output: out.slice(0, MAX_OUTPUT_CHARS) });
    });
    proc.on('error', (e) => {
      resolve({ exitCode: 1, output: e.message });
    });
  });
}

function waitForDone(sessionId: string, message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cancel = startChatStream(sessionId, message, {
      onText: () => {},
      onDone: () => { cancel(); resolve(); },
      onError: (e) => { cancel(); reject(e); },
    });
  });
}

export async function runFixLoop(context: vscode.ExtensionContext): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showErrorMessage('Koda: no workspace folder open');
    return;
  }
  const cwd = folder.uri.fsPath;

  const cfg = getConfig();
  const cfgTestCmd = vscode.workspace.getConfiguration('koda').get<string>('testCommand');
  const testCmd = cfgTestCmd || detectTestCommand(cwd);

  if (!testCmd) {
    vscode.window.showErrorMessage(
      'Koda: could not detect test command. Set koda.testCommand in settings.',
    );
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Koda Run & Auto-Fix',
      cancellable: false,
    },
    async (progress) => {
      let sessionId: string;
      try {
        progress.report({ message: 'Creating Koda session…' });
        sessionId = await createSession(cwd);
      } catch (e) {
        vscode.window.showErrorMessage(`Koda: ${(e as Error).message}`);
        return;
      }

      for (let i = 1; i <= MAX_ITERATIONS; i++) {
        progress.report({ message: `Running tests (attempt ${i}/${MAX_ITERATIONS})…` });
        const { exitCode, output } = await runCommand(testCmd, cwd);

        if (exitCode === 0) {
          vscode.window.showInformationMessage('Koda: All tests pass!');
          return;
        }

        progress.report({ message: `Tests failed — asking Koda to fix (attempt ${i})…` });
        const prompt =
          `The following test command failed: \`${testCmd}\`\n\n` +
          `Apply fixes to make the tests pass.\n\n` +
          `Test output:\n\`\`\`\n${output}\n\`\`\``;

        try {
          await waitForDone(sessionId, prompt);
        } catch (e) {
          vscode.window.showErrorMessage(`Koda: stream error: ${(e as Error).message}`);
          return;
        }
      }

      vscode.window.showWarningMessage(
        `Koda: could not auto-fix after ${MAX_ITERATIONS} attempts — opening chat for manual follow-up.`,
      );
      ChatPanel.createOrShow(context);
    },
  );
}
