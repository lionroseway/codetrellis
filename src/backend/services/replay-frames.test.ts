/**
 * Replay frames (Phase 32 B5.1): what a frame keeps, when one is refused,
 * how moments close together become one frame, and how long frames last.
 */

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-replay-frames-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
process.env.CODETRELLIS_FRAME_INTERVAL_MS = '40';
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });

let db: typeof import('./database');
let frames: typeof import('./replay-frames');
let trellis: typeof import('./trellis-service');

const PROJECT = path.join(tmp, 'app');
const OTHER = path.join(tmp, 'other');

function file(rel: string, hash: string) {
  db.getDb().run(
    'INSERT OR REPLACE INTO files (path, relative_path, language, content_hash, last_parsed) VALUES (?, ?, ?, ?, ?)',
    [path.join(PROJECT, rel), rel, 'typescript', hash, Date.now()],
  );
}

const isFrame = (r: unknown): r is import('./replay-frames').ReplayFrame => typeof r === 'object' && r !== null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  db = await import('./database');
  await db.initDatabase();
  frames = await import('./replay-frames');
  trellis = await import('./trellis-service');
  frames.startReplayFrames();
});

beforeEach(() => {
  for (const t of ['trellis_snapshots', 'files']) db.getDb().run(`DELETE FROM ${t}`);
  frames.setHeldProject(() => ({ path: PROJECT, scanning: null }));
});

describe('the digest', () => {
  const graph = (files: Array<[string, string]>, edges: Array<[string, string]>) => ({
    files: files.map(([p, h]) => ({ path: p, contentHash: h, language: 'ts', symbolCount: 0 })),
    edges: edges.map(([s, t]) => ({ source: s, target: t, specifiers: ['x'] })),
  });

  test('the same graph in any order has the same digest', () => {
    const a = graph([['a.ts', '1'], ['b.ts', '2']], [['a.ts', 'b.ts'], ['b.ts', 'c.ts']]);
    const b = graph([['b.ts', '2'], ['a.ts', '1']], [['b.ts', 'c.ts'], ['a.ts', 'b.ts']]);
    assert.equal(frames.graphDigest(a), frames.graphDigest(b));
  });

  test('a changed file or a new edge changes it', () => {
    const base = frames.graphDigest(graph([['a.ts', '1']], []));
    assert.notEqual(frames.graphDigest(graph([['a.ts', '2']], [])), base);
    assert.notEqual(frames.graphDigest(graph([['a.ts', '1']], [['a.ts', 'b.ts']])), base);
  });
});

describe('moments close together', () => {
  test('merge into one: every reason once, the latest session and ref, the commit that landed', () => {
    const m = frames.mergeTriggers([
      { projectPath: PROJECT, reason: 'status', ref: 'item-1', sessionId: 's-1', agentType: 'codex' },
      { projectPath: PROJECT, reason: 'commit', ref: 'abc', commitSha: 'abc', workstreamRoot: '/w/feature' },
      { projectPath: PROJECT, reason: 'status', ref: 'item-2' },
    ]);
    assert.deepEqual(m.reasons, ['status', 'commit']);
    assert.equal(m.ref, 'item-2');
    assert.equal(m.sessionId, 's-1');
    assert.equal(m.agentType, 'codex');
    assert.equal(m.commitSha, 'abc');
    assert.equal(m.workstreamRoot, '/w/feature');
  });

  test('asked for in the same tick, they are one frame', async () => {
    frames.requestFrame({ projectPath: PROJECT, reason: 'status', ref: 'item-1' });
    frames.requestFrame({ projectPath: PROJECT, reason: 'turn-end', sessionId: 's-9' });
    await sleep(120);
    const list = frames.listFrames(PROJECT);
    assert.equal(list.length, 1);
    assert.deepEqual(list[0].reasons, ['status', 'turn-end']);
    assert.equal(list[0].sessionId, 's-9');
  });
});

describe('checkouts and their HEADs', () => {
  test('read from git worktree list: every checkout with a HEAD, a bare repository left out', () => {
    const porcelain = [
      'worktree /w/app', 'HEAD ' + 'a'.repeat(40), 'branch refs/heads/main', '',
      'worktree /w/app-feature', 'HEAD ' + 'b'.repeat(40), 'detached', '',
      'worktree /w/app.git', 'bare', '',
    ].join('\n');
    assert.deepEqual([...frames.parseWorktreeList(porcelain)], [['/w/app', 'a'.repeat(40)], ['/w/app-feature', 'b'.repeat(40)]]);
  });
});

