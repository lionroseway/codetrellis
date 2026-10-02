/**
 * Phase 32 A4.2 — awareness on the phone, against a real database.
 *
 * The phone lists what needs the person in the desktop's words, opens one
 * signal with both sides in plain words, and answers or replies. Answering
 * and replying are the person's only from a pairing confirmed on the desktop,
 * are audited against the device, tell the window, and carry the phone as
 * the channel, never a name from the request.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SignalStateBy } from '../../shared/types';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-phone-aw-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });

let db: typeof import('./database');
let phone: typeof import('./mobile-awareness');
let devices: typeof import('./paired-device-service');
let audit: typeof import('./peer-audit-service');
let awareness: typeof import('./awareness-service');

const PROJECT = path.join(tmp, 'acme');
const BILLING = `${PROJECT}-billing`;
const CHECKOUT = `${PROJECT}-checkout`;
const CONFIRMED = 'AA:BB:CC:confirmed-phone';
const UNCONFIRMED = 'AA:BB:CC:unconfirmed-phone';
const WHO = { actor: 'sam', actorType: 'human' as const, channel: 'phone' as const };

const replies: Array<{ projectRoot: string; id: string; message: string; by: unknown }> = [];
const CTX = {
  who: WHO,
  projectRoot: PROJECT,
  reply: (projectRoot: string, id: string, message: string, by: SignalStateBy) => {
    replies.push({ projectRoot, id, message, by });
    return { id: 1, message, by, at: 1, readBy: [], signalId: id, steers: ['e1'] };
  },
};

function peer(fingerprint: string) {
  const broadcasts: Array<{ type: string; data: unknown }> = [];
  return { broadcasts, ctx: { fingerprint, send: () => {}, broadcast: (type: string, data: unknown) => { broadcasts.push({ type, data }); } } };
}

function signal(id: string, kind: string, severity: string, state: string, subject: Record<string, unknown>, summary: string, lastSeen: number) {
  db.getDb().run(
    `INSERT OR REPLACE INTO awareness_signals (id, project_root, kind, severity, subject, workstreams, summary, first_seen, last_seen, state)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [id, PROJECT, kind, severity, JSON.stringify(subject), JSON.stringify([BILLING, CHECKOUT]), summary, lastSeen, state],
  );
}

const call = (method: string, params: Record<string, unknown>, fp = CONFIRMED, ctx: typeof CTX | (Omit<typeof CTX, 'projectRoot'> & { projectRoot: string | null }) = CTX) =>
  phone.handleAwarenessMethod(method, params, peer(fp).ctx, ctx as typeof CTX);

before(async () => {
  for (const d of [PROJECT, BILLING, CHECKOUT]) fs.mkdirSync(d, { recursive: true });
  db = await import('./database');
  await db.initDatabase();
  phone = await import('./mobile-awareness');
  devices = await import('./paired-device-service');
  audit = await import('./peer-audit-service');
  awareness = await import('./awareness-service');

  signal('k1', 'contract', 'high', 'open', {
    file: 'src/billing/invoice.ts', symbol: 'createInvoice', by: BILLING, change: 'signature',
    signature: { before: '(order: Order): Invoice', after: '(order: Order, currency: string): Invoice' }, importers: ['src/checkout/submit.ts'],
  }, '`billing-v2` changed createInvoice', 5);
  signal('c1', 'collision', 'medium', 'open', { file: 'src/shared/money.ts', symbol: 'format' }, 'both change money.ts → format', 9);
  signal('seen', 'collision', 'high', 'acknowledged', { file: 'src/a.ts' }, 'both change a.ts', 20);
  signal('low', 'stale-base', 'low', 'open', { files: ['src/b.ts'] }, 'behind main', 30);
  signal('aside', 'collision', 'high', 'dismissed', { file: 'src/c.ts' }, 'both change c.ts', 40);

  const base = { pairingId: 'p', deviceType: 'mobile' as const, pairedAt: new Date().toISOString(), lastConnected: null, sharedSecret: 'x', instanceId: null };
  devices.upsertPairedDevice({ ...base, fingerprint: CONFIRMED, alias: 'Sam’s phone', confirmedAt: new Date().toISOString() });
  devices.upsertPairedDevice({ ...base, fingerprint: UNCONFIRMED, alias: 'Unconfirmed phone', confirmedAt: null });
});

after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('what needs you, on the phone', () => {
  test('the digest\'s lines, then the signals in play: open first by severity, then seen; low and set-aside ones left to the desktop', async () => {
    const got = await call('awareness.needsYou', {}) as import('./mobile-awareness').PhoneNeedsYou;
    assert.equal(got.projectRoot, PROJECT);
    assert.equal(got.digest.needsYou, 2);
    assert.equal(got.digest.low, 1);
    assert.equal(got.digest.lines.length, 2);
    assert.equal(got.digest.lines[0].question, 'keep the old signature, or update the callers?');
    assert.deepEqual(got.signals.map((s) => s.id), ['k1', 'c1', 'seen']);
    assert.deepEqual(got.signals[0], {
      id: 'k1', kind: 'contract', severity: 'high', state: 'open', heading: 'Changed signature',
      summary: '`billing-v2` changed createInvoice', sides: ['acme-billing', 'acme-checkout'], firstSeen: 1, lastSeen: 5,
    });
  });

  test('no project open: nothing to say, and no error', async () => {
    const got = await call('awareness.needsYou', {}, CONFIRMED, { ...CTX, projectRoot: null }) as import('./mobile-awareness').PhoneNeedsYou;
    assert.deepEqual(got, { projectRoot: null, digest: { needsYou: 0, low: 0, moreLines: 0, lines: [] }, signals: [] });
  });

  test('the snapshot\'s count is the tab\'s: open, high or medium', () => {
    assert.equal(awareness.countNeedsYou(PROJECT), 2);
    assert.equal(awareness.countNeedsYou('/elsewhere'), 0);
  });
});

describe('one signal, in full', () => {
  test('both sides in plain words, the files, and what was answered', async () => {
    const { signal: s } = await call('awareness.signal', { id: 'k1' }) as { signal: import('./mobile-awareness').PhoneSignalDetail };
    assert.deepEqual(s.sideWords.map((x) => x.words), [
      "acme-billing changed createInvoice's signature in src/billing/invoice.ts: createInvoice(order: Order): Invoice is now createInvoice(order: Order, currency: string): Invoice.",
      'acme-checkout imports it, in 1 file: src/checkout/submit.ts.',
    ]);
    assert.deepEqual(s.files, ['src/billing/invoice.ts', 'src/checkout/submit.ts']);
    assert.deepEqual(s.replies, []);
    assert.deepEqual(s.told, []);
  });

  test('refused: no id, a signal that is not open here, no project', async () => {
    await assert.rejects(call('awareness.signal', {}), /id is required/);
    await assert.rejects(call('awareness.signal', { id: 'nope' }), /No such open signal/);
    await assert.rejects(call('awareness.signal', { id: 'k1' }, CONFIRMED, { ...CTX, projectRoot: null }), /No project is open/);
  });
});

describe('answering from the phone', () => {
  test('refused: a pairing not confirmed on the desktop, a state that is not one', async () => {
    await assert.rejects(call('awareness.answer', { id: 'c1', state: 'acknowledged' }, UNCONFIRMED), /needs a pairing confirmed on the desktop/);
    await assert.rejects(call('awareness.answer', { id: 'c1', state: 'resolved' }), /state must be one of/);
    await assert.rejects(call('awareness.answer', { id: 'nope', state: 'acknowledged' }), /No such open signal/);
    assert.equal(awareness.listSignals(PROJECT).find((s) => s.id === 'c1')?.state, 'open');
  });

  test('acknowledged from a confirmed phone: the person\'s answer, from the phone, audited, the window told', async () => {
    const p = peer(CONFIRMED);
    const { signal: s } = await phone.handleAwarenessMethod('awareness.answer', { id: 'c1', state: 'acknowledged', actor: 'Priya' }, p.ctx, CTX) as { signal: import('./mobile-awareness').PhoneSignalDetail };
    assert.equal(s.state, 'acknowledged');
    assert.deepEqual(s.stateBy, WHO); // never the name the request carried
    assert.deepEqual(p.broadcasts, [{ type: 'awareness-changed', data: { projectRoot: PROJECT } }]);
    assert.ok(audit.listPeerAudit({ fingerprint: CONFIRMED }).some((e) => e.method === 'awareness.answer' && e.kind === 'decision' && e.detail === 'acknowledged on signal c1'));
    assert.equal(awareness.countNeedsYou(PROJECT), 1);
  });
});

describe('replying to the agents from the phone', () => {
  test('refused: an unconfirmed pairing, no words, too many', async () => {
    await assert.rejects(call('awareness.reply', { id: 'k1', message: 'hi' }, UNCONFIRMED), /needs a pairing confirmed on the desktop/);
    await assert.rejects(call('awareness.reply', { id: 'k1', message: '   ' }), /message must be 1–1000 characters/);
    await assert.rejects(call('awareness.reply', { id: 'k1', message: 'x'.repeat(1001) }), /message must be 1–1000 characters/);
    assert.deepEqual(replies, []);
  });

  test('sent the desktop\'s way, as the person on the phone, and audited', async () => {
    const got = await call('awareness.reply', { id: 'k1', message: '  Keep the old signature  ' }) as { reply: { message: string }; steers: number };
    assert.deepEqual(replies, [{ projectRoot: PROJECT, id: 'k1', message: 'Keep the old signature', by: WHO }]);
    assert.equal(got.reply.message, 'Keep the old signature');
    assert.equal(got.steers, 1);
    assert.ok(audit.listPeerAudit({ fingerprint: CONFIRMED }).some((e) => e.method === 'awareness.reply' && e.detail === 'reply on signal k1'));
  });
});

describe('a task\'s material on the phone (A6.4)', () => {
  test('the tasks by title, no direction between them, and the file it is about', async () => {
    db.getDb().run(
      `INSERT OR REPLACE INTO awareness_signals (id, project_root, kind, severity, subject, workstreams, summary, first_seen, last_seen, state)
       VALUES ('m1', ?, 'contract', 'medium', ?, ?, ?, 1, 50, 'open')`,
      [PROJECT, JSON.stringify({ material: 'data/sales.csv', parts: ['line 2'], citedBy: ['task:a'], labels: { 'task:a': 'Q3 report', 'task:b': 'Board pack' } }),
        JSON.stringify(['task:a', 'task:b']), '`data/sales.csv` changed. “Q3 report” cites line 2. “Board pack” uses it too'],
    );
    try {
      const got = await call('awareness.needsYou', {}) as import('./mobile-awareness').PhoneNeedsYou;
      const listed = got.signals.find((s) => s.id === 'm1')!;
      assert.deepEqual([listed.heading, listed.sides, listed.material], ['Changed material', ['Q3 report', 'Board pack'], 'data/sales.csv']);
      assert.ok(got.digest.lines.some((l) => l.text === '`data/sales.csv` changed. “Q3 report” cites line 2. “Board pack” uses it too'
        && l.question === 'check the cited parts again, or keep the old version?'));
      const { signal: detail } = await call('awareness.signal', { id: 'm1' }) as { signal: import('./mobile-awareness').PhoneSignalDetail };
      assert.deepEqual(detail.files, ['data/sales.csv']);
      assert.deepEqual(detail.sideWords.map((x) => x.words), [
        'Q3 report cites line 2 of data/sales.csv, as it was before it changed.',
        'Board pack uses data/sales.csv.',
      ]);
    } finally {
      db.getDb().run(`DELETE FROM awareness_signals WHERE id = 'm1'`);
    }
  });
});
