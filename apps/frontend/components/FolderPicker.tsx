'use client';

import { useEffect, useState, useRef } from 'react';
import {
  ArrowUp, Home, Folder, FolderOpen, Loader2, X, Check,
  AlertCircle, FolderCog, Search, ChevronRight, HardDrive,
} from 'lucide-react';
import { listDirectory, type DirectoryListing } from '@/lib/api';
import { cn } from '@/lib/cn';

interface Props {
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

export function FolderPicker({ initialPath, onSelect, onClose }: Props) {
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const filterRef = useRef<HTMLInputElement>(null);

  async function navigate(target?: string) {
    setLoading(true);
    setError(null);
    setFilter('');
    try {
      const next = await listDirectory(target);
      setListing(next);
      if (listing?.cwd && listing.cwd !== next.cwd) {
        setHistory((h) => [...h, listing!.cwd]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void navigate(initialPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Parse breadcrumb segments from cwd
  const breadcrumbs = listing?.cwd
    ? listing.cwd.replace(/\\/g, '/').split('/').filter(Boolean)
    : [];

  const filtered = listing?.entries.filter((e) =>
    !filter || e.name.toLowerCase().includes(filter.toLowerCase()),
  ) ?? [];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop with radial gradient glow */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />
      <div
        className="absolute left-1/2 top-1/3 h-[300px] w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-20"
        style={{ background: 'radial-gradient(ellipse, rgba(217, 119, 87, 0.4), transparent 70%)' }}
      />

      {/* Dialog */}
      <div
        className="relative z-10 flex h-[70vh] max-h-[560px] w-full max-w-lg animate-fadeInUp flex-col overflow-hidden rounded-2xl border border-white/[0.06]"
        style={{
          background: 'linear-gradient(180deg, rgba(22, 26, 32, 0.97) 0%, rgba(11, 12, 15, 0.98) 100%)',
          boxShadow: '0 24px 80px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.04), 0 0 60px rgba(217, 119, 87, 0.08)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pb-3 pt-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15">
            <FolderOpen size={16} className="text-accent" />
          </div>
          <div className="flex-1">
            <h2 className="text-[14px] font-semibold text-fg">Open Workspace</h2>
            <p className="text-[11px] text-fg-subtle">Choose a project directory</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-subtle transition hover:bg-white/[0.06] hover:text-fg"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Breadcrumb path */}
        <div className="mx-4 mb-2 flex items-center gap-0.5 overflow-x-auto rounded-lg bg-white/[0.03] px-2 py-1.5">
          <button
            onClick={() => listing?.parent && listing.isRoot ? undefined : void navigate(listing?.home)}
            disabled={!listing}
            className="shrink-0 rounded p-0.5 text-fg-subtle transition hover:bg-white/[0.06] hover:text-fg disabled:opacity-30"
            title="Home"
          >
            <HardDrive size={11} />
          </button>
          {breadcrumbs.map((seg, i) => {
            // Reconstruct proper OS path from breadcrumb segments
            const pathUpTo = breadcrumbs.slice(0, i + 1).join('/') + (i === 0 && seg.endsWith(':') ? '/' : '');
            const isLast = i === breadcrumbs.length - 1;
            return (
              <span key={i} className="flex shrink-0 items-center">
                <ChevronRight size={9} className="mx-0.5 text-fg-subtle/50" />
                <button
                  onClick={() => !isLast && void navigate(pathUpTo)}
                  className={cn(
                    'rounded px-1 py-0.5 text-[11px] font-mono transition',
                    isLast
                      ? 'font-medium text-accent'
                      : 'text-fg-subtle hover:bg-white/[0.06] hover:text-fg',
                  )}
                >
                  {seg}
                </button>
              </span>
            );
          })}
        </div>

        {/* Quick nav + search */}
        <div className="mx-4 mb-2 flex items-center gap-1.5">
          <button
            onClick={() => listing?.parent && void navigate(listing.parent)}
            disabled={!listing || listing.isRoot || loading}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border text-fg-subtle transition hover:border-white/10 hover:bg-white/[0.04] hover:text-fg disabled:opacity-30"
            title="Up"
          >
            <ArrowUp size={12} />
          </button>
          <button
            onClick={() => listing && void navigate(listing.home)}
            disabled={loading}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border text-fg-subtle transition hover:border-white/10 hover:bg-white/[0.04] hover:text-fg disabled:opacity-30"
            title="Home"
          >
            <Home size={12} />
          </button>
          <button
            onClick={() => listing && void navigate(listing.workDir)}
            disabled={loading}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border text-fg-subtle transition hover:border-white/10 hover:bg-white/[0.04] hover:text-fg disabled:opacity-30"
            title="Workspace"
          >
            <FolderCog size={12} />
          </button>
          <div className="relative flex-1">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
            <input
              ref={filterRef}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter folders..."
              className="h-7 w-full rounded-lg border border-border bg-transparent pl-7 pr-2 text-[12px] text-fg outline-none transition placeholder:text-fg-subtle/60 focus:border-accent/40"
            />
          </div>
        </div>

        {/* Folder list */}
        <div className="mx-2 flex-1 overflow-y-auto px-2 pb-2">
          {loading && (
            <div className="flex flex-col items-center justify-center gap-2 py-12">
              <Loader2 size={20} className="animate-spin text-accent/60" />
              <span className="text-[12px] text-fg-subtle">Loading...</span>
            </div>
          )}

          {error && !loading && (
            <div className="mx-2 mt-2 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/[0.06] px-3 py-2.5 text-[12px] text-red-300">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              <span className="break-words">{error}</span>
            </div>
          )}

          {!loading && !error && filtered.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.03]">
                <Folder size={18} className="text-fg-subtle/50" />
              </div>
              <span className="text-[12px] text-fg-subtle">
                {filter ? `No folders matching "${filter}"` : 'No subfolders here'}
              </span>
              <span className="text-[11px] text-fg-subtle/60">
                You can still select this directory below
              </span>
            </div>
          )}

          {!loading && !error && filtered.map((e) => (
            <button
              key={e.path}
              onClick={() => void navigate(e.path)}
              onMouseEnter={() => setHoveredPath(e.path)}
              onMouseLeave={() => setHoveredPath(null)}
              className={cn(
                'group flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-all duration-150',
                hoveredPath === e.path
                  ? 'bg-accent/[0.08]'
                  : 'hover:bg-white/[0.03]',
              )}
            >
              <div
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all',
                  hoveredPath === e.path
                    ? 'bg-accent/20'
                    : 'bg-white/[0.04]',
                )}
              >
                <Folder
                  size={14}
                  className={cn(
                    'transition',
                    hoveredPath === e.path ? 'text-accent' : 'text-fg-subtle',
                  )}
                />
              </div>
              <span className="flex-1 truncate text-[13px] text-fg-muted group-hover:text-fg">
                {e.name}
              </span>
              <ChevronRight
                size={12}
                className="shrink-0 text-fg-subtle/40 transition group-hover:text-fg-subtle"
              />
            </button>
          ))}

          {listing?.truncated && (
            <div className="py-2 text-center text-[10px] text-fg-subtle">
              Showing first 500 entries
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 border-t border-white/[0.04] px-5 py-3">
          {/* Selected path preview */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              <span className="truncate font-mono text-[11px] text-fg-muted" title={listing?.cwd}>
                {listing?.cwd ?? '...'}
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg px-3.5 py-2 text-[12px] font-medium text-fg-subtle transition hover:bg-white/[0.04] hover:text-fg"
          >
            Cancel
          </button>
          <button
            onClick={() => listing && onSelect(listing.cwd)}
            disabled={!listing || loading}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12px] font-medium text-white transition',
              'bg-accent shadow-glow shadow-accent-glow/30 hover:bg-accent-hover',
              'disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none',
            )}
          >
            <Check size={13} />
            Open
          </button>
        </div>
      </div>
    </div>
  );
}
