import { RedisCommandArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runShell } from '../sandbox/exec.js';

function shellEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export const redisCommandTool: Tool<typeof RedisCommandArgs._type> = {
  name: 'redis_command',
  description:
    'Run a Redis command via redis-cli (GET, SET, HGETALL, etc). Write commands require approval.',
  requiresApproval: false,
  schema: RedisCommandArgs,

  async run(args, ctx) {
    const connStr = shellEscape(args.connectionString ?? 'redis://localhost:6379');
    const command = shellEscape(args.command);
    const cmd = `redis-cli -u "${connStr}" ${command}`;

    const result = await runShell(cmd, { cwd: ctx.workDir, signal: ctx.signal });

    const parts: string[] = [];
    parts.push(`exit: ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}`);
    if (result.stdout) parts.push(result.stdout);
    if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
    return parts.join('\n');
  },
};
