import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { logger } from '../../logger.js';

/**
 * Extracts `samples` evenly-spaced frames from the video to `outDir` as PNG files.
 * Returns sorted absolute paths to the extracted frames.
 */
export async function extractFrames(
  videoPath: string,
  outDir: string,
  samples: number,
): Promise<string[]> {
  await fs.mkdir(outDir, { recursive: true });
  const binary = ffmpegInstaller.path as string;

  // Probe duration via ffmpeg -i (writes to stderr). Parse "Duration: HH:MM:SS.xx"
  const duration = await probeDuration(binary, videoPath);
  if (duration <= 0) throw new Error(`Could not determine duration of video: ${videoPath}`);

  // Extract `samples` frames evenly spaced across the duration.
  // Use the -ss seek per-frame approach for precision over long videos.
  const interval = duration / (samples + 1);
  const promises: Promise<string>[] = [];
  for (let i = 1; i <= samples; i++) {
    const t = (i * interval).toFixed(3);
    const outPath = path.join(outDir, `frame-${String(i).padStart(3, '0')}.png`);
    promises.push(extractSingleFrame(binary, videoPath, t, outPath));
  }

  const paths = await Promise.all(promises);
  logger.info({ video: videoPath, frames: paths.length, duration }, 'frames extracted');
  return paths;
}

function probeDuration(binary: string, videoPath: string): Promise<number> {
  return new Promise((resolve) => {
    let stderr = '';
    const proc = spawn(binary, ['-i', videoPath], { stdio: ['ignore', 'ignore', 'pipe'] });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('close', () => {
      const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
      if (!m) {
        resolve(0);
        return;
      }
      const h = parseInt(m[1]!, 10);
      const min = parseInt(m[2]!, 10);
      const s = parseFloat(m[3]!);
      resolve(h * 3600 + min * 60 + s);
    });
    proc.on('error', () => resolve(0));
  });
}

function extractSingleFrame(
  binary: string,
  videoPath: string,
  timestampSec: string,
  outPath: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['-y', '-ss', timestampSec, '-i', videoPath, '-frames:v', '1', outPath];
    const proc = spawn(binary, args, { stdio: 'ignore' });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(outPath);
      else reject(new Error(`ffmpeg exited with code ${code} extracting frame at ${timestampSec}`));
    });
  });
}

/**
 * Lists PNG/JPG files in a pre-existing frames directory, sorted by name.
 */
export async function listFrames(framesDir: string): Promise<string[]> {
  const entries = await fs.readdir(framesDir);
  return entries
    .filter((e) => /\.(png|jpe?g)$/i.test(e))
    .sort()
    .map((e) => path.join(framesDir, e));
}
