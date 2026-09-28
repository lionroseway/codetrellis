/**
 * A skill on a plan item, checked on the way in (Phase 32 C1). Skills reach
 * agents, and arrive from plan files anyone who can push may write, so what
 * each field may hold is tested here field by field.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseSkills, normaliseSkill, normaliseRepoPath, normaliseLocation, withoutLinks, agentView, MAX_SKILLS } from './skill-model';

test('an old skill, without the new fields, reads exactly as before', () => {
  const old = [{ name: 'typescript', source: 'lang', required: true }, { name: 'pr-review', source: 'skill', required: false }];
  assert.deepEqual(normaliseSkills(old), { skills: old, problems: [] });
  assert.deepEqual(normaliseSkills(undefined), { skills: [], problems: [] });
});

test('recommended, why and where are kept when well formed', () => {
  const { skills, problems } = normaliseSkills([{
    name: 'pr-review', source: 'skill', required: false, use: 'recommended',
    why: '  this task\n ends in a PR ', where: { kind: 'repo', path: '.claude/skills/pr-review' },
  }]);
  assert.deepEqual(problems, []);
  assert.deepEqual(skills, [{
    name: 'pr-review', source: 'skill', required: false, use: 'recommended',
    why: 'this task ends in a PR', where: { kind: 'repo', path: '.claude/skills/pr-review/SKILL.md' },
  }]);
});

test('a repo path stays relative and inside: no .., no absolute path, no drive, no backslash, no home', () => {
  assert.equal(normaliseRepoPath('./.claude/skills/x/'), '.claude/skills/x/SKILL.md');
  assert.equal(normaliseRepoPath('docs/how-we-migrate.md'), 'docs/how-we-migrate.md');
  for (const bad of ['../outside/SKILL.md', '.claude/../../etc/passwd', '/etc/passwd', 'C:/x/SKILL.md', '..\\x', '~/.ssh/SKILL.md', 'a/./b', '', 'a\0b', 7]) {
    assert.equal(normaliseRepoPath(bad), null, String(bad));
  }
});

test('each location kind takes only its own well-formed field; a link is http(s) only', () => {
  assert.deepEqual(normaliseLocation({ kind: 'plugin', name: 'pr-toolkit@acme' }).where, { kind: 'plugin', name: 'pr-toolkit@acme' });
  assert.deepEqual(normaliseLocation({ kind: 'mcp', server: 'github' }).where, { kind: 'mcp', server: 'github' });
  assert.deepEqual(normaliseLocation({ kind: 'playbook', uid: 'pb_123' }).where, { kind: 'playbook', uid: 'pb_123' });
  assert.deepEqual(normaliseLocation({ kind: 'link', url: 'https://wiki.example.com/pr' }).where, { kind: 'link', url: 'https://wiki.example.com/pr' });
  for (const bad of [
    { kind: 'link', url: 'javascript:alert(1)' }, { kind: 'link', url: 'file:///etc/passwd' },
    { kind: 'plugin', name: 'a b; rm -rf' }, { kind: 'mcp' }, { kind: 'playbook', uid: '../x' }, { kind: 'shell', cmd: 'x' },
  ]) {
    const { where, problem } = normaliseLocation(bad);
    assert.equal(where, null, JSON.stringify(bad));
    assert.ok(problem);
  }
});

test('a bad field is dropped and reported; the skill is kept', () => {
  const { skill, problems } = normaliseSkill({ name: 'pr-review', source: 'skill', required: false, use: 'always', where: { kind: 'repo', path: '../x' } });
  assert.deepEqual(skill, { name: 'pr-review', source: 'skill', required: false });
  assert.equal(problems.length, 2);
});

test('an unusable skill is dropped: no name, a name with backticks or too long, an unknown source; a newline is folded', () => {
  const { skills, problems } = normaliseSkills([
    { source: 'skill' }, { name: 'a\nb', source: 'skill' }, { name: 'use `rm`', source: 'skill' },
    { name: 'x'.repeat(81), source: 'skill' }, { name: 'ok', source: 'shell' }, { name: 'kept', source: 'mcp', required: 'yes' },
  ]);
  assert.deepEqual(skills, [{ name: 'a b', source: 'skill', required: false }, { name: 'kept', source: 'mcp', required: false }]);
  assert.equal(problems.length, 4);
});

test('one entry per name, at most MAX_SKILLS, and not a list at all is refused', () => {
  const twice = normaliseSkills([{ name: 'a', source: 'skill', why: 'first' }, { name: 'a', source: 'skill', why: 'second' }]);
  assert.deepEqual(twice.skills.map((s) => s.why), ['first']);
  assert.equal(twice.problems.length, 1);
  const many = normaliseSkills(Array.from({ length: MAX_SKILLS + 5 }, (_, i) => ({ name: `s${i}`, source: 'skill' })));
  assert.equal(many.skills.length, MAX_SKILLS);
  assert.deepEqual(normaliseSkills('pr-review'), { skills: [], problems: ['skills must be a list'] });
});

test('a long reason is cut to one line of at most 200 characters, and said to be', () => {
  const { skill, problems } = normaliseSkill({ name: 'a', source: 'skill', why: 'w'.repeat(250) });
  assert.equal(skill?.why?.length, 200);
  assert.equal(problems.length, 1);
});

test('withoutLinks: a link location is removed wherever a skills list appears; nothing else changes', () => {
  const link = { name: 'house-style', source: 'skill', required: false, use: 'recommended', where: { kind: 'link', url: 'https://wiki.example.com' } };
  const repo = { name: 'pr-review', source: 'skill', required: false, where: { kind: 'repo', path: '.claude/skills/pr-review/SKILL.md' } };
  const item = { uid: 'i1', title: 't', skills: [repo, link] };
  const result = { ok: true, item, children: [item], parent: null };
  const out = withoutLinks(result);
  assert.ok(!JSON.stringify(out).includes('wiki.example.com'));
  assert.deepEqual(out.item.skills, [repo, { name: 'house-style', source: 'skill', required: false, use: 'recommended' }]);
  assert.deepEqual(out.children[0].skills[1], { name: 'house-style', source: 'skill', required: false, use: 'recommended' });
  // Untouched when there is nothing to remove, and the input is never mutated.
  const plain = { uid: 'i2', skills: [repo] };
  assert.equal(withoutLinks(plain), plain);
  assert.equal(link.where.url, 'https://wiki.example.com');
});

test('agentView: every function\'s result without links, sync or async; classes pass through', async () => {
  class Oops extends Error {}
  const item = { uid: 'i', skills: [{ name: 'x', source: 'skill', required: false, where: { kind: 'link', url: 'https://x.example' } }] };
  const view = agentView({ getItem: () => item, later: async () => [item], Oops, LIMIT: 3 });
  assert.ok(!JSON.stringify(view.getItem()).includes('x.example'));
  assert.ok(!JSON.stringify(await view.later()).includes('x.example'));
  assert.equal(view.Oops, Oops);
  assert.ok(new view.Oops() instanceof Error);
  assert.equal(view.LIMIT, 3);
});
