import { SKILLS } from './definitions.js';
import type { Skill } from './types.js';

export function getSkill(slug: string): Skill | undefined {
  return SKILLS.find((s) => s.slug === slug);
}

export function listSkills(): Skill[] {
  return SKILLS;
}

export type { Skill } from './types.js';
