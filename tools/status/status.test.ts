/**
 * Phase 32 status as data: the LOG's Now and Checklist are what
 * `docs/PHASE-32-STATUS.yaml` says, and the file says nothing contradictory.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyToLog, loadStatus, problems, renderLog, steps, type Status } from './status';

const docs = path.resolve(__dirname, '..', '..', 'docs');

test('docs/PHASE-32-LOG.md shows what docs/PHASE-32-STATUS.yaml says', () => {
  const status = loadStatus(fs.readFileSync(path.join(docs, 'PHASE-32-STATUS.yaml'), 'utf8'));
  const log = fs.readFileSync(path.join(docs, 'PHASE-32-LOG.md'), 'utf8');
  assert.ok(applyToLog(log, status) === log, 'docs/PHASE-32-LOG.md is stale — run `npm run status` and commit it');
});

const base = (): Status => ({
  now: { step: 'B7.5', status: 's', next: 'n', blockers: 'none', branch: 'b', updated: '2026-09-30' },
  sections: [{
    title: 'Track B',
    items: [{
      id: 'B7', title: 'Conferring', status: 'todo', items: [
        { id: 'B7.4', title: 'A person decides', status: 'done', prs: [245] },
        { id: 'B7.5', title: 'Held edits', status: 'in_review', prs: [246] },
      ],
    }],
  }],
});

test('a well-formed status renders one line per item, with its PRs and state', () => {
  const s = base();
  assert.deepEqual(problems(s), []);
  const md = renderLog(s);
  assert.match(md, /^- \[ \] B7 Conferring$/m);
  assert.match(md, /^ {2}- \[x\] B7\.4 A person decides \(#245\)$/m);
  assert.match(md, /^ {2}- \[ \] B7\.5 Held edits \(#246\) — in review$/m);
  assert.deepEqual(steps(s).map((x) => [x.id, x.status, x.parent ?? null]), [['B7', 'todo', null], ['B7.4', 'done', 'B7'], ['B7.5', 'in_review', 'B7']]);
});

test('what cannot be used is named: a status not in the list, an id twice, a review with no PR, a missing Now field', () => {
  const s = base();
  const b7 = s.sections[0].items[0];
  b7.items![0].status = 'merged' as never;
  b7.items![1].prs = undefined;
  b7.items!.push({ id: 'B7.4', title: 'again', status: 'todo' });
  s.now.next = '';
  assert.deepEqual(problems(s), [
    'now.next is missing.',
    'B7.4 (Track B › B7) has status "merged"; it is one of todo, building, in_review, done.',
    'B7.5 is in review with no PR.',
    'B7.4 appears twice.',
  ]);
});

test('a LOG without the markers is refused, not overwritten', () => {
  assert.throws(() => applyToLog('# Log\n\nno block here\n', base()), /no status block/);
});
