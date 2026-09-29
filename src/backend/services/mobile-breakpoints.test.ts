/**
 * Phase 32 B4.4 — breakpoints on the phone, against a real database.
 *
 * What makes a phone's answer worth trusting: it is the person's only for a
 * pairing they confirmed on the desktop, it is audited against the device,
 * the window is told, and the first answer stands wherever it was given.
 * What the phone is shown is the desktop's own wording, a breach never
 * worded as a pause.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-phone-bp-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });

let db: typeof import('./database');
let phone: typeof import('./mobile-breakpoints');
let devices: typeof import('./paired-device-service');
let audit: typeof import('./peer-audit-service');
let breakpoints: typeof import('./breakpoint-service');

const PLAN = 'b440a000-0000-4000-8000-000000000001';
const ITEM = 'b440a000-1111-4000-8000-000000000001';
const CONFIRMED = 'AA:BB:CC:confirmed-phone';
const UNCONFIRMED = 'AA:BB:CC:unconfirmed-phone';
const WHO = { author: 'sam', authorType: 'human' as const };
const CTX = { who: WHO, projectRoot: null };

function peer(fingerprint: string) {
  const broadcasts: Array<{ type: string; data: unknown }> = [];
  return {
    broadcasts,
    ctx: {
      fingerprint,
      send: () => {},
      broadcast: (type: string, data: unknown) => { broadcasts.push({ type, data }); },
    },
  };
}

function hit(ref: string, cols: Record<string, unknown>, at: number): void {
  const row = { breakpoint_id: 'bp-task', tool: 'claim_item', action: 'claim', item_uid: ITEM, plan_uid: PLAN, agent: 'codex', hit_at: at, ...cols };
  const keys = Object.keys(row);
  db.getDb().run(
    `INSERT INTO breakpoint_hits (ref, ${keys.join(', ')}) VALUES (?, ${keys.map(() => '?').join(', ')})`,
    [ref, ...keys.map((k) => (row as Record<string, unknown>)[k] as string | number | null)],
  );
}

before(async () => {
  db = await import('./database');
  await db.initDatabase();
  phone = await import('./mobile-breakpoints');
  devices = await import('./paired-device-service');
  audit = await import('./peer-audit-service');
  breakpoints = await import('./breakpoint-service');

  const now = Date.now();
  db.getDb().run(
    `INSERT INTO plans (uid, title, status, author, author_type, project_path, created_at, updated_at)
     VALUES (?, 'Checkout', 'in_progress', 't', 'human', ?, ?, ?)`,
    [PLAN, tmp, now, now],
  );
  db.getDb().run(
    `INSERT INTO plan_items (uid, plan_uid, kind, title, status, author, author_type, created_at, updated_at)
     VALUES (?, ?, 'action', 'Partial refunds', 'pending', 't', 'human', ?, ?)`,
    [ITEM, PLAN, now, now],
  );
  db.getDb().run(
    `INSERT INTO breakpoints (id, kind, target, plan_uid, note, created_at, created_by, created_by_type)
     VALUES ('bp-task', 'task', ?, ?, 'Ask me before touching payments', ?, 'sam', 'human'),
            ('bp-code', 'code', 'payments/', NULL, NULL, ?, 'sam', 'human')`,
    [ITEM, PLAN, now, now],
  );
  hit('bp-claim', {}, now - 60_000);
  hit('bp-breach', { breakpoint_id: 'bp-code', tool: 'watcher', action: 'breach', item_uid: '', plan_uid: null, path: 'payments/refund.ts', breach: 1, workstream_root: '/work/acme-exports' }, now - 30_000);

  const base = {
    pairingId: 'p', deviceType: 'mobile' as const, pairedAt: new Date().toISOString(),
    lastConnected: null, sharedSecret: 'x', instanceId: null,
  };
  devices.upsertPairedDevice({ ...base, fingerprint: CONFIRMED, alias: 'Sam’s phone', confirmedAt: new Date().toISOString() });
  devices.upsertPairedDevice({ ...base, fingerprint: UNCONFIRMED, alias: 'Unconfirmed phone', confirmedAt: null });
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('what is held, on the phone', () => {
  test('oldest first, in the desktop\'s words; a breach is worded as one, never as a pause', async () => {
    const { hits } = await phone.handleBreakpointMethod('breakpoint.waiting', {}, peer(CONFIRMED).ctx, CTX) as { hits: import('./mobile-breakpoints').PhoneHit[] };
    assert.deepEqual(hits.map((h) => h.ref), ['bp-claim', 'bp-breach']);
    assert.equal(hits[0].headline, 'codex wants to claim “Partial refunds”');
    assert.match(hits[0].why, /before an agent claims or finishes this task/);
    assert.deepEqual(hits[0].labels, { continue: 'Continue', steer: 'Continue with steer', stop: 'Stop' });
    assert.equal(hits[0].breakpointNote, 'Ask me before touching payments');
    assert.equal(hits[0].breach, false);

    assert.equal(hits[1].breach, true);
    assert.equal(hits[1].headline, 'codex in acme-exports changed payments/refund.ts past a breakpoint');
    assert.match(hits[1].why, /could not be paused/);
    assert.deepEqual(hits[1].labels, { continue: 'Carry on', steer: 'Carry on with this note', stop: 'Stop' });
  });
});

describe('answering from the phone', () => {
  test('refused: a pairing not confirmed on the desktop, a bad decision, a steer with no note, an unknown hit', async () => {
    await assert.rejects(
      phone.handleBreakpointMethod('breakpoint.answer', { ref: 'bp-claim', decision: 'continue' }, peer(UNCONFIRMED).ctx, CTX),
      /needs a pairing confirmed on the desktop/,
    );
    await assert.rejects(phone.handleBreakpointMethod('breakpoint.answer', { ref: 'bp-claim', decision: 'maybe' }, peer(CONFIRMED).ctx, CTX), /decision must be one of/);
    await assert.rejects(phone.handleBreakpointMethod('breakpoint.answer', { ref: 'bp-claim', decision: 'steer', note: '   ' }, peer(CONFIRMED).ctx, CTX), /A steer needs a note/);
    await assert.rejects(phone.handleBreakpointMethod('breakpoint.answer', { ref: 'bp-nope', decision: 'continue' }, peer(CONFIRMED).ctx, CTX), /No such breakpoint hit/);
    await assert.rejects(phone.handleBreakpointMethod('breakpoint.answer', { decision: 'continue' }, peer(CONFIRMED).ctx, CTX), /ref is required/);
    assert.equal(breakpoints.getHit('bp-claim')?.answeredAt, null, 'nothing refused was recorded');
  });

  test('a steer is the person\'s: recorded with their note, audited against the device, the window told', async () => {
    const p = peer(CONFIRMED);
    const r = await phone.handleBreakpointMethod('breakpoint.answer',
      { ref: 'bp-claim', decision: 'steer', note: 'Go ahead, but don\'t change the refund path', author: 'someone-else' }, p.ctx, CTX) as { hit: import('./mobile-breakpoints').PhoneHit; alreadyAnswered?: true };
    assert.equal(r.alreadyAnswered, undefined);
    assert.equal(r.hit.decision, 'steer');
    assert.equal(r.hit.note, 'Go ahead, but don\'t change the refund path');

    const stored = breakpoints.getHit('bp-claim')!;
    assert.equal(stored.answeredBy, 'sam', 'the author is the person on the phone, never a name from the request');
    assert.equal(stored.answeredByType, 'human');
    assert.deepEqual(p.broadcasts, [{ type: 'breakpoint-answered', data: { ref: 'bp-claim', planUid: PLAN, decision: 'steer' } }]);
    const entry = audit.listPeerAudit({ fingerprint: CONFIRMED }).find((e) => e.method === 'breakpoint.answer');
    assert.equal(entry?.kind, 'decision');
    assert.match(entry?.detail ?? '', /steer on breakpoint hit bp-claim/);
  });

  test('the first answer stands: answering again returns the answer that stood, and changes nothing', async () => {
    const p = peer(CONFIRMED);
    const r = await phone.handleBreakpointMethod('breakpoint.answer', { ref: 'bp-claim', decision: 'stop' }, p.ctx, CTX) as { hit: import('./mobile-breakpoints').PhoneHit; alreadyAnswered?: true };
    assert.equal(r.alreadyAnswered, true);
    assert.equal(r.hit.decision, 'steer');
    assert.equal(breakpoints.getHit('bp-claim')?.decision, 'steer');
    assert.deepEqual(p.broadcasts, []);

    const { hits } = await phone.handleBreakpointMethod('breakpoint.waiting', {}, p.ctx, CTX) as { hits: Array<{ ref: string }> };
    assert.deepEqual(hits.map((h) => h.ref), ['bp-breach'], 'an answered call leaves the list');
  });
});