describe('only the held project, never while scanning', () => {
  test('a frame of a project the server does not hold is refused, not taken', () => {
    assert.equal(frames.takeFrame({ projectPath: OTHER, reason: 'status' }), 'other-project');
    assert.equal(frames.listFrames(OTHER).length, 0);
  });

  test('while a scan runs, the frame waits', () => {
    frames.setHeldProject(() => ({ path: PROJECT, scanning: PROJECT }));
    assert.equal(frames.takeFrame({ projectPath: PROJECT, reason: 'status' }), 'scanning');
  });

  test('a trailing slash is the same project', () => {
    assert.equal(frames.frameRefusal(`${PROJECT}/`, { path: PROJECT, scanning: null }), null);
  });
});

describe('what a frame keeps', () => {
  test('the graph, why, and a copy only when the graph changed', () => {
    file('a.ts', 'h1');
    const first = frames.takeFrame({ projectPath: PROJECT, reason: 'turn-end', sessionId: 's-1', agentType: 'codex' });
    const same = frames.takeFrame({ projectPath: PROJECT, reason: 'status', ref: 'item-1' });
    file('b.ts', 'h2');
    const changed = frames.takeFrame({ projectPath: PROJECT, reason: 'commit', commitSha: 'f'.repeat(40) });
    assert.ok(isFrame(first) && isFrame(same) && isFrame(changed));

    assert.equal(first.sameAs, null);
    assert.equal(same.sameAs, first.id, 'an unchanged graph points at the frame with the copy');
    assert.equal(changed.sameAs, null);
    assert.equal(changed.commitSha, 'f'.repeat(40));

    const listed = frames.listFrames(PROJECT);
    assert.deepEqual(listed.map((f) => [f.reasons[0], f.fileCount]), [['turn-end', 1], ['status', 1], ['commit', 2]]);
    assert.equal(listed[0].sessionId, 's-1');
    assert.equal(listed[1].ref, 'item-1');

    // The graph of a frame that points at another is that frame's.
    assert.deepEqual(trellis.getSnapshot(same.id)!.data.files.map((f) => f.path), ['a.ts']);
  });

  test('a pointing frame points at the copy, not at another pointer', () => {
    file('a.ts', 'h1');
    const first = frames.takeFrame({ projectPath: PROJECT, reason: 'turn-end' });
    frames.takeFrame({ projectPath: PROJECT, reason: 'status' });
    const third = frames.takeFrame({ projectPath: PROJECT, reason: 'status' });
    assert.ok(isFrame(first) && isFrame(third));
    assert.equal(third.sameAs, first.id);
  });

  test('frames are not among the checkpoints a person took', () => {
    file('a.ts', 'h1');
    frames.takeFrame({ projectPath: PROJECT, reason: 'turn-end' });
    trellis.captureCurrentTrellis(PROJECT, undefined, 'Before the refactor');
    assert.deepEqual(trellis.listSnapshots().map((s) => s.name), ['Before the refactor']);
  });

  test('from and to bound the list', () => {
    file('a.ts', 'h1');
    const a = frames.takeFrame({ projectPath: PROJECT, reason: 'turn-end' });
    assert.ok(isFrame(a));
    assert.equal(frames.listFrames(PROJECT, { from: a.at + 1 }).length, 0);
    assert.equal(frames.listFrames(PROJECT, { to: a.at }).length, 1);
  });
});

describe('how long frames last', () => {
  test('older than 14 days they go, unless a kept frame points at them', () => {
    file('a.ts', 'h1');
    const old = frames.takeFrame({ projectPath: PROJECT, reason: 'turn-end' });
    const alsoOld = frames.takeFrame({ projectPath: PROJECT, reason: 'status' });
    file('a.ts', 'h2');
    const oldAlone = frames.takeFrame({ projectPath: PROJECT, reason: 'commit' });
    assert.ok(isFrame(old) && isFrame(alsoOld) && isFrame(oldAlone));
    const longAgo = Date.now() - 20 * 24 * 60 * 60 * 1000;
    db.getDb().run('UPDATE trellis_snapshots SET created_at = ?', [longAgo]);
    // A recent frame still shares the first one's graph.
    db.getDb().run(
      `INSERT INTO trellis_snapshots (name, snapshot_type, files_json, edges_json, created_at, project_path, digest, same_as)
       VALUES ('Frame: status', 'frame', '[]', '[]', ?, ?, ?, ?)`,
      [Date.now(), PROJECT, old.digest, old.id],
    );
    assert.equal(frames.pruneFrames(), 2);
    const left = db.getDb().exec('SELECT id FROM trellis_snapshots ORDER BY id')[0].values.map((r) => r[0]);
    assert.ok(left.includes(old.id), 'kept: a recent frame points at it');
    assert.ok(!left.includes(alsoOld.id) && !left.includes(oldAlone.id));
  });
});
