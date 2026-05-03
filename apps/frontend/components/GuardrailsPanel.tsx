'use client';

import { useEffect, useState } from 'react';
import { Shield, Plus, Trash2, ToggleRight, ToggleLeft } from 'lucide-react';
import type { GuardRule } from '@koda/shared';
import { listGuardrails, addGuardrail, updateGuardrail, deleteGuardrail } from '@/lib/api';
import { useChatStore } from '@/lib/store';
import { Panel, Button, IconButton, Input, Card, Badge } from '@/lib/components';

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
    try {
      setRules(await listGuardrails(sessionId));
    } catch {
      /* network error — keep prior rules visible so panel doesn't blank out */
    }
  }

  useEffect(() => {
    void load();
  }, [sessionId]);

  async function handleAdd(rule: Omit<GuardRule, 'id'>) {
    try {
      await addGuardrail(sessionId, rule);
      await load();
      addToast('Guardrail added', 'success');
    } catch (e) {
      addToast((e as Error).message, 'error');
    }
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

  const activeCount = rules.filter((r) => r.enabled).length;

  return (
    <Panel
      title="Guardrails"
      icon={<Shield size={14} />}
      badge={activeCount > 0 ? <Badge tone="accent">{activeCount} active</Badge> : null}
      onClose={onClose}
      closeLabel="Close guardrails panel"
      footer={
        !adding && (
          <>
            <Button
              block
              variant="secondary"
              leftIcon={<Plus size={12} />}
              onClick={() => setAdding(true)}
              className="mb-2"
            >
              Custom rule
            </Button>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-fg-subtle">
              Presets
            </div>
            <div className="flex flex-wrap gap-1">
              {PRESETS.map((p) => (
                <button
                  key={p.description}
                  type="button"
                  onClick={() => void handleAdd(p)}
                  className="rounded border border-border bg-bg px-2 py-1 text-[11px] text-fg-muted transition-colors hover:border-accent/40 hover:text-fg"
                >
                  {p.description}
                </button>
              ))}
            </div>
          </>
        )
      }
    >
      {rules.length === 0 && !adding && (
        <p className="py-4 text-center text-[12px] text-fg-subtle">
          No rules yet. Add one below or pick a preset.
        </p>
      )}

      {rules.map((rule) => (
        <Card
          key={rule.id}
          padding="sm"
          muted={!rule.enabled}
          tone={rule.enabled ? 'default' : 'subtle'}
          className="mb-2 text-[12px]"
        >
          <div className="flex items-start gap-2">
            <span
              aria-hidden
              className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                rule.action === 'block' ? 'bg-red-400' : 'bg-yellow-400'
              }`}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-fg">{rule.description}</div>
              <div className="mt-0.5 truncate text-fg-subtle">{rule.message}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {rule.tools.map((t) => (
                  <Badge key={t} className="font-mono normal-case">
                    {t}
                  </Badge>
                ))}
                {rule.pathPattern && (
                  <Badge className="font-mono normal-case">path:{rule.pathPattern}</Badge>
                )}
                {rule.commandPattern && (
                  <Badge className="font-mono normal-case">cmd:/{rule.commandPattern}/</Badge>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <IconButton
                size="xs"
                icon={rule.enabled ? <ToggleRight className="text-accent" /> : <ToggleLeft />}
                aria-label={rule.enabled ? 'Disable rule' : 'Enable rule'}
                onClick={() => void handleToggle(rule)}
              />
              <IconButton
                size="xs"
                tone="danger"
                icon={<Trash2 />}
                aria-label="Delete rule"
                onClick={() => void handleDelete(rule.id)}
              />
            </div>
          </div>
        </Card>
      ))}

      {adding && <AddRuleForm onAdd={handleAdd} onCancel={() => setAdding(false)} />}
    </Panel>
  );
}

function AddRuleForm({
  onAdd,
  onCancel,
}: {
  onAdd: (r: Omit<GuardRule, 'id'>) => void;
  onCancel: () => void;
}) {
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
    <Card tone="accent" padding="md" className="text-[12px]">
      <div className="mb-2 font-medium text-fg">New rule</div>

      <div className="space-y-2">
        <Input
          label="Description"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="No force commands"
          required
        />
        <Input
          label="Message shown when triggered"
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          placeholder="Dangerous flag detected"
          required
        />
        <Input
          label="Tools (comma-sep, or * for all)"
          value={tools}
          onChange={(e) => setTools(e.target.value)}
          mono
        />
        <Input
          label="Path glob (optional)"
          value={pathPat}
          onChange={(e) => setPathPat(e.target.value)}
          placeholder="**/*.test.ts"
          mono
        />
        <Input
          label="Command regex (optional)"
          value={cmdPat}
          onChange={(e) => setCmdPat(e.target.value)}
          placeholder="--force"
          mono
        />
      </div>

      <fieldset className="mt-3 mb-3 flex gap-3" aria-label="Action">
        {(['block', 'warn'] as const).map((a) => (
          <label key={a} className="flex cursor-pointer items-center gap-1.5">
            <input
              type="radio"
              name="rule-action"
              checked={action === a}
              onChange={() => setAction(a)}
              className="accent-accent"
            />
            <span className={a === 'block' ? 'text-red-400' : 'text-yellow-400'}>
              {a === 'block' ? 'Block' : 'Warn'}
            </span>
          </label>
        ))}
      </fieldset>

      <div className="flex gap-2">
        <Button
          variant="primary"
          block
          onClick={submit}
          disabled={!desc || !msg}
        >
          Add rule
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
