'use client';

import { useMemo } from 'react';
import { Network, X } from 'lucide-react';
import { useChatStore } from '@/lib/store';

interface Props {
  onClose: () => void;
}

const WIDTH = 360;
const HEIGHT = 420;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;

export function MentalModelCanvas({ onClose }: Props) {
  const mentalModel = useChatStore((s) => s.mentalModel);

  // Layout: sort by weight, place heaviest at center, rest on concentric rings
  const layout = useMemo(() => {
    const sorted = [...mentalModel.nodes].sort((a, b) => b.weight - a.weight);
    const positions = new Map<string, { x: number; y: number; r: number }>();
    if (sorted.length === 0) return { positions, sorted };

    // Place the heaviest node at center
    const hub = sorted[0]!;
    const maxWeight = hub.weight;
    const radius = (w: number) => 6 + Math.log(w + 1) * 4;
    positions.set(hub.id, { x: CENTER_X, y: CENTER_Y, r: radius(hub.weight) });

    // Rest on a single ring (could do multiple rings based on weight tier)
    const rest = sorted.slice(1);
    const ringRadius = Math.min(WIDTH, HEIGHT) * 0.38;
    rest.forEach((node, i) => {
      const angle = (i / Math.max(rest.length, 1)) * Math.PI * 2 - Math.PI / 2;
      positions.set(node.id, {
        x: CENTER_X + Math.cos(angle) * ringRadius,
        y: CENTER_Y + Math.sin(angle) * ringRadius,
        r: radius(node.weight),
      });
    });

    return { positions, sorted, maxWeight };
  }, [mentalModel]);

  const { positions, sorted } = layout;

  return (
    <aside className="flex h-full w-[400px] shrink-0 flex-col border-l border-border bg-bg-panel/90 backdrop-blur">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Network size={14} className="text-accent" />
          <span className="text-[13px] font-semibold text-fg">Mental Model</span>
          {sorted.length > 0 && (
            <span className="rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-accent">
              {sorted.length} nodes
            </span>
          )}
        </div>
        <button onClick={onClose} className="text-fg-subtle hover:text-fg"><X size={14} /></button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="px-4 py-10 text-center text-[12px] text-fg-subtle">
            <Network size={32} className="mx-auto mb-3 opacity-20" />
            <p>No files in working memory yet.</p>
            <p className="mt-1 text-[11px]">The graph builds as Koda reads and edits files.</p>
          </div>
        ) : (
          <>
            {/* Graph */}
            <div className="p-3">
              <svg width={WIDTH} height={HEIGHT} className="rounded border border-border bg-bg">
                {/* Edges */}
                {mentalModel.edges.map((edge, i) => {
                  const from = positions.get(edge.from);
                  const to = positions.get(edge.to);
                  if (!from || !to) return null;
                  return (
                    <line
                      key={i}
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke="currentColor"
                      strokeWidth="1"
                      strokeOpacity="0.2"
                      className="text-fg-subtle"
                    />
                  );
                })}
                {/* Nodes */}
                {sorted.map((node) => {
                  const pos = positions.get(node.id);
                  if (!pos) return null;
                  return (
                    <g key={node.id}>
                      <circle
                        cx={pos.x}
                        cy={pos.y}
                        r={pos.r}
                        className="fill-accent stroke-accent-hover"
                        strokeWidth="1.5"
                        fillOpacity="0.8"
                      >
                        <title>{node.id} — touched {node.weight}×</title>
                      </circle>
                      {pos.r > 7 && (
                        <text
                          x={pos.x}
                          y={pos.y + pos.r + 10}
                          textAnchor="middle"
                          className="fill-fg-muted font-mono"
                          fontSize="9"
                        >
                          {node.label.slice(0, 14)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Top nodes by weight */}
            <div className="border-t border-border px-3 py-3">
              <div className="mb-1.5 text-[10px] uppercase tracking-wider text-fg-subtle">Most touched</div>
              <div className="space-y-1">
                {sorted.slice(0, 8).map((node) => (
                  <div key={node.id} className="flex items-center justify-between text-[11px]">
                    <span className="truncate font-mono text-fg-muted" title={node.id}>{node.label}</span>
                    <span className="shrink-0 text-accent tabular-nums">{node.weight}×</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="border-t border-border px-3 py-2 text-[11px] text-fg-subtle">
        Watch Koda build its understanding of your codebase in real time.
      </div>
    </aside>
  );
}
