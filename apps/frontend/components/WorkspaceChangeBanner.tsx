'use client';

import { useEffect, useState } from 'react';
import { FolderOpen, X, FilePlus2, FileMinus2, FileEdit } from 'lucide-react';
import { useChatStore } from '@/lib/store';
import type { WorkspaceChange } from '@/lib/store';
import { cn } from '@/lib/cn';

const CHANGE_ICONS = {
  modified: FileEdit,
  added: FilePlus2,
  deleted: FileMinus2,
} as const;

const CHANGE_COLORS = {
  modified: 'text-yellow-400',
  added: 'text-green-400',
  deleted: 'text-red-400',
} as const;

export function WorkspaceChangeBanner() {
  const changes = useChatStore((s) => s.workspaceChanges);
  const clearWorkspaceChanges = useChatStore((s) => s.clearWorkspaceChanges);
  const [dismissed, setDismissed] = useState(false);
  const [lastCount, setLastCount] = useState(0);

  // Re-show banner when new changes arrive
  useEffect(() => {
    if (changes.length > lastCount) {
      setDismissed(false);
      setLastCount(changes.length);
    }
  }, [changes.length, lastCount]);

  if (changes.length === 0 || dismissed) return null;

  // Show the 3 most recent changes
  const recent = changes.slice(0, 3);
  const extra = changes.length - 3;

  return (
    <div className="border-b border-yellow-500/20 bg-yellow-500/5 px-4 py-2">
      <div className="flex items-start gap-2">
        <FolderOpen size={13} className="mt-0.5 shrink-0 text-yellow-400" />
        <div className="flex-1 min-w-0">
          <span className="text-[11px] font-semibold text-yellow-300">Workspace changes detected</span>
          <div className="mt-1 flex flex-wrap gap-2">
            {recent.map((c, i) => (
              <ChangeChip key={i} change={c} />
            ))}
            {extra > 0 && (
              <span className="text-[10px] text-fg-subtle">+{extra} more</span>
            )}
          </div>
        </div>
        <button
          onClick={() => { setDismissed(true); clearWorkspaceChanges(); }}
          className="shrink-0 text-fg-subtle hover:text-fg"
          aria-label="Dismiss"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}

function ChangeChip({ change }: { change: WorkspaceChange }) {
  const Icon = CHANGE_ICONS[change.changeType];
  const color = CHANGE_COLORS[change.changeType];
  const file = change.files[0] ?? '';
  const baseName = file.split(/[\\/]/).pop() ?? file;

  return (
    <span className={cn('flex items-center gap-1 text-[10px]', color)}>
      <Icon size={10} />
      <span className="font-mono text-fg-muted">{baseName}</span>
      {change.files.length > 1 && (
        <span className="text-fg-subtle">+{change.files.length - 1}</span>
      )}
    </span>
  );
}
