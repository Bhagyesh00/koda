'use client';

import { useEffect, useState } from 'react';
import { Wrench, Plus, Trash2, X, Save, AlertCircle } from 'lucide-react';
import {
  listCustomTools,
  createCustomTool,
  updateCustomTool,
  deleteCustomTool,
  type CustomToolDef,
  type CustomArg,
} from '@/lib/api';
import { cn } from '@/lib/cn';

interface Props {
  onClose: () => void;
}

const EMPTY_TOOL: CustomToolDef = {
  name: '',
  description: '',
  requiresApproval: true,
  command: '',
  args: [],
};

const EMPTY_ARG: CustomArg = {
  name: '',
  type: 'string',
  description: '',
  required: true,
};

export function CustomToolBuilder({ onClose }: Props) {
  const [tools, setTools] = useState<CustomToolDef[]>([]);
  const [editing, setEditing] = useState<CustomToolDef | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function loadTools() {
    try { setTools(await listCustomTools()); } catch { /* noop */ }
  }

  useEffect(() => { void loadTools(); }, []);

  function startNew() {
    setEditing({ ...EMPTY_TOOL, args: [] });
    setIsNew(true);
    setError(null);
  }

  function startEdit(tool: CustomToolDef) {
    setEditing(JSON.parse(JSON.stringify(tool)) as CustomToolDef);
    setIsNew(false);
    setError(null);
  }

  async function handleSave() {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        await createCustomTool(editing);
      } else {
        const { name, ...rest } = editing;
        await updateCustomTool(name, rest);
      }
      await loadTools();
      setEditing(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(name: string) {
    try {
      await deleteCustomTool(name);
      await loadTools();
      if (editing?.name === name) setEditing(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function addArg() {
    if (!editing) return;
    setEditing({ ...editing, args: [...editing.args, { ...EMPTY_ARG }] });
  }

  function updateArg(idx: number, patch: Partial<CustomArg>) {
    if (!editing) return;
    const args = editing.args.map((a, i) => (i === idx ? { ...a, ...patch } : a));
    setEditing({ ...editing, args });
  }

  function removeArg(idx: number) {
    if (!editing) return;
    setEditing({ ...editing, args: editing.args.filter((_, i) => i !== idx) });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="flex h-[80vh] w-[800px] max-w-[95vw] flex-col overflow-hidden rounded-2xl border border-border bg-bg-panel shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Wrench size={16} className="text-accent" />
            <span className="text-[14px] font-semibold text-fg">Custom Tool Builder</span>
          </div>
          <button onClick={onClose} className="text-fg-subtle hover:text-fg"><X size={15} /></button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Tool list */}
          <div className="flex w-[220px] shrink-0 flex-col border-r border-border">
            <div className="p-3">
              <button
                onClick={startNew}
                className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-accent/40 py-1.5 text-[12px] text-accent hover:border-accent hover:bg-accent/5 transition"
              >
                <Plus size={12} /> New tool
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {tools.length === 0 && (
                <p className="px-4 py-3 text-[12px] text-fg-subtle">No custom tools yet.</p>
              )}
              {tools.map((t) => (
                <div
                  key={t.name}
                  className={cn(
                    'group flex cursor-pointer items-center justify-between px-3 py-2.5 transition hover:bg-bg-hover',
                    editing?.name === t.name && 'bg-bg-hover',
                  )}
                  onClick={() => startEdit(t)}
                >
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-medium text-fg">{t.name}</div>
                    <div className="truncate text-[10px] text-fg-subtle">{t.description}</div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); void handleDelete(t.name); }}
                    className="ml-1 shrink-0 text-fg-subtle opacity-0 hover:text-red-400 group-hover:opacity-100 transition"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Editor */}
          <div className="flex flex-1 flex-col overflow-y-auto p-5 text-[13px]">
            {!editing ? (
              <div className="flex flex-1 flex-col items-center justify-center text-center text-fg-subtle">
                <Wrench size={32} className="mb-3 opacity-30" />
                <p>Select a tool to edit or create a new one.</p>
                <p className="mt-1 text-[11px]">Tools run shell commands with typed arguments.</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className="mb-1 block text-[11px] text-fg-subtle">Tool name (snake_case)</label>
                    <input
                      value={editing.name}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      disabled={!isNew}
                      placeholder="my_tool"
                      className="w-full rounded border border-border bg-bg px-2.5 py-1.5 font-mono text-[12px] text-fg outline-none focus:border-accent disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-fg-subtle">Description</label>
                    <input
                      value={editing.description}
                      onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                      placeholder="What does this tool do?"
                      className="w-full rounded border border-border bg-bg px-2.5 py-1.5 text-[12px] text-fg outline-none focus:border-accent"
                    />
                  </div>
                </div>

                <div className="mb-4">
                  <label className="mb-1 block text-[11px] text-fg-subtle">
                    Shell command — use <code className="rounded bg-bg-hover px-1 font-mono text-[10px]">{'{arg_name}'}</code> for argument placeholders
                  </label>
                  <input
                    value={editing.command}
                    onChange={(e) => setEditing({ ...editing, command: e.target.value })}
                    placeholder="echo {message} | tee {output_file}"
                    className="w-full rounded border border-border bg-bg px-2.5 py-1.5 font-mono text-[12px] text-fg outline-none focus:border-accent"
                  />
                </div>

                <div className="mb-4 flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="approval"
                    checked={editing.requiresApproval}
                    onChange={(e) => setEditing({ ...editing, requiresApproval: e.target.checked })}
                    className="rounded border-border"
                  />
                  <label htmlFor="approval" className="cursor-pointer text-[12px] text-fg-subtle">
                    Require user approval before running
                  </label>
                </div>

                {/* Args */}
                <div className="mb-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[11px] uppercase tracking-wider text-fg-subtle">Arguments</span>
                    <button
                      onClick={addArg}
                      className="flex items-center gap-1 text-[11px] text-accent hover:text-accent-hover"
                    >
                      <Plus size={11} /> Add
                    </button>
                  </div>
                  <div className="space-y-2">
                    {editing.args.map((arg, idx) => (
                      <div key={idx} className="flex items-start gap-2 rounded border border-border bg-bg-subtle p-2">
                        <div className="grid flex-1 grid-cols-3 gap-2">
                          <input
                            value={arg.name}
                            onChange={(e) => updateArg(idx, { name: e.target.value })}
                            placeholder="arg_name"
                            className="rounded border border-border bg-bg px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent"
                          />
                          <select
                            value={arg.type}
                            onChange={(e) => updateArg(idx, { type: e.target.value as CustomArg['type'] })}
                            className="rounded border border-border bg-bg px-2 py-1 text-[11px] text-fg outline-none focus:border-accent"
                          >
                            <option value="string">string</option>
                            <option value="number">number</option>
                            <option value="boolean">boolean</option>
                          </select>
                          <input
                            value={arg.description}
                            onChange={(e) => updateArg(idx, { description: e.target.value })}
                            placeholder="Description"
                            className="rounded border border-border bg-bg px-2 py-1 text-[11px] text-fg outline-none focus:border-accent"
                          />
                        </div>
                        <label className="flex cursor-pointer items-center gap-1 whitespace-nowrap text-[10px] text-fg-subtle">
                          <input
                            type="checkbox"
                            checked={arg.required}
                            onChange={(e) => updateArg(idx, { required: e.target.checked })}
                          />
                          required
                        </label>
                        <button onClick={() => removeArg(idx)} className="text-fg-subtle hover:text-red-400">
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))}
                    {editing.args.length === 0 && (
                      <p className="text-[11px] text-fg-subtle">No arguments — tool runs as-is.</p>
                    )}
                  </div>
                </div>

                {error && (
                  <div className="mb-3 flex items-center gap-2 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
                    <AlertCircle size={12} /> {error}
                  </div>
                )}

                <div className="mt-auto flex justify-end gap-2 pt-3">
                  <button
                    onClick={() => setEditing(null)}
                    className="rounded border border-border px-4 py-1.5 text-[12px] text-fg-muted hover:bg-bg-hover"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => void handleSave()}
                    disabled={saving || !editing.name || !editing.command}
                    className="flex items-center gap-1.5 rounded bg-accent px-4 py-1.5 text-[12px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                  >
                    <Save size={12} /> {saving ? 'Saving…' : 'Save tool'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
