import { Neo4jQueryArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { runShell } from '../sandbox/exec.js';

function shellEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export const neo4jQueryTool: Tool<typeof Neo4jQueryArgs._type> = {
  name: 'neo4j_query',
  description:
    'Run a Cypher query against Neo4j via cypher-shell.',
  requiresApproval: false,
  schema: Neo4jQueryArgs,

  async run(args, ctx) {
    const connStr = shellEscape(args.connectionString ?? 'bolt://localhost:7687');
    const query = shellEscape(args.query);
    const dbFlag = args.database ? `-d ${shellEscape(args.database)}` : '';

    const cmd = `cypher-shell -a "${connStr}" ${dbFlag} "${query}"`.trim();

    const result = await runShell(cmd, { cwd: ctx.workDir, signal: ctx.signal });

    const parts: string[] = [];
    parts.push(`exit: ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}`);
    if (result.stdout) parts.push(result.stdout);
    if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
    return parts.join('\n');
  },
};
