/**
 * Phase 32 status: intent written in `docs/PHASE-32-STATUS.yaml`, state read
 * from git. The LOG's block is a snapshot of both, so this checks the part
 * that cannot go stale by itself (the items, in the YAML's order), and the
 * pure pieces that read git's words: merge subjects, branch names, and how
 * a written status gives way to git's.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyToLog, blockOf, intentLines, loadStatus, problems, renderLog, resolve, type Status } from './status';
import { idForBranch, parseMergeSubject, type Facts } from './git-facts';

const docs = path.resolve(__dirname, '..', '..', 'docs');

test('docs/PHASE-32-LOG.md lists the items docs/PHASE-32-STATUS.yaml does, in its order', () => {
  const status = loadStatus(fs.readFileSync(path.join(docs, 'PHASE-32-STATUS.yaml'), 'utf8'));
  const block = blockOf(fs.readFileSync(path.join(docs, 'PHASE-32-LOG.md'), 'utf8'));
  assert.ok(block, 'docs/PHASE-32-LOG.md has no status block');
  assert.deepEqual(intentLines(block), intentLines(renderLog(status, null)), 'the LOG\'s checklist differs from the YAML — run `npm run status` and commit it');
  assert.match(block, /Read from git at `origin\/feat\/phase-32` `[0-9a-f]{7}`/, 'the block says which commit its states were read at');
});

const ids = ['A4', 'A4.1', 'A5', 'A5.1', 'B6.4', 'B6.4b', 'B7', 'B7.4', 'B7.5', '0.4c-1', 'HD1'];

test('a merge subject names its steps and PR, in both forms the history uses', () => {
  const known = new Set(ids);
  assert.deepEqual(parseMergeSubject('Phase 32 B7.4: the decision on a spec change is a person\'s (#245)', known), { ids: ['B7.4'], pr: 245 });
  assert.deepEqual(parseMergeSubject('Phase 32 A5 refined, and A5.1: branch reviews get their dependencies back (#222)', known), { ids: ['A5', 'A5.1'], pr: 222 });
  assert.deepEqual(parseMergeSubject('feat(phase-32): A4.1 — every agent knows its workstream (#146)', known), { ids: ['A4.1'], pr: 146 });
  assert.deepEqual(parseMergeSubject('Phase 32 HD1: a project\'s diff is its own (#207)', known), { ids: ['HD1'], pr: 207 });
  // A merge that names no step, or a step not in the file, says nothing.
  assert.equal(parseMergeSubject('Phase 32: our own late export no longer undoes an agent\'s claim (#244)', known), null);
  assert.equal(parseMergeSubject('Phase 32 B9.9: not a step here (#999)', known), null);
  assert.equal(parseMergeSubject('Graph: refit the view when the layout changes (#175)', known), null);
});

test('a branch belongs to the longest step id that starts its name', () => {
  assert.equal(idForBranch('origin/feat/phase-32-b6-4b-timeline-follows', ids), 'B6.4b');
  assert.equal(idForBranch('feat/phase-32-b6-4-stack-tab', ids), 'B6.4');
  assert.equal(idForBranch('feat/phase-32-0-4c-1-plans', ids), '0.4c-1');
  assert.equal(idForBranch('feat/phase-32-fix-self-write-reimport', ids), null);
  assert.equal(idForBranch('main', ids), null);
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

  const md = renderLog(status(), facts());
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
  assert.throws(() => applyToLog('# Log\n\nno block here\n', status(), null), /no status block/);
});
