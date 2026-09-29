/**
 * The state at a moment (Phase 32 B5.2): each task's status then, what was
 * waiting on the person then, the signals open then, and the frame.
 */

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-replay-state-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });

let db: typeof import('./database');
let replay: typeof import('./replay-state');
let frames: typeof import('./replay-frames');

const PROJECT = path.join(tmp, 'app');
const OTHER = path.join(tmp, 'other');
const run = (sql: string, params: unknown[] = []) => db.getDb().run(sql, params);

function plan(uid: string, project = PROJECT) {
  run(`INSERT INTO plans (uid, title, status, author, project_path, created_at, updated_at) VALUES (?, ?, 'active', 'sam', ?, 1, 1)`, [uid, `Plan ${uid}`, project]);
}
function action(uid: string, planUid: string, status: string, createdAt: number) {
  run(`INSERT INTO plan_items (uid, plan_uid, kind, title, status, author, created_at, updated_at) VALUES (?, ?, 'action', ?, ?, 'sam', ?, ?)`,
    [uid, planUid, `Task ${uid}`, status, createdAt, createdAt]);
}
function statusChange(planUid: string, itemUid: string, from: string, to: string, at: number) {
  run(`INSERT INTO plan_events (plan_uid, item_uid, event_type, before_state, after_state, summary, author, author_type, created_at)
       VALUES (?, ?, 'status_changed', ?, ?, 's', 'a', 'human', ?)`,
    [planUid, itemUid, JSON.stringify({ status: from }), JSON.stringify({ status: to }), at]);
}

before(async () => {
  db = await import('./database');
  await db.initDatabase();
  replay = await import('./replay-state');
  frames = await import('./replay-frames');
  frames.startReplayFrames();
});

beforeEach(() => {
  for (const t of ['plan_events', 'plan_items', 'breakpoint_hits', 'breakpoints', 'plans', 'awareness_signal_spans', 'awareness_signals', 'trellis_snapshots', 'files']) {
    run(`DELETE FROM ${t}`);
  }
});

describe('each task\'s status then', () => {
  test('from its status changes: before the first, between, after the last; one made later is left out', () => {
    plan('p1');
    action('refunds', 'p1', 'done', 100);
    statusChange('p1', 'refunds', 'pending', 'in_progress', 200);
    statusChange('p1', 'refunds', 'in_progress', 'done', 300);
    action('never', 'p1', 'pending', 100);
    action('later', 'p1', 'pending', 400);

    const at = (t: number) => Object.fromEntries(replay.stateAt(PROJECT, t, true).tasks.map((x) => [x.uid, x.status]));
    assert.deepEqual(at(150), { refunds: 'pending', never: 'pending' });
    assert.deepEqual(at(250), { refunds: 'in_progress', never: 'pending' });
    assert.deepEqual(at(350), { refunds: 'done', never: 'pending' });
    assert.deepEqual(at(450), { refunds: 'done', never: 'pending', later: 'pending' });

    const then = replay.stateAt(PROJECT, 250, true).tasks.find((x) => x.uid === 'refunds')!;
    assert.equal(then.statusNow, 'done', 'says what it is now when that differs');
    assert.equal(then.planTitle, 'Plan p1');
  });

  test('another project\'s tasks are not this one\'s', () => {
    plan('p2', OTHER);
    action('elsewhere', 'p2', 'pending', 100);
    assert.deepEqual(replay.stateAt(PROJECT, 200, true).tasks, []);
  });
});

describe('what was waiting on the person then', () => {
  test('a hit made by then and not answered by then; its answer later is said', () => {
    plan('p1');
    run(`INSERT INTO breakpoints (id, kind, target, plan_uid, project_root, created_at, created_by, created_by_type) VALUES ('bp1', 'task', 'refunds', 'p1', ?, 1, 'sam', 'human')`, [PROJECT]);
    run(`INSERT INTO breakpoint_hits (ref, breakpoint_id, tool, action, item_uid, plan_uid, agent, hit_at, answered_at)
         VALUES ('bp-a', 'bp1', 'claim_item', 'claim', 'refunds', 'p1', 'codex', 200, 300)`);
    const refs = (t: number) => replay.stateAt(PROJECT, t, true).waiting.map((w) => w.ref);
    assert.deepEqual(refs(150), []);
    assert.deepEqual(refs(250), ['bp-a']);
    assert.deepEqual(refs(350), []);
    assert.equal(replay.stateAt(PROJECT, 250, true).waiting[0].answeredAt, 300);
    assert.equal(replay.stateAt(PROJECT, 250, true).waiting[0].agent, 'codex');
  });
});

describe('the signals open then', () => {
  test('each opening of a signal counts: open, closed, open again', () => {
    for (const [opened, closed] of [[100, 200], [300, null]] as const) {
      run(`INSERT INTO awareness_signal_spans (signal_id, project_root, kind, severity, summary, workstreams, opened_at, closed_at)
           VALUES ('collision:x', ?, 'collision', 'high', 'Both change x', '["/w/a","/w/b"]', ?, ?)`, [PROJECT, opened, closed]);
    }
    const ids = (t: number) => replay.stateAt(PROJECT, t, true).signals.map((s) => `${s.id}@${s.openedAt}`);
    assert.deepEqual(ids(150), ['collision:x@100']);
    assert.deepEqual(ids(250), []);
    assert.deepEqual(ids(350), ['collision:x@300']);
    assert.deepEqual(replay.stateAt(PROJECT, 150, true).signals[0].workstreams, ['/w/a', '/w/b']);
  });

  test('a signal open since before spans were kept: its row\'s first sighting and resolution', () => {
    run(`INSERT INTO awareness_signals (id, kind, severity, subject, workstreams, summary, first_seen, last_seen, state, project_root, resolved_at)
         VALUES ('stale:y', 'stale-base', 'medium', '{}', '[]', 'Behind main', 100, 150, 'resolved', ?, 200)`, [PROJECT]);
    assert.deepEqual(replay.stateAt(PROJECT, 150, true).signals.map((s) => s.id), ['stale:y']);
    assert.deepEqual(replay.stateAt(PROJECT, 250, true).signals, []);
  });
});

describe('the frame then', () => {
  test('the frame at or before the moment, and how the graph differs from it now only when this project is held', async () => {
    frames.setHeldProject(() => ({ path: PROJECT, scanning: null }));
    run(`INSERT INTO files (path, relative_path, language, content_hash, last_parsed) VALUES (?, 'a.ts', 'typescript', 'h1', 1)`, [path.join(PROJECT, 'a.ts')]);
    const first = frames.takeFrame({ projectPath: PROJECT, reason: 'turn-end' });
    assert.ok(typeof first === 'object');
    run(`INSERT INTO files (path, relative_path, language, content_hash, last_parsed) VALUES (?, 'b.ts', 'typescript', 'h2', 1)`, [path.join(PROJECT, 'b.ts')]);

    assert.equal(replay.stateAt(PROJECT, first.at - 1, true).frame, null);
    const then = replay.stateAt(PROJECT, first.at, true);
    assert.equal(then.frame?.id, first.id);
    assert.deepEqual(then.sinceFrame?.addedFiles, ['b.ts']);
    assert.equal(replay.stateAt(PROJECT, first.at, false).sinceFrame, null, 'no difference against another project\'s files');
  });
});
