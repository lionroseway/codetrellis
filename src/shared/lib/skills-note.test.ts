/**
 * The skills line an agent reads (Phase 32 C1), shared by the MCP tools and
 * the hand-off prompt: the same words either way, and never a link.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentSkillsOf, skillsNote } from './skills-note';
import type { Skill } from '../types';

const skills: Skill[] = [
  { name: 'pr-review', source: 'skill', required: false, use: 'recommended', why: 'because this task ends in a PR.', where: { kind: 'repo', path: '.claude/skills/pr-review/SKILL.md' } },
  { name: 'typescript', source: 'lang', required: true },
  { name: 'house-style', source: 'skill', required: false, use: 'recommended', where: { kind: 'link', url: 'https://wiki.example.com/style' } },
  { name: 'toolkit', source: 'plugin', required: false, use: 'recommended', where: { kind: 'plugin', name: 'pr-toolkit' } },
  { name: 'listed-only', source: 'skill', required: false },
];

test('what an agent is told without file checks: required and recommended only, never a link', () => {
  const told = agentSkillsOf(skills);
  assert.deepEqual(told.map((s) => [s.name, s.use, s.where?.kind ?? null]), [
    ['pr-review', 'recommended', 'repo'], ['typescript', 'required', null], ['house-style', 'recommended', null], ['toolkit', 'recommended', 'plugin'],
  ]);
  assert.ok(!JSON.stringify(told).includes('wiki.example.com'));
});

test('one line, with where and why, a leading "because" and trailing stop not doubled', () => {
  assert.equal(
    skillsNote(agentSkillsOf(skills)),
    'Skills for this task: use **pr-review** (`.claude/skills/pr-review/SKILL.md`), because this task ends in a PR; required: **typescript**; ' +
      'use **house-style**; use **toolkit** (the pr-toolkit plugin).',
  );
  assert.equal(skillsNote([]), null);
});
