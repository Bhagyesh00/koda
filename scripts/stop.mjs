// Stop everything started by `make start` (Windows only).
// Strategy: read pidfiles written by start.mjs, kill those PIDs (and tree).
// Also kill anything still listening on the backend/frontend ports as a fallback.
import { spawnSync } from 'node:child_process';
import { platform } from 'node:os';
import { readFileSync, existsSync, rmSync } from 'node:fs';

if (platform() !== 'win32') {
  console.log('make stop is Windows-only.');
  process.exit(0);
}

const PID_DIR = '.koda/pids';
const PIDS = ['backend', 'frontend', 'ollama', 'dev'];
const PORTS_TO_KILL = [4001, 4000]; // backend, frontend (NOT ollama 11434)

function killPid(pid) {
  const r = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  return r.status === 0;
}

function getPidsOnPort(port) {
  const r = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique`,
    ],
    { encoding: 'utf8' },
  );
  if (r.status !== 0 || !r.stdout) return [];
  return r.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s));
}

// 1. Kill by pidfile (closes the PowerShell windows + their child processes)
for (const name of PIDS) {
  const pidFile = `${PID_DIR}/${name}.pid`;
  if (!existsSync(pidFile)) {
    console.log(`${name.padEnd(8)} : no pidfile`);
    continue;
  }
  const pid = readFileSync(pidFile, 'utf8').trim();
  if (!/^\d+$/.test(pid)) {
    console.log(`${name.padEnd(8)} : invalid pidfile`);
    continue;
  }
  const ok = killPid(pid);
  console.log(`${name.padEnd(8)} : ${ok ? `killed pid ${pid}` : `pid ${pid} already gone`}`);
  rmSync(pidFile, { force: true });
}

// 2. Fallback: kill anything still listening on backend/frontend ports
for (const port of PORTS_TO_KILL) {
  const pids = getPidsOnPort(port);
  for (const pid of pids) {
    killPid(pid);
    console.log(`port ${port} : killed leftover pid ${pid}`);
  }
}

console.log('\nDone. Ollama (port 11434) was left alone if it was already running before.');
