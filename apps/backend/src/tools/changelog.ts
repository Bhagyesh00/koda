import { ChangelogArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runShell } from '../sandbox/exec.js';

function shellEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

interface CommitEntry {
  hash: string;
  subject: string;
  author: string;
  date: string;
}

function parseCommitLine(line: string): CommitEntry | null {
  // Format: "hash subject (author, date)"
  const match = line.match(/^(\w+)\s+(.+?)\s+\((.+?),\s*(.+?)\)$/);
  if (!match) return null;
  return { hash: match[1]!, subject: match[2]!, author: match[3]!, date: match[4]! };
}

function categorise(subject: string): string {
  const lower = subject.toLowerCase();
  if (lower.startsWith('feat')) return 'Features';
  if (lower.startsWith('fix')) return 'Bug Fixes';
  if (lower.startsWith('docs')) return 'Documentation';
  if (lower.startsWith('style')) return 'Styles';
  if (lower.startsWith('refactor')) return 'Refactoring';
  if (lower.startsWith('perf')) return 'Performance';
  if (lower.startsWith('test')) return 'Tests';
  if (lower.startsWith('build') || lower.startsWith('ci')) return 'Build & CI';
  if (lower.startsWith('chore')) return 'Chores';
  return 'Other';
}

function formatMarkdown(commits: CommitEntry[]): string {
  const groups = new Map<string, CommitEntry[]>();
  for (const c of commits) {
    const cat = categorise(c.subject);
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(c);
  }

  const sections: string[] = [];
  for (const [category, entries] of groups) {
    sections.push(`### ${category}\n`);
    for (const e of entries) {
      sections.push(`- ${e.subject} (\`${e.hash}\` — ${e.author}, ${e.date})`);
    }
    sections.push('');
  }
  return sections.join('\n');
}

function formatJson(commits: CommitEntry[]): string {
  return JSON.stringify(commits, null, 2);
}

export const changelogTool: Tool<typeof ChangelogArgs._type> = {
  name: 'changelog',
  description:
    'Generate a changelog from git commit history between two refs.',
  requiresApproval: false,
  schema: ChangelogArgs,

  async run(args, ctx) {
    const check = await runShell('git rev-parse --is-inside-work-tree', {
      cwd: ctx.workDir,
      timeoutMs: 5_000,
    });
    if (check.exitCode !== 0) {
      return 'Not a git repository (or no git installed).';
    }

    const to = shellEscape(args.to ?? 'HEAD');
    let from = args.from ? shellEscape(args.from) : '';

    // If from is not specified, try to find the latest tag
    if (!from) {
      const tagResult = await runShell(
        'git describe --tags --abbrev=0 HEAD~1',
        { cwd: ctx.workDir, timeoutMs: 5_000 },
      );
      if (tagResult.exitCode === 0 && tagResult.stdout.trim()) {
        from = tagResult.stdout.trim();
      }
    }

    const range = from ? `${from}..${to}` : to;
    const cmd = `git log ${range} --pretty=format:"%h %s (%an, %ad)" --date=short`;

    const result = await runShell(cmd, { cwd: ctx.workDir, signal: ctx.signal });

    if (result.exitCode !== 0) {
      const parts: string[] = [];
      parts.push(`exit: ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}`);
      if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
      return parts.join('\n');
    }

    const lines = result.stdout.trim().split('\n').filter(Boolean);
    const commits = lines.map(parseCommitLine).filter((c): c is CommitEntry => c !== null);

    if (commits.length === 0) {
      return `No commits found in range ${range}.`;
    }

    const format = args.format ?? 'markdown';
    if (format === 'json') {
      return formatJson(commits);
    }

    return `# Changelog (${range})\n\n${formatMarkdown(commits)}`;
  },
};
