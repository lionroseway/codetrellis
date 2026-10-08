/**
 * Phase 33 B7 — the docs' worked examples are read out as the page marks
 * them, and a page that marks one badly fails here, by its line, before the
 * harness ever runs it (tests/e2e/rules-docs.test.ts runs them).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { docExamples } from './examples';

const root = path.resolve(__dirname, '..', '..');
const fence = '```';

test('an example is its files on main and on the change, the agent\'s report, and each command with what it prints', () => {
  const page = [
    'Some words.',
    `${fence}yaml example=one file=.codetrellis/rules/a.yaml at=main`, 'suite: a', fence,
    `${fence}ts`, 'not an example', fence,
    `${fence}ts example=one file=src/a.ts at=change`, 'export const a = 1;', fence,
    `${fence}json example=one agent=report`, '{ "findings": [] }', fence,
    `${fence}sh example=one exit=3`, 'codetrellis check --base main', fence,
    `${fence}text example=one`, 'Does not conform', '', '  indented', '', fence,
    `${fence}sh example=one`, 'codetrellis stop', fence,
    `${fence}text example=one`, 'Stopped.', fence,
  ].join('\n');
  const [ex, ...rest] = docExamples(page, 'p.md');
  assert.equal(rest.length, 0);
  assert.equal(ex.id, 'one');
  assert.equal(ex.line, 2);
  assert.deepEqual(ex.files, [{ path: '.codetrellis/rules/a.yaml', at: 'main', text: 'suite: a\n' }, { path: 'src/a.ts', at: 'change', text: 'export const a = 1;\n' }]);
  assert.deepEqual(ex.report, { findings: [] });
  assert.deepEqual(ex.steps.map((s) => [s.commands, s.exit, s.output]), [
    ['codetrellis check --base main\n', 3, 'Does not conform\n\n  indented'],
    ['codetrellis stop\n', 0, 'Stopped.'],
  ]);
});

test('a badly marked example is refused, naming its line', () => {
  const bad = (blocks: string[]) => () => docExamples(blocks.join('\n'), 'p.md');
  assert.throws(bad([`${fence}ts example=x file=a.ts`, 'a', fence]), /p\.md:1: file=a\.ts needs at=main or at=change/);
  assert.throws(bad([`${fence}ts example=x file=../a.ts at=main`, 'a', fence]), /must stay inside the repository/);
  assert.throws(bad([`${fence}ts example=x file=/etc/a at=main`, 'a', fence]), /must stay inside the repository/);
  assert.throws(bad([`${fence}text example=x`, 'a', fence]), /p\.md:1: a text block in example x with no sh block before it/);
  assert.throws(bad([`${fence}ts example=x file=a.ts at=change`, 'a', fence, `${fence}sh example=x`, 'ls', fence]), /p\.md:4: example x runs a command whose output the page does not show/);
  assert.throws(bad([`${fence}ts example=x file=a.ts at=main`, 'a', fence, `${fence}sh example=x`, 'ls', fence, `${fence}text example=x`, fence]), /example x changes nothing/);
  assert.throws(bad([`${fence}ts example=x file=a.ts at=change`, 'a', fence]), /example x runs nothing/);
  assert.throws(bad([`${fence}python example=x`, 'a', fence]), /a python block in example x that is neither a file/);
  assert.throws(bad([`${fence}json example=x agent=report`, '{', fence]), /the agent report is not JSON/);
  assert.throws(bad([`${fence}sh example=Bad`, 'ls', fence]), /example=Bad is not a name/);
  assert.throws(bad([`${fence}sh example=x`, 'ls']), /p\.md:1: a fence that never closes/);
});

test('docs/claude/rules.md has an example for each building block, and its table links each', () => {
  const page = fs.readFileSync(path.join(root, 'docs', 'claude', 'rules.md'), 'utf8');
  const examples = docExamples(page, 'docs/claude/rules.md');
  assert.deepEqual(examples.map((e) => e.id), ['api-calls', 'exec-env', 'text', 'look-alikes', 'agent-rule', 'pipeline']);
  for (const block of ['B1', 'B2', 'B3', 'B4', 'B5', 'B6']) assert.match(page, new RegExp(`\\| [^|]+ \\(${block}\\) \\|[^|]+\\| \\[[^\\]]+\\]\\(#[a-z-]+\\) \\|`), `the Building blocks table has no example for ${block}`);
  // Each anchor the table links is a heading on the page.
  const headings = new Set([...page.matchAll(/^#{2,4} (.+)$/gm)].map((m) => m[1].toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-')));
  for (const [, anchor] of page.matchAll(/\]\(#([a-z-]+)\)/g)) assert.ok(headings.has(anchor), `#${anchor} is no heading on the page`);
});
