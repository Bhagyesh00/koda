import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { logger } from '../../logger.js';

/**
 * Extracts the starting URL from a frame by running OCR over the top strip
 * (where the browser address bar sits) and regex-matching http(s) URLs.
 *
 * Returns null if no URL-looking string is found — callers should fall back
 * to requiring an explicit url argument.
 */
export async function extractUrlFromFrame(framePath: string): Promise<string | null> {
  // Crop top ~10% of image to isolate the address bar area
  const stripPath = path.join(path.dirname(framePath), `.ocr-strip-${path.basename(framePath)}`);
  try {
    await cropTopStrip(framePath, stripPath);
  } catch (err) {
    logger.warn({ err }, 'failed to crop frame for OCR — using full frame');
    await fs.copyFile(framePath, stripPath);
  }

  try {
    // Dynamic import — tesseract.js has heavy initialization
    const mod = await import('tesseract.js');
    const tesseract = (mod as unknown as { default: typeof import('tesseract.js') }).default ?? mod;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (tesseract as any).recognize(stripPath, 'eng', { logger: () => {} });
    const text = String(data?.text ?? '');
    const match = text.match(/https?:\/\/[^\s"'<>]+/i);
    if (match) {
      // Strip trailing punctuation that OCR sometimes glues on
      const url = match[0].replace(/[.,;:)\]}]+$/, '');
      logger.info({ url, raw: match[0] }, 'OCR detected URL');
      return url;
    }
    logger.info({ text: text.slice(0, 200) }, 'OCR did not find a URL in frame');
    return null;
  } catch (err) {
    logger.warn({ err }, 'OCR failed');
    return null;
  } finally {
    await fs.unlink(stripPath).catch(() => {});
  }
}

function cropTopStrip(inputPath: string, outputPath: string): Promise<void> {
  const binary = ffmpegInstaller.path as string;
  return new Promise((resolve, reject) => {
    // iw:ih*0.12:0:0 = full width × 12% height, from top-left
    const args = ['-y', '-i', inputPath, '-vf', 'crop=iw:ih*0.12:0:0', outputPath];
    const proc = spawn(binary, args, { stdio: 'ignore' });
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg crop exited ${code}`))));
  });
}
