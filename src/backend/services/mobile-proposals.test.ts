/**
 * Phase 32 B7.6 — proposed spec changes on the phone, against a real database.
 *
 * A decision from the phone is the person's only for a pairing they
 * confirmed on the desktop, it is audited against the device, the window is
 * told, and the first decision stands. Amending needs the text edited, which
 * is the window's. What the phone reads is the desktop's own wording.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-phone-prop-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });

let db: typeof import('./database');
let phone: typeof import('./mobile-proposals');
let devices: typeof import('./paired-device-service');
let audit: typeof import('./peer-audit-service');
let proposals: typeof import('./spec-proposals-service');

const PLAN = 'b7600000-0000-4000-8000-000000000001';
const PAGE = 'b7600000-1111-4000-8000-000000000001';
const CONFIRMED = 'AA:BB:CC:confirmed-phone';
const UNCONFIRMED = 'AA:BB:CC:unconfirmed-phone';
const CTX = { who: { author: 'sam', authorType: 'human' as const }, projectRoot: tmp };
const BODY = '# Invoice format\n\nAn invoice is JSON.\n\n## Fields\n\n- amount\n';

function peer(fingerprint: string) {
  const broadcasts: Array<{ type: string; data: unknown }> = [];
  return { broadcasts, ctx: { fingerprint, send: () => {}, broadcast: (type: string, data: unknown) => { broadcasts.push({ type, data }); } } };
}

const propose = (why: string) => proposals.proposeSpecChange(
  { page: PAGE, section: 'fields', text: '## Fields\n\n- amount\n- currency', why, evidence: { tests: ['invoice_eu.spec'] } },
  { author: 'codex', authorType: 'agent', sessionId: 's1' },
);

before(async () => {
  db = await import('./database');
  await db.initDatabase();
  phone = await import('./mobile-proposals');
  devices = await import('./paired-device-service');
  audit = await import('./peer-audit-service');
  proposals = await import('./spec-proposals-service');

  const now = Date.now();
  db.getDb().run(
    `INSERT INTO plans (uid, title, status, author, author_type, project_path, created_at, updated_at)
     VALUES (?, 'Invoicing spec', 'in_progress', 't', 'human', ?, ?, ?)`,
    [PLAN, tmp, now, now],
  );
  db.getDb().run(
    `INSERT INTO plan_items (uid, plan_uid, kind, title, body, status, author, author_type, created_at, updated_at)
     VALUES (?, ?, 'object', 'Invoice format', ?, 'pending', 't', 'human', ?, ?)`,
    [PAGE, PLAN, BODY, now, now],
  );
  const base = {
    pairingId: 'p', deviceType: 'mobile' as const, pairedAt: new Date().toISOString(),
    lastConnected: null, sharedSecret: 'x', instanceId: null,
  };
  devices.upsertPairedDevice({ ...base, fingerprint: CONFIRMED, alias: 'Sam’s phone', confirmedAt: new Date().toISOString() });
  devices.upsertPairedDevice({ ...base, fingerprint: UNCONFIRMED, alias: 'Unconfirmed phone', confirmedAt: null });
});

after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('a proposed spec change, on the phone', () => {
  test('listed and read in the desktop\'s words', async () => {
    const made = propose('Amounts are ambiguous for EU customers.');
    const { proposals: open } = await phone.handleProposalMethod('proposal.list', {}, peer(CONFIRMED).ctx, CTX) as { proposals: import('./mobile-proposals').PhoneProposal[] };
    assert.deepEqual(open.map((p) => p.uid), [made.uid]);
    const { proposal } = await phone.handleProposalMethod('proposal.get', { uid: made.uid }, peer(CONFIRMED).ctx, CTX) as { proposal: import('./mobile-proposals').PhoneProposal };
    assert.equal(proposal.headline, '✎ codex proposes a change to § Fields of “Invoice format”');
    assert.equal(proposal.evidence, 'tests invoice_eu.spec');
    assert.equal(proposal.before, '## Fields\n\n- amount\n');
    assert.equal(proposal.proposed, '## Fields\n\n- amount\n- currency');
    assert.equal(proposal.replies, 'Nothing relies on this page yet.');
    assert.equal(proposal.hitRef, made.hitRef);
    await assert.rejects(phone.handleProposalMethod('proposal.get', { uid: 'nope' }, peer(CONFIRMED).ctx, CTX), /No such proposal/);
  });

  test('refused: an unconfirmed pairing, amending, a decision that is not one', async () => {
    const [open] = proposals.listProposals({ status: 'open' });
    await assert.rejects(
      phone.handleProposalMethod('proposal.decide', { uid: open.uid, decision: 'accept' }, peer(UNCONFIRMED).ctx, CTX),
      /needs a pairing confirmed on the desktop/,
    );
    await assert.rejects(
      phone.handleProposalMethod('proposal.decide', { uid: open.uid, decision: 'amend', text: 'x' }, peer(CONFIRMED).ctx, CTX),
      /amending it is done in the window/,
    );
    await assert.rejects(phone.handleProposalMethod('proposal.decide', { decision: 'accept' }, peer(CONFIRMED).ctx, CTX), /uid is required/);
    assert.equal(proposals.getProposal(open.uid)?.status, 'open');
  });

  test('rejected from a confirmed phone: the person\'s, audited, the window told; the first decision stands', async () => {
    const [open] = proposals.listProposals({ status: 'open' });
    const p = peer(CONFIRMED);
    const r = await phone.handleProposalMethod('proposal.decide', { uid: open.uid, decision: 'reject', note: 'Use the ledger currency.', author: 'Priya' }, p.ctx, CTX) as { proposal: import('./mobile-proposals').PhoneProposal; alreadyDecided?: true };
    assert.equal(r.alreadyDecided, undefined);
    assert.equal(r.proposal.status, 'rejected');
    assert.equal(r.proposal.decisionNote, 'Use the ledger currency.');
    const stored = proposals.getProposal(open.uid)!;
    assert.equal(stored.decidedBy, 'sam');
    assert.equal(stored.decidedByType, 'human');
    assert.deepEqual(p.broadcasts.map((b) => b.type), ['spec-proposal-decided', 'breakpoint-answered']);
    assert.ok(audit.listPeerAudit({ fingerprint: CONFIRMED }).some((e) => e.method === 'proposal.decide' && e.kind === 'decision'));

    const again = await phone.handleProposalMethod('proposal.decide', { uid: open.uid, decision: 'accept' }, peer(CONFIRMED).ctx, CTX) as { proposal: { status: string }; alreadyDecided?: true };
    assert.deepEqual([again.alreadyDecided, again.proposal.status], [true, 'rejected']);
    const { proposals: none } = await phone.handleProposalMethod('proposal.list', {}, peer(CONFIRMED).ctx, CTX) as { proposals: unknown[] };
    assert.deepEqual(none, []);
  });
});
