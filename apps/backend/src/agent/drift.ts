/**
 * Lightweight drift detection: computes token-level Jaccard similarity
 * between the user's pinned intent and a proposed action's description.
 *
 * This avoids needing an embedding model. A hit below `DRIFT_THRESHOLD`
 * signals that the agent may be drifting from the stated goal.
 */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
  'to', 'of', 'in', 'on', 'for', 'with', 'at', 'by', 'from', 'up',
  'about', 'into', 'through', 'during', 'before', 'after', 'above',
  'below', 'between', 'under', 'again', 'further', 'then', 'once',
  'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it',
  'we', 'they', 'what', 'which', 'who', 'whom', 'whose', 'be', 'have',
  'do', 'does', 'did', 'can', 'could', 'should', 'would', 'will',
  'my', 'your', 'his', 'her', 'its', 'our', 'their', 'me', 'him',
  'us', 'them', 'am', 'been', 'being', 'had', 'having', 'as', 'if',
  'so', 'some', 'any', 'all', 'no', 'not', 'only', 'own', 'same',
  'than', 'too', 'very', 'just', 'also',
]);

function tokenize(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  return new Set(words);
}

export function jaccardSimilarity(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export const DRIFT_THRESHOLD = 0.08;

export function summarizeAction(toolName: string, args: unknown): string {
  const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
  const parts: string[] = [toolName];
  if (typeof a.path === 'string') parts.push(a.path);
  if (typeof a.pattern === 'string') parts.push(a.pattern);
  if (typeof a.command === 'string') parts.push(a.command);
  if (typeof a.content === 'string') parts.push(a.content.slice(0, 200));
  if (typeof a.description === 'string') parts.push(a.description);
  return parts.join(' ');
}
