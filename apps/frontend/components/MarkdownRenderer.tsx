'use client';

import { useState, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy, Maximize2, Minimize2, Play, Code2 } from 'lucide-react';
import { cn } from '@/lib/cn';

// ── Artifact (HTML/SVG inline renderer) ─────────────────────────────────────

function ArtifactBlock({ lang, code }: { lang: string; code: string }) {
  const [expanded, setExpanded] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  async function handleCopy() {
    await navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  const isSvg = lang === 'svg';
  const isHtml = lang === 'html';

  const content = isSvg
    ? `<!DOCTYPE html><html><body style="margin:0;background:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh">${code}</body></html>`
    : code;

  return (
    <div className={cn('my-3 overflow-hidden rounded-xl border border-border bg-bg-panel', expanded && 'fixed inset-4 z-50 my-0')}>
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5">
        <span className="flex h-4 w-4 items-center justify-center rounded bg-blue-500/20 text-[9px] font-bold uppercase text-blue-400">
          {isSvg ? 'SVG' : 'HTML'}
        </span>
        <span className="flex-1 text-[11px] text-fg-subtle">Artifact</span>
        <button
          onClick={() => setShowSource((v) => !v)}
          title={showSource ? 'Show preview' : 'Show source'}
          className={cn('flex items-center gap-1 rounded px-2 py-0.5 text-[10px] transition', showSource ? 'bg-accent/15 text-accent' : 'text-fg-subtle hover:bg-bg-hover hover:text-fg')}
        >
          {showSource ? <Play size={10} /> : <Code2 size={10} />}
          {showSource ? 'Preview' : 'Source'}
        </button>
        <button onClick={handleCopy} className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-fg-subtle hover:bg-bg-hover hover:text-fg transition">
          {copied ? <Check size={10} /> : <Copy size={10} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button onClick={() => setExpanded((v) => !v)} className="rounded p-1 text-fg-subtle hover:bg-bg-hover hover:text-fg transition">
          {expanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
        </button>
      </div>

      {showSource ? (
        <pre className="max-h-80 overflow-auto p-3 text-[11px] font-mono text-fg-muted">
          <code>{code}</code>
        </pre>
      ) : (
        <iframe
          ref={iframeRef}
          srcDoc={content}
          sandbox="allow-scripts allow-same-origin"
          className={cn('w-full border-0 bg-white', expanded ? 'h-full' : 'h-64')}
          title={`${lang} artifact`}
        />
      )}
    </div>
  );
}

// ── Code block ────────────────────────────────────────────────────────────────

const ARTIFACT_LANGS = new Set(['html', 'svg']);

function CodeBlock({ children, className }: { children: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const lang = className?.replace('language-', '') ?? '';

  // Render HTML/SVG as interactive artifacts
  if (ARTIFACT_LANGS.has(lang) && children.trim()) {
    return <ArtifactBlock lang={lang} code={children} />;
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="group relative my-2">
      {lang && (
        <div className="absolute left-3 top-2 select-none text-[10px] font-mono text-fg-subtle">
          {lang}
        </div>
      )}
      <button
        onClick={handleCopy}
        className={cn(
          'absolute right-2 top-2 flex items-center gap-1 rounded px-1.5 py-0.5',
          'text-[10px] text-fg-subtle opacity-0 transition hover:bg-bg-hover hover:text-fg group-hover:opacity-100',
        )}
        aria-label="Copy code"
      >
        {copied ? <Check size={10} /> : <Copy size={10} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre
        className={cn(
          'overflow-x-auto rounded border border-border bg-bg p-3 text-[12px]',
          lang && 'pt-7',
        )}
      >
        <code>{children}</code>
      </pre>
    </div>
  );
}

export function MarkdownRenderer({ children }: { children: string }) {
  return (
    <div className="prose-koda max-w-none text-[14px] leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children: codeChildren, ...props }) {
            const content = String(codeChildren).replace(/\n$/, '');
            const isInline = !className && !content.includes('\n');
            if (isInline) {
              return (
                <code
                  className="rounded bg-bg-subtle px-1 py-0.5 font-mono text-[12px]"
                  {...props}
                >
                  {codeChildren}
                </code>
              );
            }
            return <CodeBlock className={className}>{content}</CodeBlock>;
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
