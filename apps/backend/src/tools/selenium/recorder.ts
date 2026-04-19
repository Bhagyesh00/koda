import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { WebDriver } from 'selenium-webdriver';
import { logger } from '../../logger.js';

export type VideoFormat = 'mp4' | 'frames';

export interface VideoOptions {
  enabled: boolean;
  fps: number;
  format: VideoFormat;
}

export interface VideoResult {
  videoPath?: string;
  framesDir: string;
  frameCount: number;
  format: 'mp4' | 'frames-html';
  playerHtmlPath?: string;
  message: string;
}

function hasFfmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0));
  });
}

async function encodeWithFfmpeg(framesDir: string, outPath: string, fps: number): Promise<boolean> {
  return new Promise((resolve) => {
    const args = [
      '-y',
      '-framerate', String(fps),
      '-i', path.join(framesDir, 'f%05d.png'),
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
      '-movflags', '+faststart',
      outPath,
    ];
    const proc = spawn('ffmpeg', args, { stdio: 'pipe' });
    let stderr = '';
    proc.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => {
      if (code !== 0) logger.warn({ code, stderr: stderr.slice(-500) }, 'ffmpeg encode failed');
      resolve(code === 0);
    });
  });
}

async function writeFramePlayerHtml(framesDir: string, frameCount: number, fps: number): Promise<string> {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"/><title>Test Recording</title>
<style>
  body { margin:0; background:#000; color:#fff; font-family:system-ui,sans-serif; display:flex; flex-direction:column; align-items:center; }
  .player { max-width:100%; max-height:90vh; display:block; }
  .controls { padding:12px; display:flex; gap:12px; align-items:center; }
  button { padding:6px 12px; font-size:14px; cursor:pointer; }
  input[type=range] { width:300px; }
  .info { font-size:12px; color:#9ca3af; }
</style></head>
<body>
<img id="frame" class="player"/>
<div class="controls">
  <button id="play">Pause</button>
  <button id="restart">Restart</button>
  <input id="scrubber" type="range" min="0" max="${frameCount - 1}" value="0"/>
  <span id="counter" class="info">0 / ${frameCount}</span>
  <span class="info">${fps} fps</span>
</div>
<script>
const total = ${frameCount};
const fps = ${fps};
const img = document.getElementById('frame');
const play = document.getElementById('play');
const restart = document.getElementById('restart');
const scrubber = document.getElementById('scrubber');
const counter = document.getElementById('counter');
let i = 0, playing = true;
function draw(n) {
  i = n;
  img.src = 'f' + String(n + 1).padStart(5, '0') + '.png';
  scrubber.value = n;
  counter.textContent = (n + 1) + ' / ' + total;
}
draw(0);
setInterval(() => { if (!playing) return; if (i >= total - 1) { playing = false; play.textContent = 'Play'; return; } draw(i + 1); }, 1000 / fps);
play.onclick = () => { playing = !playing; play.textContent = playing ? 'Pause' : 'Play'; };
restart.onclick = () => { draw(0); playing = true; play.textContent = 'Pause'; };
scrubber.oninput = (e) => { playing = false; play.textContent = 'Play'; draw(parseInt(e.target.value, 10)); };
</script>
</body></html>`;
  const p = path.join(framesDir, 'player.html');
  await fs.writeFile(p, html, 'utf8');
  return p;
}

export class VideoRecorder {
  private readonly driver: WebDriver;
  private readonly outDir: string;
  private readonly opts: VideoOptions;
  private readonly framesDir: string;
  private frameCount = 0;
  private stopping = false;
  private loopPromise: Promise<void> | null = null;

  constructor(driver: WebDriver, outDir: string, opts: VideoOptions) {
    this.driver = driver;
    this.outDir = outDir;
    this.opts = opts;
    this.framesDir = path.join(outDir, '_frames');
  }

  async start(): Promise<void> {
    if (!this.opts.enabled) return;
    await fs.mkdir(this.framesDir, { recursive: true });
    const periodMs = Math.max(50, Math.round(1000 / this.opts.fps));
    this.loopPromise = this.captureLoop(periodMs);
  }

  private async captureLoop(periodMs: number): Promise<void> {
    while (!this.stopping) {
      const started = Date.now();
      try {
        const png = await this.driver.takeScreenshot();
        const idx = String(++this.frameCount).padStart(5, '0');
        await fs.writeFile(path.join(this.framesDir, `f${idx}.png`), Buffer.from(png, 'base64'));
      } catch {
        // Driver may be mid-navigation — skip frame
      }
      const elapsed = Date.now() - started;
      const wait = Math.max(10, periodMs - elapsed);
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  async stop(): Promise<VideoResult | null> {
    if (!this.opts.enabled) return null;
    this.stopping = true;
    if (this.loopPromise) await this.loopPromise.catch(() => {});

    if (this.frameCount === 0) {
      return {
        framesDir: this.framesDir,
        frameCount: 0,
        format: 'frames-html',
        message: 'No frames captured',
      };
    }

    // Try ffmpeg if mp4 requested
    if (this.opts.format === 'mp4' && (await hasFfmpeg())) {
      const videoPath = path.join(this.outDir, 'recording.mp4');
      const ok = await encodeWithFfmpeg(this.framesDir, videoPath, this.opts.fps);
      if (ok) {
        // Remove raw frames to save space
        await fs.rm(this.framesDir, { recursive: true, force: true }).catch(() => {});
        return {
          videoPath,
          framesDir: this.framesDir,
          frameCount: this.frameCount,
          format: 'mp4',
          message: `Recorded ${this.frameCount} frames → ${path.basename(videoPath)}`,
        };
      }
      logger.warn('ffmpeg encode failed — falling back to frames + HTML player');
    } else if (this.opts.format === 'mp4') {
      logger.warn('ffmpeg not found on PATH — saving frames + HTML player instead. Install ffmpeg to get MP4 output.');
    }

    // Fallback: keep frames + write HTML player
    const playerHtmlPath = await writeFramePlayerHtml(this.framesDir, this.frameCount, this.opts.fps);
    return {
      framesDir: this.framesDir,
      frameCount: this.frameCount,
      format: 'frames-html',
      playerHtmlPath,
      message: `Recorded ${this.frameCount} frames → open player.html`,
    };
  }
}

export function resolveVideoOptions(input: boolean | VideoOptions | undefined): VideoOptions {
  if (input === true) return { enabled: true, fps: 5, format: 'mp4' };
  if (input === false || input == null) return { enabled: false, fps: 5, format: 'mp4' };
  return {
    enabled: input.enabled ?? true,
    fps: input.fps ?? 5,
    format: input.format ?? 'mp4',
  };
}
