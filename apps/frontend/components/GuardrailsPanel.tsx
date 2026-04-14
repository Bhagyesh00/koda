'use client';

import { useEffect, useState } from 'react';
import { Shield, Plus, Trash2, ToggleRight, ToggleLeft, X } from 'lucide-react';
import type { GuardRule } from '@koda/shared';
import { listGuardrails, addGuardrail, updateGuardrail, deleteGuardrail } from '@/lib/api';
import { useChatStore } from '@/lib/store';
import { cn } from '@/lib/cn';

interface Props {
  sessionId: string;
  onClose: () => void;
}

const PRESETS: Array<Omit<GuardRule, 'id'>> = [
  { enabled: true, description: 'Never delete test files', tools: ['bash'], commandPattern: 'rm.*\\.test\\.', action: 'block', message: 'Deleting test files is not allowed.' },
  { enabled: true, description: 'Protect node_modules', tools: ['write_file', 'edit_file'], pathPattern: '**/node_modules/**', action: 'block', message: 'Cannot modify files inside node_modules.' },
  { enabled: true, description: 'Warn before editing config', tools: ['write_file', 'edit_file'], pathPattern: '*.config.*', action: 'warn', message: 'You are about to modify a config file.' },
  { enabled: true, description: 'No force commands', tools: ['bash'], commandPattern: '--force|\\-f\\b|rm -rf', action: 'warn', message: 'Destructive flag detected — double check this command.' },
];

