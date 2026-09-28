/**
 * Phase 32 C1.2 — the skills picker's logic, pure: what a skill's use and
 * location read as, which of the project's skills match what is typed, and
 * the skill each choice adds or becomes.
 *
 * A skill added from the project's list is recommended and points at its
 * SKILL.md; one typed by name is recommended with no location (the brief
 * finds a project skill of that name if there is one). "Required" still
 * gates the claim, as it always has.
 */

import type { ProjectSkill, Skill, SkillLocation } from '@shared/types';

export type SkillUse = 'recommended' | 'required' | 'listed';
export type WhereKind = SkillLocation['kind'] | 'none';

export const USE_LABEL: Record<SkillUse, string> = {
  recommended: 'Recommended',
  required: 'Required (gates the claim)',
  listed: 'Listed only',
};

export const WHERE_LABEL: Record<WhereKind, string> = {
  none: 'No location',
  repo: 'In this repo',
  plugin: 'Plugin',
  mcp: 'MCP server',
  playbook: 'Playbook',
  link: 'Link (people only)',
};

export function skillUse(s: Pick<Skill, 'required' | 'use'>): SkillUse {
  return s.required ? 'required' : s.use === 'recommended' ? 'recommended' : 'listed';
}

/** The skill with a different use. Required keeps gating claims; the others never do. */
export function withUse(s: Skill, use: SkillUse): Skill {
  const { use: _old, ...rest } = s;
  if (use === 'required') return { ...rest, required: true };
  if (use === 'recommended') return { ...rest, required: false, use: 'recommended' };
  return { ...rest, required: false };
}

/** The skill with a new reason; blank removes it. */
export function withWhy(s: Skill, why: string): Skill {
  const { why: _old, ...rest } = s;
  const t = why.replace(/\s+/g, ' ').trim();
  return t ? { ...rest, why: t } : rest;
}

export function whereValue(w: SkillLocation | undefined): string {
  if (!w) return '';
  switch (w.kind) {
    case 'repo': return w.path;
    case 'plugin': return w.name;
    case 'mcp': return w.server;
    case 'playbook': return w.uid;
    case 'link': return w.url;
  }
}

/** The skill with a new location; `none` or a blank value removes it. The server checks the value. */
export function withWhere(s: Skill, kind: WhereKind, value: string): Skill {
  const { where: _old, ...rest } = s;
  const v = value.trim();
  if (kind === 'none' || !v) return rest;
  const where: SkillLocation =
    kind === 'repo' ? { kind, path: v }
      : kind === 'plugin' ? { kind, name: v }
        : kind === 'mcp' ? { kind, server: v }
          : kind === 'playbook' ? { kind, uid: v }
            : { kind, url: v };
  return { ...rest, where };
}

/** One line for where a skill lives, and whether agents are told it. */
export function whereText(w: SkillLocation | undefined): { text: string; peopleOnly: boolean } | null {
  if (!w) return null;
  switch (w.kind) {
    case 'repo': return { text: w.path.replace(/\/SKILL\.md$/, ''), peopleOnly: false };
    case 'plugin': return { text: `plugin ${w.name}`, peopleOnly: false };
    case 'mcp': return { text: `MCP ${w.server}`, peopleOnly: false };
    case 'playbook': return { text: `playbook ${w.uid}`, peopleOnly: false };
    case 'link': return { text: w.url, peopleOnly: true };
  }
}

/** The project's skills that match what is typed and are not on the item yet, at most 8. */
export function matchProjectSkills(index: readonly ProjectSkill[], query: string, taken: readonly string[]): ProjectSkill[] {
  const q = query.trim().toLowerCase();
  const have = new Set(taken);
  return index
    .filter((p) => !have.has(p.name))
    .filter((p) => !q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q))
    .slice(0, 8);
}

export function fromProjectSkill(p: ProjectSkill): Skill {
  return { name: p.name, source: 'skill', required: false, use: 'recommended', where: { kind: 'repo', path: p.path } };
}

export function fromName(name: string): Skill {
  return { name: name.trim(), source: 'skill', required: false, use: 'recommended' };
}
