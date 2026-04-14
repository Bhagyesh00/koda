import { EnvGetArgs } from '@koda/shared';
import type { Tool } from './registry.js';

const SENSITIVE_PATTERNS = ['PASSWORD', 'SECRET', 'TOKEN', 'KEY', 'PRIVATE'];

function isSensitive(key: string): boolean {
  const upper = key.toUpperCase();
  return SENSITIVE_PATTERNS.some((pattern) => upper.includes(pattern));
}

export const envGetTool: Tool<typeof EnvGetArgs._type> = {
  name: 'env_get',
  description: 'Read a single environment variable by name. Returns the value or empty if unset.',
  requiresApproval: false,
  schema: EnvGetArgs,
  async run(args, _ctx) {
    if (isSensitive(args.key)) {
      return `${args.key} is restricted`;
    }

    const value = process.env[args.key];
    if (value === undefined) {
      return `${args.key} is not set`;
    }

    return `${args.key}=${value}`;
  },
};
