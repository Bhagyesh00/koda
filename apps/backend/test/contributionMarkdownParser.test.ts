import { describe, it, expect } from 'vitest';
import {
  parseContribution,
  parseContributionMarkdown,
} from '../src/tools/multiAgent.helpers.js';

// Phase 6 Fix 4 — small models often emit clean markdown but trip over JSON
// punctuation. The markdown fallback rescues their position so the synthesizer
// and aggregator don't drop whole rounds.

describe('parseContributionMarkdown', () => {
  it('parses the canonical 4-section template', () => {
    const md = `### Claim
The new auth middleware is unsafe to ship without rate-limiting.

### Evidence
- src/auth/index.ts:42 calls bcrypt with a fixed cost
- No tests cover the lockout path

### Confidence
65

### Dissents
- security: "rate limiting is over-engineering" — counter-evidence is the recent abuse log
`;
    const got = parseContributionMarkdown(md);
    expect(got).not.toBeNull();
    expect(got!.claim).toContain('rate-limiting');
    expect(got!.evidence).toHaveLength(2);
    expect(got!.evidence[0]).toMatch(/bcrypt/);
    expect(got!.confidence).toBe(65);
    expect(got!.dissents).toHaveLength(1);
    expect(got!.dissents[0]?.targetRole).toBe('security');
  });

  it('clamps confidence into 0..100 and defaults missing to 50', () => {
    const md = `### Claim
something
`;
    const got = parseContributionMarkdown(md);
    expect(got?.confidence).toBe(50);

    const md2 = `### Claim
x
### Confidence
9999
`;
    expect(parseContributionMarkdown(md2)?.confidence).toBe(100);
  });

  it('accepts ## as well as ### headers', () => {
    const md = `## Claim
use TLS

## Confidence
80
`;
    const got = parseContributionMarkdown(md);
    expect(got?.claim).toBe('use TLS');
    expect(got?.confidence).toBe(80);
  });

  it('returns null when there is no claim', () => {
    expect(parseContributionMarkdown('### Evidence\n- nothing')).toBeNull();
    expect(parseContributionMarkdown('plain prose, no headers')).toBeNull();
  });

  it('parses bracketed dissent lines `[role] reason`', () => {
    const md = `### Claim
go
### Dissents
- [qa] no fuzz coverage
`;
    const dissents = parseContributionMarkdown(md)!.dissents;
    expect(dissents[0]?.targetRole).toBe('qa');
    expect(dissents[0]?.reason).toContain('fuzz');
  });
});

describe('parseContribution (precedence)', () => {
  it('prefers JSON when the JSON block is valid', () => {
    const raw = `Some intro.
\`\`\`json
{"claim":"json wins","evidence":[],"confidence":80,"dissents":[]}
\`\`\`

### Claim
markdown loses
`;
    const got = parseContribution(raw);
    expect(got?.claim).toBe('json wins');
    expect(got?.confidence).toBe(80);
  });

  it('falls back to markdown when JSON is malformed', () => {
    const raw = `\`\`\`json
{"claim": "broken,
\`\`\`

### Claim
markdown rescues this round

### Confidence
72
`;
    const got = parseContribution(raw);
    expect(got?.claim).toBe('markdown rescues this round');
    expect(got?.confidence).toBe(72);
  });

  it('falls back to markdown when JSON parses but is wrong-shape', () => {
    const raw = `\`\`\`json
{"foo": 1}
\`\`\`

### Claim
schema mismatch is fine, markdown still wins

### Confidence
55
`;
    const got = parseContribution(raw);
    expect(got?.claim).toBe('schema mismatch is fine, markdown still wins');
    expect(got?.confidence).toBe(55);
  });

  it('still returns null when neither JSON nor markdown is salvageable', () => {
    expect(parseContribution('rambling prose without structure')).toBeNull();
  });
});

// ── QA: robustness against typical small-model output quirks ─────────────────
//
// Real LLM contributions often contain quoted code blocks, unicode, em-dashes,
// stray backticks, and inconsistent header levels. We don't need to handle
// every shape, but the parser must NEVER throw — at worst it returns null.

describe('parseContributionMarkdown — robustness', () => {
  it('survives a code block embedded inside Evidence', () => {
    const md = `### Claim
the timing logic is wrong

### Evidence
- look at this snippet:

\`\`\`ts
setTimeout(() => fire(), -1);
\`\`\`

- negative delay is undefined behavior

### Confidence
70
`;
    const got = parseContributionMarkdown(md);
    expect(got).not.toBeNull();
    expect(got!.claim).toContain('timing');
    expect(got!.confidence).toBe(70);
  });

  it('handles unicode and emoji in claim/evidence without corrupting output', () => {
    const md = `### Claim
use 🔒 TLS 1.3 — backwards-compat is fine

### Evidence
- RFC 8446 §4 requires it
- Caddy auto-renews
`;
    const got = parseContributionMarkdown(md);
    expect(got?.claim).toContain('🔒');
    expect(got?.evidence[0]).toContain('§4');
  });

  it('does not throw on completely empty input', () => {
    expect(() => parseContributionMarkdown('')).not.toThrow();
    expect(parseContributionMarkdown('')).toBeNull();
  });

  it('does not throw on input that contains only whitespace and headers', () => {
    expect(() => parseContributionMarkdown('### Claim\n\n\n')).not.toThrow();
    // Whitespace-only claim → no claim → null.
    expect(parseContributionMarkdown('### Claim\n\n\n')).toBeNull();
  });

  it('ignores h1 headers (reserved for synthesis output)', () => {
    const md = `# Claim
should be ignored

### Claim
this one wins
`;
    const got = parseContributionMarkdown(md);
    expect(got?.claim).toBe('this one wins');
  });

  it('skips malformed dissent lines without dropping the whole entry', () => {
    const md = `### Claim
go

### Dissents
- [qa] valid reason
- gibberish line that has no separator
- another: "good claim" — good reason
`;
    const dissents = parseContributionMarkdown(md)?.dissents ?? [];
    // First and third parse cleanly; the gibberish line is best-effort matched
    // by the dashed fallback. The parser must not throw on any of them.
    expect(dissents.length).toBeGreaterThanOrEqual(2);
    expect(dissents.find((d) => d.targetRole === 'qa')).toBeDefined();
  });
});
