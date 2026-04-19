import type { Tool } from './registry.js';
import { NlToSqlArgs } from '@koda/shared';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { ollamaHeaders } from '../agent/ollama.js';

const SQLCODER_MODEL = 'sqlcoder';

export const nlToSqlTool: Tool<NlToSqlArgs> = {
  name: 'nl_to_sql',
  description: 'Convert a natural language question to SQL using SQLCoder.',
  requiresApproval: false,
  schema: NlToSqlArgs,

  async run(args) {
    const { question, schema, dialect = 'postgresql' } = args;

    logger.debug({ question, dialect }, 'nl_to_sql');

    const prompt =
      `### Task\nGenerate a ${dialect.toUpperCase()} query to answer the following question:\n` +
      `"${question}"\n\n` +
      `### Database Schema\n${schema}\n\n` +
      `### Answer\nGiven the database schema, here is the SQL query that answers the question:\n` +
      `\`\`\`sql\n`;

    let res: Response;
    try {
      res = await fetch(`${config.OLLAMA_BASE_URL}/api/generate`, {
        method: 'POST',
        headers: ollamaHeaders(),
        body: JSON.stringify({
          model: SQLCODER_MODEL,
          prompt,
          stream: false,
          options: { num_predict: 512, temperature: 0, stop: ['```', ';'] },
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      return `Error: could not reach Ollama — ${err instanceof Error ? err.message : String(err)}`;
    }

    if (!res.ok) {
      if (res.status === 404) {
        return `Error: SQLCoder model not found. Run \`make pull-sqlcoder\` to download it.`;
      }
      return `Error: Ollama returned HTTP ${res.status}`;
    }

    const data = (await res.json()) as { response?: string };
    const sql = (data.response ?? '').replace(/```[\s\S]*$/, '').trim();

    if (!sql) return 'Error: SQLCoder returned an empty response.';

    return `\`\`\`sql\n${sql};\n\`\`\``;
  },
};
