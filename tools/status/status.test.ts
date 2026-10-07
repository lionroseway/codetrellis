/**
 * Phase status: intent written in `docs/PHASE-<n>-STATUS.yaml`, state read
 * from git. The LOG's block is a snapshot of both, so this checks the part
 * that cannot go stale by itself (the items, in the YAML's order), for every
 * phase that has a status file, and the pure pieces that read git's words:
 * merge subjects, branch names, and how a written status gives way to git's.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyToLog, blockOf, intentLines, loadStatus, phaseDocs, phaseFrom, problems, renderLog, resolve, type PhaseDocs, type Status } from './status';
import { idForBranch, parseMergeSubject, type Facts } from './git-facts';
import { countLeaves, renderPage } from './page';
import { statusFiles } from './run';

const root = path.resolve(__dirname, '..', '..');
const phases = phaseDocs(statusFiles(root));
const P32: PhaseDocs = { phase: 32, status: 'docs/PHASE-32-STATUS.yaml', log: 'docs/PHASE-32-LOG.md' };

test('the phases are found in both layouts: Phase 32 beside the other docs, Phase 33 in its own folder', () => {
  assert.deepEqual(phases.filter((d) => d.phase >= 32).slice(0, 2), [P32, { phase: 33, status: 'docs/phase-33/STATUS.yaml', log: 'docs/phase-33/LOG.md' }]);
});

for (const docs of phases) {
  test(`${docs.log} lists the items ${docs.status} does, in its order`, () => {
    const status = loadStatus(fs.readFileSync(path.join(root, docs.status), 'utf8'), docs.status);
    const block = blockOf(fs.readFileSync(path.join(root, docs.log), 'utf8'), docs);
    assert.ok(block, `${docs.log} has no status block`);
    assert.deepEqual(intentLines(block), intentLines(renderLog(status, null, docs)), 'the LOG\'s checklist differs from the YAML — run `npm run status` and commit it');
    assert.match(block, new RegExp(`Read from git at \`origin/feat/phase-${docs.phase}\` \`[0-9a-f]{7}\``), 'the block says which commit its states were read at');
  });
}

test('only a phase status file is a phase, in either layout', () => {
  assert.deepEqual(phaseDocs(['docs/phase-34/STATUS.yaml', 'docs/PHASE-9-STATUS.yaml', 'docs/PHASE-32-LOG.md', 'docs/phase-34/LOG.md', 'docs/README.md']), [
    { phase: 9, status: 'docs/PHASE-9-STATUS.yaml', log: 'docs/PHASE-9-LOG.md' },
    { phase: 34, status: 'docs/phase-34/STATUS.yaml', log: 'docs/phase-34/LOG.md' },
  ]);
});

test('the phase is the one asked for, else the newest with a status file', () => {
  assert.equal(phaseFrom(['node', 'run.ts'], [9, 32, 33]), 33);
  assert.equal(phaseFrom(['node', 'run.ts', '--phase', '32'], [9, 32, 33]), 32);
  assert.throws(() => phaseFrom(['node', 'run.ts', '--phase', 'x'], [32, 33]), /phase number/);
  assert.throws(() => phaseFrom(['node', 'run.ts', '--phase', '40'], [32, 33]), /no status file/);
  assert.throws(() => phaseFrom(['node', 'run.ts'], []), /No phase status file/);
});

test('Phase 33 reads its own subjects and branches, and not Phase 32\'s', () => {
  const known = new Set(['S1', 'R2', 'G6', '0.1']);
  assert.deepEqual(parseMergeSubject('Phase 33 S1: one import per plan per burst (#360)', known, 33), { ids: ['S1'], pr: 360 });
  assert.deepEqual(parseMergeSubject('Phase 33 0.1: baseline (#351)', known, 33), { ids: ['0.1'], pr: 351 });
  assert.equal(parseMergeSubject('Phase 32 S1: not this phase (#200)', known, 33), null);
  // Phase 32's D and E tracks were invisible to the old A–C pattern.
  assert.deepEqual(parseMergeSubject('Phase 32 E6: the done-when (#320)', new Set(['E6']), 32), { ids: ['E6'], pr: 320 });
  assert.equal(idForBranch('origin/feat/phase-33-g6-open-restores', [...known], 33), 'G6');
  assert.equal(idForBranch('feat/phase-32-r2-x', [...known], 33), null);
});

const ids = ['A4', 'A4.1', 'A5', 'A5.1', 'B6.4', 'B6.4b', 'B7', 'B7.4', 'B7.5', '0.4c-1', 'HD1'];

test('a merge subject names its steps and PR, in both forms the history uses', () => {
  const known = new Set(ids);
  assert.deepEqual(parseMergeSubject('Phase 32 B7.4: the decision on a spec change is a person\'s (#245)', known, 32), { ids: ['B7.4'], pr: 245 });
  assert.deepEqual(parseMergeSubject('Phase 32 A5 refined, and A5.1: branch reviews get their dependencies back (#222)', known, 32), { ids: ['A5', 'A5.1'], pr: 222 });
  assert.deepEqual(parseMergeSubject('feat(phase-32): A4.1 — every agent knows its workstream (#146)', known, 32), { ids: ['A4.1'], pr: 146 });
  assert.deepEqual(parseMergeSubject('Phase 32 HD1: a project\'s diff is its own (#207)', known, 32), { ids: ['HD1'], pr: 207 });
  // A merge that names no step, or a step not in the file, says nothing.
  assert.equal(parseMergeSubject('Phase 32: our own late export no longer undoes an agent\'s claim (#244)', known, 32), null);
  assert.equal(parseMergeSubject('Phase 32 B9.9: not a step here (#999)', known, 32), null);
  assert.equal(parseMergeSubject('Graph: refit the view when the layout changes (#175)', known, 32), null);
});

test('a branch belongs to the longest step id that starts its name', () => {
  assert.equal(idForBranch('origin/feat/phase-32-b6-4b-timeline-follows', ids, 32), 'B6.4b');
  assert.equal(idForBranch('feat/phase-32-b6-4-stack-tab', ids, 32), 'B6.4');
  assert.equal(idForBranch('feat/phase-32-0-4c-1-plans', ids, 32), '0.4c-1');
  assert.equal(idForBranch('feat/phase-32-fix-self-write-reimport', ids, 32), null);
  assert.equal(idForBranch('main', ids, 32), null);
});

const status = (): Status => ({
  now: { step: 's', status: 's', next: 'n', blockers: 'none', updated: '2026-09-30' },
  sections: [{
    title: 'Track B',
    items: [
      { id: 'B7', title: 'Conferring', items: [
        { id: 'B7.4', title: 'A person decides' },
        { id: 'B7.5', title: 'Held edits' },
        { id: 'B7.6', title: 'The phone' },
      ] },
      { title: 'A follow-up with no branch', status: 'done', prs: [244], followUp: true },
      { id: 'HD1', title: 'Its own diff (#207)' },
    ],
  }],
});

const facts = (): Facts => ({
  base: 'origin/feat/phase-32', baseSha: 'e0a0a49', source: 'github', otherOpen: [{ number: 250, branch: 'feat/phase-32-fix-x' }],
  byId: new Map([
    ['B7.4', { status: 'done', prs: [245], sha: 'e0a0a49' }],
    ['B7.5', { status: 'in_review', prs: [247], branch: 'feat/phase-32-b7-5-held-edits' }],
    ['HD1', { status: 'done', prs: [207], sha: '1111111' }],
  ]),
});

test('git\'s facts win; a part-done parent is building; what git cannot see stays as written', () => {
  const [items] = resolve(status(), facts());
  const [b7, followUp, hd1] = items;
  assert.deepEqual(b7.items.map((x) => [x.id, x.status, x.prs, x.from]), [
    ['B7.4', 'done', [245], 'git'], ['B7.5', 'in_review', [247], 'git'], ['B7.6', 'todo', [], 'none'],
  ]);
  assert.deepEqual([b7.status, b7.from], ['building', 'parts']);
  assert.deepEqual([followUp.status, followUp.prs, followUp.from], ['done', [244], 'written']);
  // A PR the title already names is not repeated.
  assert.deepEqual(hd1.prs, []);

  const md = renderLog(status(), facts(), P32);
  assert.match(md, /\| \*\*In flight\*\* \| B7\.5 in review \(#247\) on `feat\/phase-32-b7-5-held-edits`; #250 in review on `feat\/phase-32-fix-x` \|/);
  assert.match(md, /\| \*\*Last merged\*\* \| B7\.4 \(#245, `e0a0a49`\) \|/);
  assert.match(md, /^- \[ \] B7 Conferring — building$/m);
  assert.match(md, /^ {2}- \[x\] B7\.4 A person decides \(#245\)$/m);
  assert.match(md, /^ {2}- \[ \] B7\.5 Held edits \(#247\) — in review$/m);
  assert.match(md, /^- \[x\] Follow-up: A follow-up with no branch \(#244\)$/m);
});

test('only todo or done can be written; an id twice, a missing Now field and a bad PR are named', () => {
  const s = status();
  const b7 = s.sections[0].items[0];
  b7.items![1].status = 'in_review';
  b7.items!.push({ id: 'B7.4', title: 'again', prs: [0] });
  s.now.next = '';
  assert.deepEqual(problems(s), [
    'now.next is missing.',
    'B7.5 (Track B › B7) is written "in_review"; only todo or done can be written, the rest is read from git.',
    'B7.4 appears twice.',
    'B7.4 has a PR that is not a number.',
  ]);
});

test('a LOG without the markers is refused, not overwritten', () => {
  assert.throws(() => applyToLog('# Log\n\nno block here\n', status(), null, P32), /no status block/);
});

test('the progress page counts the steps that are work, says each state in words, and escapes what it is given', () => {
  const s = status();
  s.sections[0].goal = 'Agents & people <confer>';
  const [items] = resolve(s, facts());
  // B7 has three parts (one done, one in review, one to do); the follow-up and HD1 are done.
  assert.deepEqual(countLeaves(items), { done: 3, in_review: 1, building: 0, todo: 1, total: 5 });
  const html = renderPage(s, facts(), P32, new Date('2026-10-05T09:30:00Z'));
  assert.match(html, /^<title>Phase 32 Progress<\/title>/);
  assert.match(html, /<b>3<\/b> of 5 steps done/);
  assert.match(html, /◐ In review/);
  assert.match(html, /Agents &amp; people &lt;confer&gt;/);
  assert.doesNotMatch(html, /<confer>/);
  assert.match(html, /href="https:\/\/github.com\/lionroseway\/codetrellis\/pull\/247"/);
  assert.match(html, /Generated 2026-10-05 09:30 UTC/);
});

test('the progress page shows the phase\'s screens, each opening full size, and only those taken', async () => {
  const { shotsHtml } = await import('./page');
  const { problems } = await import('./status');
  const shots = [
    { file: 'rules-view.png', step: 'G7', title: 'The Rules view', says: 'Each suite, `whether` it holds.' },
    { file: 'missing.png', title: 'Not taken', says: 'No image.' },
  ];
  const html = shotsHtml(shots, new Set(['rules-view.png']));
  assert.match(html, /<a href="shots\/rules-view.png" target="_blank" rel="noopener"><img src="shots\/rules-view.png" alt="The Rules view" loading="lazy"><\/a>/);
  assert.match(html, /<code>whether<\/code>/);
  assert.doesNotMatch(html, /missing\.png/);
  assert.equal(shotsHtml(shots, new Set()), '');
  const now = { step: 's', status: 's', next: 'n', blockers: 'b', updated: 'u' };
  assert.deepEqual(problems({ now, sections: [], shots: [{ file: '../etc/x.png', title: 't', says: 's' }] }), ['shots[0] needs a file: a screenshot\'s name, like rules-view.png.']);
});

test('the progress page shows the newest log entries, nested lists and all', async () => {
  const { latestEntries, entryHtml } = await import('./page');
  const log = [
    '# Log', '', '## Entries', '',
    '### 2026-10-07 — R10 built', '',
    '- **R10.** The rules:', '  - layers;', '  - native packages, kept to', '    one module each;', '', '  Measured first.', '- A `check` and [the design](BUILDING-BLOCKS.md).', '',
    'A closing <paragraph>.', '',
    '### 2026-10-06 — C5 merged', '', '- Older.', '',
    '### 2026-10-05 — Oldest', '', '- Oldest.', '',
  ].join('\n');
  const latest = latestEntries(log, 2);
  assert.deepEqual(latest.map((e) => e.title), ['2026-10-07 — R10 built', '2026-10-06 — C5 merged']);
  const html = entryHtml(latest[0]);
  assert.equal(html, '<article class="entry"><h3>2026-10-07 — R10 built</h3>'
    + '<ul><li><b>R10.</b> The rules:<ul><li>layers;</li><li>native packages, kept to one module each;</li></ul><p>Measured first.</p></li>'
    + '<li>A <code>check</code> and the design.</li></ul><p>A closing &lt;paragraph&gt;.</p></article>');
  assert.deepEqual(latestEntries('# Log\n\nno entries\n', 2), []);
});
