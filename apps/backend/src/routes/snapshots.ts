import { Router } from 'express';
import type { Router as RouterType } from 'express';
import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs';
import { sessionStore } from '../sessions/store.js';
import { config } from '../config.js';
import { runCommand } from '../sandbox/exec.js';
import { NotFoundError } from '../errors.js';
import { nanoid } from 'nanoid';

export const snapshotsRouter: RouterType = Router();

/** Check if the given directory is a git repo. */
async function isGitRepo(dir: string): Promise<boolean> {
  const result = await runCommand('git rev-parse --git-dir', dir, { timeoutMs: 5_000 });
  return result.exitCode === 0;
}

/** List all stashes, return entries matching koda-snapshot prefix. */
async function listGitStashes(dir: string): Promise<Array<{ index: number; ref: string; message: string }>> {
  const result = await runCommand('git stash list --format="%gd|||%gs"', dir, { timeoutMs: 10_000 });
  if (result.exitCode !== 0) return [];
  return result.output
    .split('\n')
    .filter(Boolean)
    .flatMap((line, idx) => {
      const [ref, msg] = line.split('|||');
      if (!ref || !msg) return [];
      return [{ index: idx, ref: ref.trim(), message: msg.trim() }];
    });
}

snapshotsRouter.get('/sessions/:id/snapshots', (req, res) => {
  const session = sessionStore.get(req.params.id ?? '');
  if (!session) throw new NotFoundError('session');
  res.json({ snapshots: session.snapshots ?? [] });
});

snapshotsRouter.post('/sessions/:id/snapshots', async (req, res) => {
  const session = sessionStore.get(req.params.id ?? '');
  if (!session) throw new NotFoundError('session');

  const body = z.object({
    description: z.string().default('manual snapshot'),
  }).parse(req.body ?? {});

  const workDir = session.cwd ?? config.WORK_DIR_ABS;
  const ts = Date.now();
  const ref = `koda-${nanoid(6)}-${ts}`;

  const hasGit = await isGitRepo(workDir);
  if (hasGit) {
    // Sanitize the description so it cannot break out of the double-quoted
    // shell argument (runShell uses shell:true — injection is real otherwise).
    const safeDesc = body.description.replace(/["\\\r\n`$!]/g, ' ').slice(0, 120);
    const stashMsg = `koda-snapshot: ${safeDesc}`;
    const r = await runCommand(
      `git stash push --include-untracked -m "${stashMsg}"`,
      workDir,
      { timeoutMs: 30_000 },
    );
    if (r.exitCode !== 0) {
      res.status(500).json({ error: `git stash failed: ${r.output}` });
      return;
    }
    // The newest stash is stash@{0} — resolve its real ref
    const refR = await runCommand('git stash list --format="%H" -n 1', workDir, { timeoutMs: 5_000 });
    const gitRef = refR.output.trim() || 'stash@{0}';

    sessionStore.addSnapshot(req.params.id!, { ref: gitRef, description: body.description, ts });
    res.status(201).json({ ref: gitRef, description: body.description, ts });
  } else {
    // Non-git workspace: create a .koda/snapshots/{ref}/ directory with file copies
    const snapshotDir = path.join(workDir, '.koda', 'snapshots', ref);
    fs.mkdirSync(snapshotDir, { recursive: true });
    copyDir(workDir, snapshotDir, ['.koda', 'node_modules', '.git']);
    sessionStore.addSnapshot(req.params.id!, { ref, description: body.description, ts });
    res.status(201).json({ ref, description: body.description, ts });
  }
});

snapshotsRouter.post('/sessions/:id/snapshots/restore', async (req, res) => {
  const session = sessionStore.get(req.params.id ?? '');
  if (!session) throw new NotFoundError('session');

  const { ref } = z.object({ ref: z.string().min(1) }).parse(req.body ?? {});
  const workDir = session.cwd ?? config.WORK_DIR_ABS;

  const hasGit = await isGitRepo(workDir);
  if (hasGit) {
    // Find the stash index matching this ref
    const stashes = await listGitStashes(workDir);
    const match = stashes.find((s) => s.ref === ref || s.message.includes(ref));
    const stashRef = match ? match.ref : ref;

    const r = await runCommand(
      `git stash apply ${stashRef}`,
      workDir,
      { timeoutMs: 30_000 },
    );
    if (r.exitCode !== 0) {
      res.status(500).json({ error: `restore failed: ${r.output}` });
      return;
    }
    res.json({ ok: true });
  } else {
    // Non-git: copy files back from snapshot directory
    const snapshotDir = path.join(workDir, '.koda', 'snapshots', ref);
    if (!fs.existsSync(snapshotDir)) {
      res.status(404).json({ error: 'snapshot not found' });
      return;
    }
    copyDir(snapshotDir, workDir, []);
    res.json({ ok: true });
  }
});

/** Recursive directory copy, skipping specified names. */
function copyDir(src: string, dest: string, skip: string[]): void {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (skip.includes(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDir(srcPath, destPath, skip);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
