import fs from 'node:fs/promises';
import { ImageReadArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { resolveInside } from '../sandbox/fs.js';

function detectFormat(buf: Buffer): string {
  // PNG: 8-byte magic \x89 P N G \r \n \x1a \n
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'PNG';
  }
  // JPEG: starts with \xFF \xD8
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    return 'JPEG';
  }
  // GIF: starts with "GIF8"
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
    return 'GIF';
  }
  // WEBP: bytes 8-11 are "WEBP" (within the RIFF container)
  if (
    buf.length >= 12 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return 'WEBP';
  }
  // BMP: starts with "BM"
  if (buf[0] === 0x42 && buf[1] === 0x4d) {
    return 'BMP';
  }
  return 'unknown';
}

export const imageReadTool: Tool<typeof ImageReadArgs._type> = {
  name: 'image_read',
  description: 'Read an image file and return metadata including format and size.',
  requiresApproval: false,
  schema: ImageReadArgs,
  async run(args, ctx) {
    let abs: string;
    try {
      abs = resolveInside(ctx.workDir, args.path);
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }

    let format: string;
    let sizeKB: number;
    try {
      // Only the first 16 bytes are needed for magic-byte detection — avoid
      // loading the entire file into memory for large images.
      const stat = await fs.stat(abs);
      sizeKB = Math.round(stat.size / 1024);
      const fh = await fs.open(abs, 'r');
      try {
        const header = Buffer.alloc(16);
        await fh.read(header, 0, 16, 0);
        format = detectFormat(header);
      } finally {
        await fh.close();
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return `Error: File not found: ${args.path}`;
      if (code === 'EACCES') return `Error: Permission denied reading: ${args.path}`;
      return `Error reading ${args.path}: ${err instanceof Error ? err.message : String(err)}`;
    }

    return `Image: ${args.path}\nFormat: ${format}\nSize: ${sizeKB}KB`;
  },
};
