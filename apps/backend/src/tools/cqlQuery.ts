import { CqlQueryArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runShell } from '../sandbox/exec.js';

function shellEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export const cqlQueryTool: Tool<typeof CqlQueryArgs._type> = {
  name: 'cql_query',
  description:
    'Run a read-only Cassandra CQL SELECT via cqlsh.',
  requiresApproval: false,
  schema: CqlQueryArgs,

  async run(args, ctx) {
    const trimmed = args.query.trim().toUpperCase();
    if (!trimmed.startsWith('SELECT')) {
      return 'error: cql_query only allows SELECT statements. Use cql_execute for write operations.';
    }

    const connStr = args.connectionString ?? 'localhost';
    // Parse connectionString — format: "host" or "host:port"
    const hostPort = connStr.split(':');
    const host = hostPort[0]!;
    const port = hostPort[1] ?? '9042';

    const query = shellEscape(args.query);
    const keyspaceFlag = args.keyspace ? `-k ${shellEscape(args.keyspace)}` : '';

    const cmd = `cqlsh ${shellEscape(host)} ${shellEscape(port)} -e "${query}" ${keyspaceFlag}`.trim();

    const result = await runShell(cmd, { cwd: ctx.workDir, signal: ctx.signal });

    const parts: string[] = [];
    parts.push(`exit: ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}`);
    if (result.stdout) parts.push(result.stdout);
    if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
    return parts.join('\n');
  },
};
