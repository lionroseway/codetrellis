/**
 * Phase 32 C1 — the one line that tells an agent which skills to use for a
 * task. The same words wherever an agent is told: get_brief, claim_item and
 * get_next_item (backend), and a task copied as a prompt from the hand-off
 * menu (frontend, C1.3).
 *
 * A `link` never appears: it is for people. The backend also checks repo
 * skills against the real files and says when one is missing
 * (skills-service.ts); `agentSkillsOf` is the check-free form for the
 * frontend, which cannot read files.
 */

import type { AgentSkill, Skill } from '../types';

function whereText(w: NonNullable<AgentSkill['where']>): string {
  switch (w.kind) {
    case 'repo': return `\`${w.path}\``;
    case 'plugin': return `the ${w.name} plugin`;
    case 'mcp': return `the ${w.server} MCP server's tools`;
    case 'playbook': return `CodeTrellis playbook ${w.uid}`;
  }
}

/**
 * One line for the agent: "Skills for this task: use **pr-review**
 * (`.claude/skills/pr-review/SKILL.md`), because this task ends in a PR."
 */
export function skillsNote(skills: readonly AgentSkill[]): string | null {
  if (skills.length === 0) return null;
  const parts = skills.map((s) => {
    let t = `${s.use === 'required' ? 'required: ' : 'use '}**${s.name}**`;
    if (s.where) t += ` (${whereText(s.where)})`;
    if (s.why) t += `, because ${s.why.replace(/^because\s+/i, '').replace(/\.$/, '')}`;
    if (s.missing) t += ` (missing: ${s.missing})`;
    return t;
  });
  return `Skills for this task: ${parts.join('; ')}.`;
}

/** A task's required and recommended skills as an agent is told them, without file checks and never with a link. */
export function agentSkillsOf(skills: readonly Skill[]): AgentSkill[] {
  return skills
    .filter((s) => s.required || s.use === 'recommended')
    .map((s) => ({
      name: s.name,
      use: s.required ? 'required' : 'recommended',
      why: s.why ?? null,
      where: s.where && s.where.kind !== 'link' ? s.where : null,
      missing: null,
    }));
}
