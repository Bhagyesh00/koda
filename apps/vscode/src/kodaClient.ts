import * as http from 'node:http';
import * as https from 'node:https';
import * as vscode from 'vscode';

export interface KodaConfig {
  backendUrl: string;
  apiKey: string;
}

export function getConfig(): KodaConfig {
  const cfg = vscode.workspace.getConfiguration('koda');
  return {
    backendUrl: cfg.get<string>('backendUrl') ?? 'http://localhost:4001',
    apiKey: cfg.get<string>('apiKey') ?? 'dev-secret-change-me',
  };
}

function parseUrl(raw: string): URL {
  return new URL(raw);
}

function requestLib(url: URL): typeof http | typeof https {
  return url.protocol === 'https:' ? https : http;
}

async function jsonPost<T>(path: string, body: unknown): Promise<T> {
  const { backendUrl, apiKey } = getConfig();
  const url = parseUrl(`${backendUrl}${path}`);
  const payload = JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const req = requestLib(url).request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          authorization: `Bearer ${apiKey}`,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(data) as T);
          } catch {
            reject(new Error(`Invalid JSON response: ${data.slice(0, 200)}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

export async function createSession(cwd: string): Promise<string> {
  const res = await jsonPost<{ id: string }>('/v1/sessions', { cwd });
  return res.id;
}

export interface ChatStreamHandlers {
  onText(t: string): void;
  onDone(): void;
  onError(e: Error): void;
}

export function startChatStream(
  sessionId: string,
  message: string,
  handlers: ChatStreamHandlers,
): () => void {
  const { backendUrl, apiKey } = getConfig();
  const url = parseUrl(`${backendUrl}/v1/chat`);
  const payload = JSON.stringify({ sessionId, message, autoApproveAll: true });

  const req = requestLib(url).request(
    {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        authorization: `Bearer ${apiKey}`,
        accept: 'text/event-stream',
      },
    },
    (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        handlers.onError(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      let buf = '';
      res.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data:')) continue;
          const json = line.slice(5).trim();
          if (!json) continue;
          try {
            const event = JSON.parse(json) as { type: string; text?: string };
            if (event.type === 'token' && event.text) {
              handlers.onText(event.text);
            } else if (event.type === 'done') {
              handlers.onDone();
            }
          } catch {
            // skip malformed event
          }
        }
      });
      res.on('end', () => handlers.onDone());
      res.on('error', (e) => handlers.onError(e));
    },
  );

  req.on('error', (e) => handlers.onError(e));
  req.write(payload);
  req.end();

  return () => req.destroy();
}
