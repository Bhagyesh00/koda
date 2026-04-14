/**
 * Export real Koda sessions as JSONL training data.
 * Run with: pnpm tsx scripts/export-training-data.ts
 *
 * Output: training/koda-sessions.jsonl
 * Each line is one conversation window (system + context messages + assistant tool call + result).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Dynamically import backend modules (they use ESM)
const { sessionStore } = await import(
  path.join(ROOT, 'apps/backend/src/sessions/store.js')
) as typeof import('../apps/backend/src/sessions/store.js');

const { buildSystemPrompt } = await import(
  path.join(ROOT, 'apps/backend/src/agent/prompts.js')
) as typeof import('../apps/backend/src/agent/prompts.js');

interface Message {
  role: string;
  content: string;
}

interface TrainingExample {
  messages: Message[];
}

function sessionToExamples(session: ReturnType<typeof sessionStore.get>): TrainingExample[] {
  if (!session || session.messages.length < 4) return [];

  const examples: TrainingExample[] = [];
  const systemContent = buildSystemPrompt(session.cwd ?? '.');
  const systemMsg: Message = { role: 'system', content: systemContent };
  const msgs = session.messages;

  // Sliding window: capture context around each assistant tool-call message
  for (let i = 2; i < msgs.length; i++) {
    const m = msgs[i];
    if (!m || m.role !== 'assistant') continue;
    // Only include turns where the assistant actually called a tool
    if (!m.content.includes('tool_call') && !m.content.includes('"name"')) continue;

    // Include up to 6 prior messages as context, plus this assistant message
    // and the next tool result (if any)
    const windowStart = Math.max(0, i - 6);
    const windowEnd = Math.min(msgs.length - 1, i + 1);
    const window = msgs.slice(windowStart, windowEnd + 1);

    // Skip windows that are too short to be meaningful
    if (window.length < 2) continue;

    examples.push({
      messages: [
        systemMsg,
        ...window.map((w) => ({ role: w.role, content: w.content })),
      ],
    });
  }

  return examples;
}

// Collect all sessions
const allSessions = sessionStore.list?.() ?? [];
if (allSessions.length === 0) {
  // Fallback: try to list from store directly
  console.warn('sessionStore.list() not available — add a list() method to the session store.');
  process.exit(1);
}

const examples = allSessions.flatMap((s) => sessionToExamples(s));

// Filter out very short or very long examples
const filtered = examples.filter((e) => {
  const totalLen = e.messages.reduce((acc, m) => acc + m.content.length, 0);
  return totalLen > 200 && totalLen < 32_000;
});

// Write output
const outDir = path.join(ROOT, 'training');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'koda-sessions.jsonl');
fs.writeFileSync(outPath, filtered.map((e) => JSON.stringify(e)).join('\n'), 'utf8');

console.log(`Exported ${filtered.length} training examples (from ${examples.length} total)`);
console.log(`Output: ${outPath}`);
console.log('');
console.log('Next steps:');
console.log('  1. Review and curate training/koda-sessions.jsonl');
console.log('  2. Run: python scripts/finetune.py');
