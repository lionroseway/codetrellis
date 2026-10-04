/**
 * A skill that arrives in a plan file is flagged once and held back until a
 * person accepts it (Phase 32 C1.4): who added it and in which commit from a
 * real git repository, recorded once, accepted once, forgotten when the skill
 * is removed.
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Skill } from '../../shared/types';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-skill-arrival-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });

let db: typeof import('./database');
let svc: typeof import('./skill-arrival-service');

const repo = path.join(tmp, 'repo');
const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], {
  env: { ...process.env, GIT_AUTHOR_NAME: 'Priya', GIT_AUTHOR_EMAIL: 'p@x', GIT_COMMITTER_NAME: 'Priya', GIT_COMMITTER_EMAIL: 'p@x' },
  encoding: 'utf-8',
}).trim();
const file = path.join(repo, 'item.yaml');

const rec = (name: string): Skill => ({ name, source: 'skill', required: false, use: 'recommended' });
const req = (name: string): Skill => ({ name, source: 'lang', required: true });
const listed = (name: string): Skill => ({ name, source: 'skill', required: false });

function item(uid: string, skills: Skill[]) {
  db.getDb().run(
    `INSERT OR REPLACE INTO plan_items (uid, plan_uid, kind, title, author, created_at, updated_at, skills) VALUES (?, 'p1', 'action', ?, 'Sam', 1, 1, ?)`,
    [uid, `Task ${uid}`, JSON.stringify(skills)],
  );
}

before(async () => {
  fs.mkdirSync(repo);
  git('init', '-q');
  fs.writeFileSync(file, 'skills: []\n');
  git('add', '.');
  git('commit', '-qm', 'Add item');
  db = await import('./database');
  await db.initDatabase();
  svc = await import('./skill-arrival-service');
});

beforeEach(() => {
  for (const t of ['skill_arrivals', 'plan_items']) db.getDb().run(`DELETE FROM ${t}`);
  db.getDb().run(`INSERT OR REPLACE INTO plans (uid, title, author, project_path, created_at, updated_at) VALUES ('p1', 'Plan', 'Sam', '/w/app', 1, 1)`);
  git('checkout', '-q', '--', '.');
});

test('who added it: the last commit\'s author and short sha; nobody yet for an uncommitted edit or an untracked file', () => {
  const committed = svc.lastCommitOf(file);
  assert.equal(committed.addedBy, 'Priya');
  assert.match(committed.commit ?? '', /^[0-9a-f]{7,}$/);
  fs.writeFileSync(file, 'skills: [x]\n');
  assert.deepEqual(svc.lastCommitOf(file), { addedBy: null, commit: null });
  const untracked = path.join(repo, 'new.yaml');
  fs.writeFileSync(untracked, 'x');
  assert.deepEqual(svc.lastCommitOf(untracked), { addedBy: null, commit: null });
  fs.rmSync(untracked);
  assert.deepEqual(svc.lastCommitOf(path.join(tmp, 'not-a-repo.yaml')), { addedBy: null, commit: null });
});

test('an arrival is a recommended or required skill the item did not have; listed-only and existing ones are not', () => {
  const after = [rec('pr-review'), req('typescript'), listed('nice-to-know'), rec('kept')];
  item('t1', after);
  const arrived = svc.noteArrivals({ itemUid: 't1', before: [rec('kept')], after, file, now: 5 });
  assert.deepEqual(arrived.sort(), ['pr-review', 'typescript']);
  const pending = svc.pendingArrivals('t1');
  assert.deepEqual([...pending.keys()].sort(), ['pr-review', 'typescript']);
  assert.equal(pending.get('pr-review')?.addedBy, 'Priya');
  assert.equal(pending.get('pr-review')?.arrivedAt, 5);
});

test('flagged once: importing the same file again records nothing new', () => {
  item('t1', [rec('pr-review')]);
  svc.noteArrivals({ itemUid: 't1', before: [], after: [rec('pr-review')], file });
  assert.deepEqual(svc.noteArrivals({ itemUid: 't1', before: [], after: [rec('pr-review')], file }), []);
  assert.equal(db.getDb().exec('SELECT COUNT(*) FROM skill_arrivals')[0].values[0][0], 1);
});

test('accepted once: then no longer waiting; a second accept, or one for a skill never waiting, says so', () => {
  item('t1', [rec('pr-review')]);
  svc.noteArrivals({ itemUid: 't1', before: [], after: [rec('pr-review')], file });
  assert.equal(svc.acceptArrival({ itemUid: 't1', skill: 'pr-review', by: 'sam', byType: 'human' }), true);
  assert.equal(svc.pendingArrivals('t1').size, 0);
  assert.equal(svc.acceptArrival({ itemUid: 't1', skill: 'pr-review', by: 'sam', byType: 'human' }), false);
  assert.equal(svc.acceptArrival({ itemUid: 't1', skill: 'other', by: 'sam', byType: 'human' }), false);
  const [row] = db.getDb().exec('SELECT accepted_by, accepted_by_type FROM skill_arrivals')[0].values;
  assert.deepEqual(row, ['sam', 'human']);
});

test('the plan\'s list: waiting skills with their task, not ones since removed from it', () => {
  item('t1', [rec('pr-review')]);
  item('t2', [rec('migrations')]);
  svc.noteArrivals({ itemUid: 't1', before: [], after: [rec('pr-review')], file, now: 1 });
  svc.noteArrivals({ itemUid: 't2', before: [], after: [rec('migrations')], file, now: 2 });
  item('t2', []); // removed again before anyone accepted it
  assert.deepEqual(svc.planArrivals('p1').map((a) => [a.itemTitle, a.skill]), [['Task t1', 'pr-review']]);
});

test('seen before it was committed, it learns who added it once committed; one already known is kept', () => {
  item('t1', [rec('pr-review')]);
  fs.writeFileSync(file, 'skills: [pr-review]\n');
  svc.noteArrivals({ itemUid: 't1', before: [], after: [rec('pr-review')], file });
  assert.deepEqual(svc.pendingArrivals('t1').get('pr-review')?.addedBy, null);

  git('commit', '-qam', 'Recommend pr-review');
  const sha = git('rev-parse', '--short', 'HEAD');
  // The next import of the file has nothing new, and fills in who and where.
  assert.deepEqual(svc.noteArrivals({ itemUid: 't1', before: [rec('pr-review')], after: [rec('pr-review')], file }), []);
  assert.deepEqual([svc.pendingArrivals('t1').get('pr-review')?.addedBy, svc.pendingArrivals('t1').get('pr-review')?.commit], ['Priya', sha]);

  // A later commit to the file is an edit, not the arrival.
  fs.writeFileSync(file, 'skills: [pr-review, other]\n');
  git('commit', '-qam', 'Edit');
  svc.noteArrivals({ itemUid: 't1', before: [rec('pr-review')], after: [rec('pr-review')], file });
  assert.equal(svc.pendingArrivals('t1').get('pr-review')?.commit, sha);
  git('reset', '-q', '--hard', 'HEAD~2');
});
