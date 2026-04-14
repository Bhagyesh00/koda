'use client';

import { useEffect, useState } from 'react';
import { ArrowUp, Home, Folder, Loader2, X, Check, AlertCircle, FolderCog } from 'lucide-react';
import { listDirectory, type DirectoryListing } from '@/lib/api';

interface Props {
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

export function FolderPicker({ initialPath, onSelect, onClose }: Props) {
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function navigate(target?: string) {
    setLoading(true);
    setError(null);
    try {
      const next = await listDirectory(target);
      setListing(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Initial load
  useEffect(() => {
    void navigate(initialPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape closes the picker
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="folder-picker-title"
    >
      <div
        className="koda-glass flex h-[60vh] w-full max-w-xl flex-col rounded-2xl shadow-glow shadow-accent-glow"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
          <div className="flex items-center gap-2">
            <Folder size={14} className="text-accent" />
            <span id="folder-picker-title" className="text-[13px] font-semibold text-fg">
              Pick a folder
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-fg-subtle transition hover:bg-bg-hover hover:text-fg"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Path bar with shortcuts */}
        <div className="flex items-center gap-1 border-b border-border/60 px-3 py-2">
          <button
            onClick={() => listing?.parent && void navigate(listing.parent)}
            disabled={!listing || listing.isRoot || loading}
            className="rounded p-1 text-fg-subtle transition hover:bg-bg-hover hover:text-fg disabled:opacity-30"
            title="Up one level"
          >
            <ArrowUp size={13} />
          </button>
          <button
            onClick={() => listing && void navigate(listing.home)}
            disabled={loading}
            className="rounded p-1 text-fg-subtle transition hover:bg-bg-hover hover:text-fg disabled:opacity-30"
            title="Home directory"
          >
            <Home size={13} />
          </button>
          <button
            onClick={() => listing && void navigate(listing.workDir)}
            disabled={loading}
            className="rounded p-1 text-fg-subtle transition hover:bg-bg-hover hover:text-fg disabled:opacity-30"
            title="Server WORK_DIR"
          >
            <FolderCog size={13} />
          </button>
          <div
            className="ml-1 min-w-0 flex-1 truncate font-mono text-[11.5px] text-fg-muted"
            title={listing?.cwd}
          >
            {listing?.cwd ?? '…'}
          </div>
        </div>

        {/* Entry list */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {loading && (
            <div className="flex items-center justify-center py-8 text-[12px] text-fg-subtle">
              <Loader2 size={14} className="mr-2 animate-spin" /> Loading…
            </div>
          )}
          {error && !loading && (
            <div className="m-2 flex items-start gap-2 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
              <AlertCircle size={12} className="mt-0.5 shrink-0" />
              <span className="break-words">{error}</span>
            </div>
          )}
          {!loading && !error && listing && listing.entries.length === 0 && (
            <div className="py-6 text-center text-[12px] text-fg-subtle">
              No subfolders here. You can still pick this folder below.
            </div>
          )}
          {!loading && !error && listing?.entries.map((e) => (
            <button
              key={e.path}
              onClick={() => void navigate(e.path)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-fg-muted transition hover:bg-bg-hover hover:text-fg"
            >
              <Folder size={12} className="shrink-0 text-accent/70" />
              <span className="truncate">{e.name}</span>
            </button>
          ))}
          {listing?.truncated && (
            <div className="py-2 text-center text-[10px] text-fg-subtle">
              (showing first 500 entries)
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border/60 px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-1.5 text-[12px] font-medium text-fg-muted transition hover:bg-bg-hover hover:text-fg"
          >
            Cancel
          </button>
          <button
            onClick={() => listing && onSelect(listing.cwd)}
            disabled={!listing || loading}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-[12px] font-medium text-white shadow-glow shadow-accent-glow transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Check size={12} /> Select this folder
          </button>
        </div>
      </div>
    </div>
  );
}
