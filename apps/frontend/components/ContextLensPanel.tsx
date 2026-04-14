'use client';

import { BookOpen, X, FileText, Search, Layers } from 'lucide-react';
import { useChatStore } from '@/lib/store';

interface Props {
  onClose: () => void;
}

function fileIcon(entry: string) {
  if (entry.startsWith('glob:')) return <Layers size={11} className="shrink-0 text-accent-2" />;
  if (entry.includes('grep') || entry.includes('search')) return <Search size={11} className="shrink-0 text-accent" />;
  return <FileText size={11} className="shrink-0 text-fg-subtle" />;
}

function shortName(entry: string): string {
  if (entry.startsWith('glob:')) return entry.slice(5);
  // shorten long absolute paths to last 3 segments
  const parts = entry.replace(/\\/g, '/').split('/');
  return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : entry;
}

export function ContextLensPanel({ onClose }: Props) {
  const contextFiles = useChatStore((s) => s.contextFiles);

  const globs = contextFiles.filter((f) => f.startsWith('glob:'));
  const files = contextFiles.filter((f) => !f.startsWith('glob:'));

  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col border-l border-border bg-bg-panel/90 backdrop-blur">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <BookOpen size={14} className="text-accent" />
          <span className="text-[13px] font-semibold text-fg">Context Lens</span>
          {contextFiles.length > 0 && (
            <span className="rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-accent">
              {contextFiles.length}
            </span>
          )}
        </div>
        <button onClick={onClose} className="text-fg-subtle hover:text-fg"><X size={14} /></button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 text-[12px]">
        {contextFiles.length === 0 ? (
          <p className="py-6 text-center text-fg-subtle">
            No files read yet in this session. The agent's context will appear here as it explores your code.
          </p>
        ) : (
          <>
            {files.length > 0 && (
              <section className="mb-4">
                <div className="mb-1.5 text-[10px] uppercase tracking-wider text-fg-subtle">Files read</div>
                <div className="space-y-1">
                  {files.map((f) => (
                    <div key={f} className="flex items-center gap-1.5 rounded px-2 py-1 hover:bg-bg-hover">
                      {fileIcon(f)}
                      <span className="min-w-0 truncate font-mono text-[11px] text-fg-muted" title={f}>
                        {shortName(f)}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {globs.length > 0 && (
              <section>
                <div className="mb-1.5 text-[10px] uppercase tracking-wider text-fg-subtle">Glob patterns</div>
                <div className="space-y-1">
                  {globs.map((g) => (
                    <div key={g} className="flex items-center gap-1.5 rounded px-2 py-1 hover:bg-bg-hover">
                      {fileIcon(g)}
                      <span className="min-w-0 truncate font-mono text-[11px] text-fg-muted" title={g.slice(5)}>
                        {g.slice(5)}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      <div className="border-t border-border px-3 py-2 text-[11px] text-fg-subtle">
        Tracks every file the agent has read or searched in this session.
      </div>
    </aside>
  );
}