export function GuardrailsPanel({ sessionId, onClose }: Props) {
  const [rules, setRules] = useState<GuardRule[]>([]);
  const [adding, setAdding] = useState(false);
  const addToast = useChatStore((s) => s.addToast);

  async function load() {
    try { setRules(await listGuardrails(sessionId)); } catch { /* noop */ }
  }

  useEffect(() => { void load(); }, [sessionId]);

  async function handleAdd(rule: Omit<GuardRule, 'id'>) {
    try {
      await addGuardrail(sessionId, rule);
      await load();
      addToast('Guardrail added', 'success');
    } catch (e) { addToast((e as Error).message, 'error'); }
    setAdding(false);
  }

  async function handleToggle(rule: GuardRule) {
    await updateGuardrail(sessionId, rule.id, { enabled: !rule.enabled });
    await load();
  }

  async function handleDelete(ruleId: string) {
    await deleteGuardrail(sessionId, ruleId);
    await load();
    addToast('Guardrail removed', 'success');
  }

  return (
    <aside className="flex h-full w-[380px] shrink-0 flex-col border-l border-border bg-bg-panel/90 backdrop-blur">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Shield size={14} className="text-accent-2" />
          <span className="text-[13px] font-semibold text-fg">Guardrails</span>
          {rules.length > 0 && (
            <span className="rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-accent">
              {rules.filter((r) => r.enabled).length} active
            </span>
          )}
        </div>
        <button onClick={onClose} className="text-fg-subtle hover:text-fg"><X size={14} /></button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {rules.length === 0 && !adding && (
          <p className="py-4 text-center text-[12px] text-fg-subtle">No rules yet. Add one below or pick a preset.</p>
        )}

        {rules.map((rule) => (
          <div key={rule.id} className={cn(
            'mb-2 rounded-lg border p-3 text-[12px] transition',
            rule.enabled ? 'border-border bg-bg-subtle' : 'border-border/40 bg-bg opacity-60',
          )}>
            <div className="flex items-start gap-2">
              <div className={cn('mt-0.5 h-2 w-2 shrink-0 rounded-full', rule.action === 'block' ? 'bg-red-400' : 'bg-yellow-400')} />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-fg truncate">{rule.description}</div>
                <div className="mt-0.5 text-fg-subtle truncate">{rule.message}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {rule.tools.map((t) => (
                    <span key={t} className="rounded bg-bg-hover px-1 py-0.5 font-mono text-[10px] text-fg-muted">{t}</span>
                  ))}
                  {rule.pathPattern && <span className="rounded bg-bg-hover px-1 py-0.5 font-mono text-[10px] text-fg-muted">path:{rule.pathPattern}</span>}
                  {rule.commandPattern && <span className="rounded bg-bg-hover px-1 py-0.5 font-mono text-[10px] text-fg-muted">cmd:/{rule.commandPattern}/</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button onClick={() => void handleToggle(rule)} className="text-fg-subtle hover:text-fg" title={rule.enabled ? 'Disable' : 'Enable'}>
                  {rule.enabled ? <ToggleRight size={14} className="text-accent" /> : <ToggleLeft size={14} />}
                </button>
                <button onClick={() => void handleDelete(rule.id)} className="text-fg-subtle hover:text-red-400">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          </div>
        ))}

        {adding && <AddRuleForm onAdd={handleAdd} onCancel={() => setAdding(false)} />}
      </div>

      <div className="border-t border-border p-3">
        {!adding && (
          <>
            <button
              onClick={() => setAdding(true)}
              className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-bg-subtle px-3 py-1.5 text-[12px] font-medium text-fg transition hover:bg-bg-hover"
            >
              <Plus size={12} /> Custom rule
            </button>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-fg-subtle">Presets</div>
            <div className="flex flex-wrap gap-1">
              {PRESETS.map((p) => (
                <button
                  key={p.description}
                  onClick={() => void handleAdd(p)}
                  className="rounded border border-border bg-bg px-2 py-1 text-[11px] text-fg-muted hover:border-accent/40 hover:text-fg transition"
                >
                  {p.description}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

function AddRuleForm({ onAdd, onCancel }: { onAdd: (r: Omit<GuardRule, 'id'>) => void; onCancel: () => void }) {
  const [desc, setDesc] = useState('');
  const [msg, setMsg] = useState('');
  const [tools, setTools] = useState('*');
  const [pathPat, setPathPat] = useState('');
  const [cmdPat, setCmdPat] = useState('');
  const [action, setAction] = useState<'block' | 'warn'>('warn');

  function submit() {
    if (!desc || !msg) return;
    onAdd({
      enabled: true,
      description: desc,
      message: msg,
      tools: tools.split(',').map((s) => s.trim()).filter(Boolean),
      pathPattern: pathPat || undefined,
      commandPattern: cmdPat || undefined,
      action,
    });
  }

  return (
    <div className="rounded-lg border border-accent/30 bg-bg-subtle p-3 text-[12px]">
      <div className="mb-2 font-medium text-fg">New rule</div>
      <label className="mb-1 block text-fg-subtle">Description</label>
      <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="No force commands" className="mb-2 w-full rounded border border-border bg-bg px-2 py-1 text-fg outline-none focus:border-accent" />
      <label className="mb-1 block text-fg-subtle">Message shown when triggered</label>
      <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Dangerous flag detected" className="mb-2 w-full rounded border border-border bg-bg px-2 py-1 text-fg outline-none focus:border-accent" />
      <label className="mb-1 block text-fg-subtle">Tools (comma-sep, or * for all)</label>
      <input value={tools} onChange={(e) => setTools(e.target.value)} className="mb-2 w-full rounded border border-border bg-bg px-2 py-1 font-mono text-fg outline-none focus:border-accent" />
      <label className="mb-1 block text-fg-subtle">Path glob (optional)</label>
      <input value={pathPat} onChange={(e) => setPathPat(e.target.value)} placeholder="**/*.test.ts" className="mb-2 w-full rounded border border-border bg-bg px-2 py-1 font-mono text-fg outline-none focus:border-accent" />
      <label className="mb-1 block text-fg-subtle">Command regex (optional)</label>
      <input value={cmdPat} onChange={(e) => setCmdPat(e.target.value)} placeholder="--force" className="mb-2 w-full rounded border border-border bg-bg px-2 py-1 font-mono text-fg outline-none focus:border-accent" />
      <div className="mb-3 flex gap-3">
        {(['block', 'warn'] as const).map((a) => (
          <label key={a} className="flex cursor-pointer items-center gap-1.5">
            <input type="radio" checked={action === a} onChange={() => setAction(a)} />
            <span className={a === 'block' ? 'text-red-400' : 'text-yellow-400'}>{a === 'block' ? '🚫 Block' : '⚠️ Warn'}</span>
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <button onClick={submit} disabled={!desc || !msg} className="flex-1 rounded bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent-hover disabled:opacity-50">Add rule</button>
        <button onClick={onCancel} className="rounded border border-border px-3 py-1.5 text-[12px] text-fg-muted hover:bg-bg-hover">Cancel</button>
      </div>
    </div>
  );
}
