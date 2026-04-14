import { app, BrowserWindow, shell, utilityProcess } from 'electron';
import type { UtilityProcess } from 'electron';
import path from 'path';
import http from 'http';
import fs from 'fs';

const isDev = !app.isPackaged;
const BACKEND_PORT = 4001;
const FRONTEND_PORT = 4000;

/**
 * Resolve a path relative to project root (dev) or resources dir (production).
 */
function res(...parts: string[]): string {
  return isDev
    ? path.join(__dirname, '..', ...parts)
    : path.join(process.resourcesPath, ...parts);
}

/**
 * Poll localhost until the given port responds, or throw after timeout.
 */
function waitForPort(port: number, urlPath = '/', timeoutMs = 60_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      if (Date.now() > deadline) {
        return reject(new Error(`Timeout: port ${port} not ready after ${timeoutMs}ms`));
      }
      const req = http.get(
        { hostname: '127.0.0.1', port, path: urlPath, timeout: 1000 },
        () => { req.destroy(); resolve(); },
      );
      req.on('error', () => setTimeout(attempt, 500));
      req.on('timeout', () => { req.destroy(); setTimeout(attempt, 500); });
    };
    attempt();
  });
}

let backendProc: UtilityProcess | null = null;
let frontendProc: UtilityProcess | null = null;

function startBackend(): UtilityProcess {
  // In production: resources/backend.cjs (single esbuild bundle)
  const entry = res('backend.cjs');

  // Workspace lives in the user's app-data so it survives app updates
  const workDir = path.join(app.getPath('userData'), 'workspace');
  fs.mkdirSync(workDir, { recursive: true });

  const proc = utilityProcess.fork(entry, [], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      BACKEND_PORT: String(BACKEND_PORT),
      CORS_ORIGIN: `http://localhost:${FRONTEND_PORT}`,
      WORK_DIR: workDir,
      // Ollama runs on your external server — users need internet access
      OLLAMA_BASE_URL: 'http://103.186.18.11:11434',
      OLLAMA_MODEL: 'koda',
      AUTH_TOKEN: 'dev-secret-change-me',
    },
    stdio: 'pipe',
  });

  proc.stdout?.on('data', (d: Buffer) => process.stdout.write(`[backend] ${d}`));
  proc.stderr?.on('data', (d: Buffer) => process.stderr.write(`[backend] ${d}`));
  proc.on('exit', (code: number | null) => console.log(`[backend] exited: ${code}`));
  return proc;
}

function startFrontend(): UtilityProcess {
  // Next.js standalone in a pnpm monorepo places server.js at:
  //   standalone/apps/frontend/server.js
  // Static files must already be at standalone/.next/static/ and standalone/public/
  // (electron-builder copies them via extraResources)
  const entry = res('frontend', 'apps', 'frontend', 'server.js');

  const proc = utilityProcess.fork(entry, [], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(FRONTEND_PORT),
      HOSTNAME: '127.0.0.1',
      BACKEND_URL: `http://127.0.0.1:${BACKEND_PORT}`,
      BACKEND_AUTH_TOKEN: 'dev-secret-change-me',
    },
    stdio: 'pipe',
  });

  proc.stdout?.on('data', (d: Buffer) => process.stdout.write(`[frontend] ${d}`));
  proc.stderr?.on('data', (d: Buffer) => process.stderr.write(`[frontend] ${d}`));
  proc.on('exit', (code: number | null) => console.log(`[frontend] exited: ${code}`));
  return proc;
}

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'Koda',
    show: false,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (!isDev) {
    // Production: spawn backend + Next.js standalone, then wait for both
    backendProc = startBackend();
    frontendProc = startFrontend();

    try {
      await Promise.all([
        waitForPort(BACKEND_PORT, '/v1/health'),
        waitForPort(FRONTEND_PORT, '/'),
      ]);
    } catch (err) {
      console.error('Servers failed to start:', err);
      app.quit();
      return;
    }
  }
  // Dev: assume `pnpm dev` is already running on ports 4000 & 4001

  win.loadURL(`http://localhost:${FRONTEND_PORT}`);

  // Open external URLs in the system browser instead of a new Electron window
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith('http://localhost')) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.once('ready-to-show', () => win.show());
}

app.whenReady().then(createWindow);

// Kill child processes before quitting to avoid orphaned servers
app.on('before-quit', () => {
  backendProc?.kill();
  frontendProc?.kill();
});

app.on('window-all-closed', () => {
  app.quit();
});
