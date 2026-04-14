'use client';

import { useState, useRef, useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';
import { SkillPicker } from './SkillPicker';

// Skill color mapping
const SKILL_COLORS: Record<string, string> = {
  'senior-software-architect': '#8b5cf6',
  'senior-qa-engineer': '#06b6d4',
  'senior-backend-developer': '#d97757',
  'senior-frontend-developer': '#f472b6',
  'senior-ml-ai-engineer': '#a78bfa',
  'senior-devops-engineer': '#22c55e',
  'senior-security-engineer': '#ef4444',
  'senior-dba': '#eab308',
  'principal-consultant': '#3b82f6',
};

interface Props {
  activeSkill: string | null;
  onSkillChange: (slug: string | null) => void;
}

export function SkillOrb({ activeSkill, onSkillChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const color = activeSkill ? SKILL_COLORS[activeSkill] ?? '#6b7280' : '#6b7280';
  const label = activeSkill
    ? activeSkill.replace('senior-', '').replace('principal-', '').replace(/-/g, ' ')
    : 'No skill';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-full border transition-all duration-200',
          activeSkill
            ? 'border-white/10 hover:scale-110'
            : 'border-border hover:border-white/10 hover:scale-105',
        )}
        style={{
          backgroundColor: activeSkill ? `${color}20` : 'transparent',
          boxShadow: activeSkill ? `0 0 12px ${color}40` : 'none',
        }}
        title={activeSkill ? `Skill: ${label}` : 'Select a skill'}
        aria-label="Select skill"
      >
        <Sparkles
          size={13}
          style={{ color: activeSkill ? color : '#6b7280' }}
          className={cn(activeSkill && 'animate-pulseDot')}
        />
      </button>

      {open && (
        <SkillPicker
          activeSkill={activeSkill}
          onSelect={(slug) => {
            onSkillChange(slug);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
