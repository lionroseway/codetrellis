/**
 * The project's skills index and what an agent is told (Phase 32 C1), on a
 * real folder: front-matter read, links refused at every level, a `link`
 * never handed to an agent, and a skill missing from the agent's checkout
 * said to be missing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { frontMatter, listProjectSkills, agentSkills, skillsNote } from './skills-service';
import type { Skill } from '../../shared/types';

function project(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-skills-'));
  const skill = (dir: string, text: string) => {
    fs.mkdirSync(path.join(root, '.claude/skills', dir), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude/skills', dir, 'SKILL.md'), text);
  };
  skill('pr-review', '---\nname: pr-review\ndescription: Review a pull request\n  before merge.\n---\n\nSteps…');
  skill('migrations', '---\ndescription: How we write DB migrations\n---\n');
  skill('broken', '---\nname: [unclosed\n---\n');
  fs.mkdirSync(path.join(root, '.claude/skills/empty'));
  return root;
}

test('front-matter: read when present, {} when absent or malformed', () => {
  assert.deepEqual(frontMatter('---\nname: a\ndescription: b\n---\nbody'), { name: 'a', description: 'b' });
  assert.deepEqual(frontMatter('no front matter'), {});
  assert.deepEqual(frontMatter('---\nname: [x\n---\n'), {});
  assert.deepEqual(frontMatter('---\n- a list\n---\n'), {});
});

test('the index: name and one-line description from each SKILL.md, the folder name when unnamed, by name', () => {
  const root = project();
  assert.deepEqual(listProjectSkills(root), [
    { name: 'broken', description: '', path: '.claude/skills/broken/SKILL.md' },
    { name: 'migrations', description: 'How we write DB migrations', path: '.claude/skills/migrations/SKILL.md' },
    { name: 'pr-review', description: 'Review a pull request before merge.', path: '.claude/skills/pr-review/SKILL.md' },
  ]);
  assert.deepEqual(listProjectSkills(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-noskills-'))), []);
});

test('the index follows no link: a linked skill folder, a linked SKILL.md, or a linked .claude are not read', { skip: process.platform === 'win32' }, () => {
  const root = project();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-outside-'));
  fs.mkdirSync(path.join(outside, 'evil'));
  fs.writeFileSync(path.join(outside, 'evil/SKILL.md'), '---\nname: evil\n---\n');
  fs.symlinkSync(path.join(outside, 'evil'), path.join(root, '.claude/skills/evil'));
  fs.mkdirSync(path.join(root, '.claude/skills/sneaky'));
  fs.symlinkSync(path.join(outside, 'evil/SKILL.md'), path.join(root, '.claude/skills/sneaky/SKILL.md'));
  assert.deepEqual(listProjectSkills(root).map((s) => s.name), ['broken', 'migrations', 'pr-review']);

  const linked = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-linked-'));
  fs.symlinkSync(path.join(root, '.claude'), path.join(linked, '.claude'));
  assert.deepEqual(listProjectSkills(linked), []);
});

const skills: Skill[] = [
  { name: 'pr-review', source: 'skill', required: false, use: 'recommended', why: 'this task ends in a PR' },
  { name: 'typescript', source: 'lang', required: true },
  { name: 'house-style', source: 'skill', required: false, use: 'recommended', where: { kind: 'link', url: 'https://wiki.example.com/style' } },
  { name: 'github', source: 'mcp', required: false, use: 'recommended', where: { kind: 'mcp', server: 'github' } },
  { name: 'nice-to-know', source: 'skill', required: false },
];

test('an agent is told the required and recommended skills, a named skill found in the project, and never a link', () => {
  const root = project();
  const told = agentSkills(skills, { projectRoot: root, workstreamRoot: null });
  assert.deepEqual(told, [
    { name: 'pr-review', use: 'recommended', why: 'this task ends in a PR', where: { kind: 'repo', path: '.claude/skills/pr-review/SKILL.md' }, missing: null },
    { name: 'typescript', use: 'required', why: null, where: null, missing: null },
    { name: 'house-style', use: 'recommended', why: null, where: null, missing: null },
    { name: 'github', use: 'recommended', why: null, where: { kind: 'mcp', server: 'github' }, missing: null },
  ]);
  assert.ok(!JSON.stringify(told).includes('wiki.example.com'));
  assert.equal(
    skillsNote(told),
    'Skills for this task: use **pr-review** (`.claude/skills/pr-review/SKILL.md`), because this task ends in a PR; ' +
      'required: **typescript**; use **house-style**; use **github** (the github MCP server\'s tools).',
  );
  assert.equal(skillsNote([]), null);
});

test('a repo skill missing from the project, or from the agent\'s own checkout, is said to be and how to get it', () => {
  const root = project();
  const gone: Skill[] = [{ name: 'gone', source: 'skill', required: false, use: 'recommended', where: { kind: 'repo', path: '.claude/skills/gone' } }];
  assert.deepEqual(agentSkills(gone, { projectRoot: root, workstreamRoot: null }), [
    { name: 'gone', use: 'recommended', why: null, where: null, missing: '.claude/skills/gone/SKILL.md is not in the project' },
  ]);

  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-worktree-'));
  const [told] = agentSkills(skills.slice(0, 1), { projectRoot: root, workstreamRoot: worktree });
  assert.deepEqual(told.where, { kind: 'repo', path: '.claude/skills/pr-review/SKILL.md' });
  assert.match(told.missing ?? '', /not in your workstream .* bring your branch up to date with the main branch/);
  assert.match(skillsNote([told]) ?? '', /\(missing: .*not in your workstream/);
});

test('a repo location that escapes through a link is not handed over', { skip: process.platform === 'win32' }, () => {
  const root = project();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-outside-'));
  fs.writeFileSync(path.join(outside, 'SKILL.md'), 'do bad things');
  fs.symlinkSync(outside, path.join(root, 'docs-link'));
  const [told] = agentSkills([{ name: 'x', source: 'skill', required: false, use: 'recommended', where: { kind: 'repo', path: 'docs-link/SKILL.md' } }], { projectRoot: root, workstreamRoot: null });
  assert.equal(told.where, null);
  assert.match(told.missing ?? '', /not in the project/);
});
