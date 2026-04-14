import { PortCheckArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import net from 'node:net';

export const portCheckTool: Tool<typeof PortCheckArgs._type> = {
  name: 'port_check',
  description: 'Check if a TCP port is open and reachable on a given host.',
  requiresApproval: false,
  schema: PortCheckArgs,

  async run(args, ctx) {
    const { host, port, timeoutMs = 3_000 } = args;

    const start = Date.now();

    const result = await new Promise<{ open: boolean; error?: string }>((resolve) => {
      const socket = net.createConnection({ host, port, timeout: timeoutMs });

      const timer = setTimeout(() => {
        socket.destroy();
        resolve({ open: false, error: 'connection timed out' });
      }, timeoutMs);

      socket.on('connect', () => {
        clearTimeout(timer);
        socket.destroy();
        resolve({ open: true });
      });

      socket.on('timeout', () => {
        clearTimeout(timer);
        socket.destroy();
        resolve({ open: false, error: 'connection timed out' });
      });

      socket.on('error', (err) => {
        clearTimeout(timer);
        socket.destroy();
        resolve({ open: false, error: err.message });
      });
    });

    const latency = Date.now() - start;

    if (result.open) {
      return `\u2713 ${host}:${port} is open (${latency}ms)`;
    }

    return `\u2717 ${host}:${port} is not reachable${result.error ? ` (${result.error})` : ''}`;
  },
};
