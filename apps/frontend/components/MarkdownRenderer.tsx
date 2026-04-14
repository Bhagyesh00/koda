'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/cn';

function CodeBlock({ children, className }: { children: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const lang = className?.replace('language-', '') ?? '';

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
