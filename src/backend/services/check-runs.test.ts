/**
 * Phase 33 C7 — the check runs kept here: this device's, newest first and
 * trimmed; a teammate's one per device, a newer one replacing it; forgotten
 * by project or by device; each saying who, where and how it went.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CODETRELLIS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-check-runs-'));
let cr: typeof import('./check-runs');

before(async () => {
  await (await import('./database')).initDatabase();
  cr = await import('./check-runs');
});

const run = (at: number, extra: Partial<import('./check-runs').NewCheckRun> = {}): import('./check-runs').NewCheckRun => ({
  projectRoot: '/work/acme', at, by: { author: 'claude-code', authorType: 'mcp' }, ranIn: 'claude-code\'s session', commit: 'a'.repeat(40), dirty: [],
  base: 'main', rulebook: null, scope: null, strict: false, outcome: { ok: true, files: 2, blocks: 0, warns: 0 }, says: [], findings: [], ...extra,
});

test('this device\'s runs, newest first, each saying who, where and how it went; the listener hears each', () => {
  const heard: number[] = [];
  cr.setCheckRunListener((r) => heard.push(r.at));
  const first = cr.recordCheckRun(run(1));
  cr.recordCheckRun(run(2, { by: { author: 'Sam Lee', authorType: 'human' }, ranIn: 'the app', outcome: { ok: false, files: 2, blocks: 1, warns: 0 } }), { writer: 'w', name: 'Sam Lee' });
  cr.setCheckRunListener(null);
  assert.deepEqual(heard, [1, 2]);
  const [newest, older] = cr.listCheckRuns('/work/acme');
  assert.equal(older.id, first);
  assert.equal(older.words, `claude-code in claude-code's session at aaaaaaa, against main: ✓ conforms`);
  assert.equal(newest.who, 'you');
  assert.equal(newest.words, 'you in the app at aaaaaaa, against main: ✗ 1 blocks');
  assert.equal(cr.getCheckRun('/work/acme', first)?.id, first);
  assert.equal(cr.getCheckRun('/work/acme', 'nope'), null);
});

test('a teammate\'s device: one run kept, a newer replaces it, an older is never read back; forgotten when asked', () => {
  const rec = (counter: number) => ({ ...run(100 + counter), writer: 'b'.repeat(16), name: 'Build bot', counter, by: { author: 'ci', authorType: 'mcp' }, ranIn: 'GitHub Actions' });
  cr.putTeammateCheckRun('/work/acme', rec(1), { verified: false, why: 'it is not signed' });
  cr.putTeammateCheckRun('/work/acme', rec(2), { verified: false, why: 'it is not signed' });
  const theirs = cr.listCheckRuns('/work/acme').filter((r) => !r.mine);
  assert.deepEqual(theirs.map((r) => r.id), [`${'b'.repeat(16)}-2`]);
  assert.equal(theirs[0].words, 'ci for Build bot in GitHub Actions at aaaaaaa, against main: ✓ conforms (unverified: it is not signed)');
  assert.equal(cr.knownCheckRunCounters('/work/acme').get('b'.repeat(16)), 2);
  assert.equal(cr.forgetTeammateCheckRuns({ projectRoot: '/work/acme' }), 1);
  assert.equal(cr.listCheckRuns('/work/acme').every((r) => r.mine), true);
});

test('only this device\'s newest 200 are kept', () => {
  for (let i = 0; i < 210; i++) cr.recordCheckRun(run(1000 + i, { projectRoot: '/work/many' }));
  const all = cr.listCheckRuns('/work/many', 500);
  assert.equal(all.length, 200);
  assert.equal(all[all.length - 1].at, 1010);
});
