// Spawn Koda backend + frontend in two labelled PowerShell windows (Windows only).
// Each window writes its own PID to .koda/pids/<name>.pid so `stop` can find it.
import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import { mkdirSync, rmSync } from 'node:fs';

if (platform() !== 'win32') {
  console.log('make start is Windows-only.');
  console.log("On Linux/Mac, run 'make ollama-serve' and 'make dev' in two terminals.");
  process.exit(0);
}

const PID_DIR = '.koda/pids';
mkdirSync('logs', { recursive: true });
mkdirSync(PID_DIR, { recursive: true });

function spawnWindow(name, title, command) {
  const pidFile = `${PID_DIR}/${name}.pid`;
  const logFile = `logs/${name}.log`;
  rmSync(pidFile, { force: true });
  rmSync(logFile, { force: true });

  // PowerShell window:
  //  1. Sets its title
  //  2. Writes its own PID
  //  3. Runs the command through `cmd /c ... 2>&1` so stdout+stderr (including
  //     child processes like tsx / next) are funneled into a single stream,
  //     then Tee-Object mirrors that stream to logs/<name>.log while still
  //     displaying it in the window. Start-Transcript was unreliable here —
  //     it often captured only the BOM and missed all child-process output.
  // -NoExit keeps the window open after the command exits/fails so errors are visible.
  const psBody =
    `$Host.UI.RawUI.WindowTitle = '${title}'; ` +
    `$PID | Out-File -Encoding ascii '${pidFile}'; ` +
    `& cmd /c "${command} 2>&1" | Tee-Object -FilePath '${logFile}'`;
  const full = `start "${title}" powershell -NoExit -NoProfile -Command "${psBody}"`;

  spawn(full, { shell: true, detached: true, stdio: 'ignore' }).unref();
}

// 1. Ollama (skip if already running)
let ollamaUp = false;
try {
  ollamaUp = (await fetch('http://103.186.18.11:11434/api/tags')).ok;
} catch {
  /* not running */
}
if (ollamaUp) {
  console.log('ollama   : already running, skipping window');
} else {
  spawnWindow('ollama', 'koda-ollama', 'ollama serve');
  console.log('ollama   : launched in koda-ollama window');
  await new Promise((r) => setTimeout(r, 1500));
}

// 2. Backend and frontend each in their own window so crashes and logs are isolated.
spawnWindow('backend', 'koda-backend', 'pnpm --filter @koda/backend dev');
console.log('backend  : launched in koda-backend window (port 4001)');

spawnWindow('frontend', 'koda-frontend', 'pnpm --filter @koda/frontend dev');
console.log('frontend : launched in koda-frontend window (port 4000)');

console.log('');
console.log('Wait ~10 seconds, then:  make status');
console.log('Open:                    http://localhost:4000');
console.log('Stop everything:         make stop');
