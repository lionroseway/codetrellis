/**
 * Every demo scene is catalogued, and the catalogue names nothing that is not
 * a scene.
 *
 * `npm run demo` is how a release is checked by eye (docs/releases/RUNBOOK.md),
 * and `docs/DEMO-JOURNEYS.md` is how a person knows what to watch for in each
 * scene. The scenes live in modules under `scripts/demo/groups/`, so a scene
 * added without its row, or a row left behind by a removed scene, is easy to
 * miss. Each group has a `## …` section whose heading names its id in
 * backticks, and in it a table with one row per scene, the id first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { GROUPS, DEFAULT_GROUP } from '../../scripts/demo/registry';

const DOC = fs.readFileSync(path.join(__dirname, '../../docs/DEMO-JOURNEYS.md'), 'utf8');
const ID = /^[a-z][a-z0-9-]*$/;

/** The `## …` section whose heading names `id` in backticks, up to the next `## `. */
function section(id: string): string | null {
  const lines = DOC.split('\n');
  const start = lines.findIndex((l) => l.startsWith('## ') && l.includes(`\`${id}\``));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

/** Scene ids a section's tables list: a row whose first cell is a backticked id. */
function rows(text: string): string[] {
  return [...text.matchAll(/^\| `([a-z][a-z0-9-]*)` \|/gm)].map((m) => m[1]);
}

test('scene and group ids are unique, well formed, and the default group exists', () => {
  const groups = GROUPS.map((g) => g.id);
  const scenes = GROUPS.flatMap((g) => g.scenes.map((s) => s.id));
  for (const id of [...groups, ...scenes]) assert.match(id, ID, `"${id}" is not a kebab-case id`);
  assert.equal(new Set(groups).size, groups.length, 'two groups share an id');
  assert.equal(new Set(scenes).size, scenes.length, `two scenes share an id: ${scenes.filter((s, i) => scenes.indexOf(s) !== i).join(', ')}`);
  assert.deepEqual(groups.filter((g) => scenes.includes(g)), [], 'a group and a scene share an id, so --group and --scene would be ambiguous');
  assert.ok(groups.includes(DEFAULT_GROUP), `the default group "${DEFAULT_GROUP}" is not registered`);
  for (const g of GROUPS) {
    assert.ok(g.scenes.length > 0, `group "${g.id}" has no scenes`);
    for (const s of g.scenes) assert.ok(s.watch.trim(), `scene "${s.id}" says nothing to watch for`);
  }
});

test('docs/DEMO-JOURNEYS.md catalogues every group and exactly its scenes', () => {
  for (const g of GROUPS) {
    const text = section(g.id);
    assert.ok(text, `no "## …" section in DEMO-JOURNEYS.md names the group \`${g.id}\``);
    assert.deepEqual(
      [...new Set(rows(text))].sort(),
      g.scenes.map((s) => s.id).sort(),
      `group \`${g.id}\`: the catalogue's rows and the scenes differ`,
    );
  }
});
