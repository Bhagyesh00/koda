import { DockerArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runShell } from '../sandbox/exec.js';

function shellEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export const dockerTool: Tool<typeof DockerArgs._type> = {
  name: 'docker',
  description: 'Run Docker commands (ps, logs, inspect, stats, images, compose).',
  requiresApproval: false,
  schema: DockerArgs,

  async run(args, ctx) {
    const { subcommand, args: cmdArgs } = args;
    const escapedArgs = cmdArgs ? shellEscape(cmdArgs) : '';

    let cmd: string;

    if (subcommand === 'compose') {
      cmd = `docker compose ${escapedArgs}`;
    } else if (subcommand === 'stats') {
      // Add --no-stream to prevent stats from running indefinitely
      cmd = `docker stats --no-stream ${escapedArgs}`;
    } else {
      cmd = `docker ${subcommand} ${escapedArgs}`;
    }

    const result = await runShell(cmd.trim(), { cwd: ctx.workDir, signal: ctx.signal });

    const parts: string[] = [];
    parts.push(`exit: ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}`);
    if (result.stdout) parts.push(result.stdout);
    if (result.stderr) parts.push(`stderr:\n${result.stderr}`);

    return parts.join('\n');
  },
};
