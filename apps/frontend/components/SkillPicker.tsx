'use client';

import {
  Layers, ShieldCheck, Server, Layout, Cpu,
  Container, Lock, Database, Briefcase,
} from 'lucide-react';
import { cn } from '@/lib/cn';

interface Skill {
  slug: string;
  name: string;
  description: string;
  color: string;
  icon: React.ElementType;
}

const SKILLS: Skill[] = [
  { slug: 'senior-software-architect', name: 'Architect', description: 'System design, patterns, scalability', color: '#8b5cf6', icon: Layers },
  { slug: 'senior-qa-engineer', name: 'QA Engineer', description: 'Testing, coverage, edge cases', color: '#06b6d4', icon: ShieldCheck },
  { slug: 'senior-backend-developer', name: 'Backend Dev', description: 'APIs, databases, performance', color: '#d97757', icon: Server },
  { slug: 'senior-frontend-developer', name: 'Frontend Dev', description: 'UI/UX, accessibility, state', color: '#f472b6', icon: Layout },
  { slug: 'senior-ml-ai-engineer', name: 'ML/AI Engineer', description: 'ML pipelines, training, data', color: '#a78bfa', icon: Cpu },
  { slug: 'senior-devops-engineer', name: 'DevOps', description: 'CI/CD, infra, monitoring', color: '#22c55e', icon: Container },
  { slug: 'senior-security-engineer', name: 'Security', description: 'Threat modeling, auth, OWASP', color: '#ef4444', icon: Lock },
  { slug: 'senior-dba', name: 'DBA', description: 'Schema, queries, optimization', color: '#eab308', icon: Database },
  { slug: 'principal-consultant', name: 'Consultant', description: 'Business analysis, roadmaps', color: '#3b82f6', icon: Briefcase },
];

interface Props {
  activeSkill: string | null;
  onSelect: (slug: string | null) => void;
}

export function SkillPicker({ activeSkill, onSelect }: Props) {
  return (
    <div
      className="absolute bottom-full left-0 mb-2 w-[320px] animate-fadeInUp rounded-xl border border-white/5 p-2"
      style={{
        background: 'rgba(17, 19, 23, 0.88)',
        backdropFilter: 'blur(16px)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), inset 0 0 0 1px rgba(255, 255, 255, 0.04)',
      }}
    >
      <div className="mb-1.5 px-2 text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
        Skill / Persona
      </div>
      <div className="grid grid-cols-3 gap-1">
        {SKILLS.map((skill) => {
          const Icon = skill.icon;
          const isActive = activeSkill === skill.slug;
          return (
            <button
              key={skill.slug}
              onClick={() => onSelect(isActive ? null : skill.slug)}
              className={cn(
                'group relative flex flex-col items-center gap-1 rounded-lg px-2 py-2.5 text-center transition-all duration-150',
                isActive
                  ? 'bg-white/[0.06]'
                  : 'hover:bg-white/[0.04]',
              )}
              style={{
                borderLeft: `2px solid ${skill.color}${isActive ? '' : '40'}`,
                boxShadow: isActive ? `0 0 8px ${skill.color}30` : 'none',
              }}
              title={skill.description}
            >
              <Icon size={16} style={{ color: isActive ? skill.color : '#9aa3af' }} />
              <span
                className={cn(
                  'text-[10px] font-medium leading-tight',
                  isActive ? 'text-fg' : 'text-fg-muted',
                )}
              >
                {skill.name}
              </span>
            </button>
          );
        })}
      </div>
      {activeSkill && (
        <button
          onClick={() => onSelect(null)}
          className="mt-1.5 w-full rounded-md px-2 py-1 text-[10px] text-fg-subtle transition hover:bg-white/[0.04] hover:text-fg-muted"
        >
          Clear skill
        </button>
      )}
    </div>
  );
}
