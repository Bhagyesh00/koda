import { K8sArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runShell } from '../sandbox/exec.js';

function shellEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export const k8sTool: Tool<typeof K8sArgs._type> = {
  name: 'k8s',
  description: 'Run kubectl commands (get, describe, logs, top, config, apply, delete). Apply/delete require approval.',
  requiresApproval: false, // approval handled by TOOL_DESCRIPTORS level
  schema: K8sArgs,

  async run(args, ctx) {
    const { subcommand, args: cmdArgs, namespace, context } = args;
    const escapedArgs = cmdArgs ? shellEscape(cmdArgs) : '';

    const parts: string[] = [`kubectl ${subcommand}`];
    if (escapedArgs) parts.push(escapedArgs);
    if (namespace) parts.push(`-n ${shellEscape(namespace)}`);
    if (context) parts.push(`--context ${shellEscape(context)}`);

    const cmd = parts.join(' ');
    const result = await runShell(cmd, { cwd: ctx.workDir, signal: ctx.signal });

    const output: string[] = [];
    output.push(`exit: ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}`);
    if (result.stdout) output.push(result.stdout);
    if (result.stderr) output.push(`stderr:\n${result.stderr}`);

    return output.join('\n');
  },
};
