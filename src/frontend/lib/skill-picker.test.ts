/**
 * The skills picker's logic (Phase 32 C1.2): uses, locations, and which of
 * the project's skills match what is typed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  skillUse, withUse, withWhy, withWhere, whereText, whereValue, matchProjectSkills, fromProjectSkill, fromName,
} from './skill-picker';
import type { ProjectSkill, Skill } from '@shared/types';

const base: Skill = { name: 'pr-review', source: 'skill', required: false, use: 'recommended', why: 'ends in a PR', where: { kind: 'repo', path: '.claude/skills/pr-review/SKILL.md' } };

test('a use is required, recommended or only listed; changing it keeps why and where', () => {
  assert.equal(skillUse(base), 'recommended');
  assert.equal(skillUse({ required: true }), 'required');
  assert.equal(skillUse({ required: false }), 'listed');
  assert.deepEqual(withUse(base, 'required'), { name: 'pr-review', source: 'skill', required: true, why: 'ends in a PR', where: base.where });
  assert.deepEqual(withUse(withUse(base, 'required'), 'recommended'), base);
  assert.equal(withUse(base, 'listed').use, undefined);
  assert.equal(withUse(base, 'listed').required, false);
});

test('why is one line; blank removes it', () => {
  assert.equal(withWhy(base, '  this task\n ends  in a PR ').why, 'this task ends in a PR');
  assert.equal('why' in withWhy(base, '   '), false);
});

test('where: each kind takes its own field, none or blank removes it, and it reads back', () => {
  assert.deepEqual(withWhere(base, 'plugin', 'pr-toolkit').where, { kind: 'plugin', name: 'pr-toolkit' });
  assert.deepEqual(withWhere(base, 'mcp', 'github').where, { kind: 'mcp', server: 'github' });
  assert.deepEqual(withWhere(base, 'playbook', 'pb1').where, { kind: 'playbook', uid: 'pb1' });
  assert.deepEqual(withWhere(base, 'link', ' https://wiki.example.com ').where, { kind: 'link', url: 'https://wiki.example.com' });
  assert.equal('where' in withWhere(base, 'none', 'x'), false);
  assert.equal('where' in withWhere(base, 'repo', '  '), false);
  assert.equal(whereValue(base.where), '.claude/skills/pr-review/SKILL.md');
  assert.equal(whereValue(undefined), '');
});

test('where reads as one line; a link says it is for people only', () => {
  assert.deepEqual(whereText(base.where), { text: '.claude/skills/pr-review', peopleOnly: false });
  assert.deepEqual(whereText({ kind: 'link', url: 'https://wiki.example.com' }), { text: 'https://wiki.example.com', peopleOnly: true });
  assert.deepEqual(whereText({ kind: 'mcp', server: 'github' }), { text: 'MCP github', peopleOnly: false });
  assert.equal(whereText(undefined), null);
});

test('the project\'s skills match by name or description, skip those already on the task, at most 8', () => {
  const index: ProjectSkill[] = [
    { name: 'pr-review', description: 'Review a pull request', path: '.claude/skills/pr-review/SKILL.md' },
    { name: 'release-notes', description: 'Write release notes for a version', path: '.claude/skills/release-notes/SKILL.md' },
    { name: 'migrations', description: 'How we write DB migrations', path: '.claude/skills/migrations/SKILL.md' },
  ];
  assert.deepEqual(matchProjectSkills(index, 'release', []).map((p) => p.name), ['release-notes']);
  assert.deepEqual(matchProjectSkills(index, 'DB', []).map((p) => p.name), ['migrations']);
  assert.deepEqual(matchProjectSkills(index, '', ['pr-review']).map((p) => p.name), ['release-notes', 'migrations']);
  const many = Array.from({ length: 12 }, (_, i) => ({ name: `s${i}`, description: '', path: `.claude/skills/s${i}/SKILL.md` }));
  assert.equal(matchProjectSkills(many, '', []).length, 8);
});

test('picked from the project: recommended, pointing at its SKILL.md; typed by name: recommended, no location', () => {
  assert.deepEqual(fromProjectSkill({ name: 'migrations', description: 'x', path: '.claude/skills/migrations/SKILL.md' }), {
    name: 'migrations', source: 'skill', required: false, use: 'recommended', where: { kind: 'repo', path: '.claude/skills/migrations/SKILL.md' },
  });
  assert.deepEqual(fromName('  typescript '), { name: 'typescript', source: 'skill', required: false, use: 'recommended' });
});
