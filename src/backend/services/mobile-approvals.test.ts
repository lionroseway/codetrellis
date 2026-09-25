/**
 * Phase 31 §12 — approving from the phone, against a real database and
 * the real reader.
 *
 * What makes a phone approval worth trusting: it is issued as a person's
 * only for a pairing the person confirmed, on the phone channel, and it is
 * audited against the device; what the phone is shown of the evidence is
 * the confined read, streamed only to the device that asked under the id
 * it chose; and a submission waiting on a person, or an approval gone
 * stale, reaches them as a notice that names the criterion.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-approvals-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });
const project = fs.realpathSync(fs.mkdtempSync(path.join(tmp, 'project-')));

let db: typeof import('./database');
let artefacts: typeof import('./artefact-service');
let criteria: typeof import('./criteria-service');
let loop: typeof import('./criterion-loop-service');
let hd: typeof import('./human-decision');
let approvals: typeof import('./mobile-approvals');
let devices: typeof import('./paired-device-service');
let audit: typeof import('./peer-audit-service');
let channels: typeof import('./channel-event-service');

const PLAN = 'a990a000-0000-4000-8000-000000000001';
const ITEM = 'a990a000-1111-4000-8000-000000000001';
const AGENT = { author: 'claude-code', authorType: 'mcp' };
const CONFIRMED = 'AA:BB:CC:confirmed-phone';
const UNCONFIRMED = 'AA:BB:CC:unconfirmed-phone';
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==',
  'base64',
);

interface Sent { message: Record<string, unknown> }
function peer(fingerprint: string) {
  const sent: Sent[] = [];
  const broadcasts: Array<{ type: string; data: unknown }> = [];
  return {
    sent,
    broadcasts,
    ctx: {
      fingerprint,
      send: (message: Record<string, unknown>) => { sent.push({ message }); },
      broadcast: (type: string, data: unknown) => { broadcasts.push({ type, data }); },
    },
  };
}

function reassemble(sent: Sent[], id: string): unknown {
  const chunks = sent.map((s) => s.message).filter((m) => m.cmd === 'preview.chunk' && m.id === id);
  const total = chunks[0]?.total as number;
  assert.equal(chunks.length, total, 'every chunk arrives');
  return JSON.parse(chunks.sort((a, b) => (a.seq as number) - (b.seq as number)).map((c) => c.data).join(''));
}

const person = () => hd.issueHumanDecision('desktop', 'someone@example.com');

async function submitted(text: string, file = 'out/totals.csv', locator: unknown = { lines: '2-3' }) {
  const a = artefacts.listArtefacts(ITEM).find((x) => x.path === file)
    ?? await artefacts.recordArtefact({ itemUid: ITEM, path: file, role: 'output', actor: AGENT });
  const c = criteria.addCriterionAsHuman(ITEM, { text, kind: 'manual', policy: 'propose' }, person());
  await loop.submitChecked(c.uid, { evidence: [{ attachmentUid: a.uid, locator }], note: 'see the totals' }, AGENT);
  return { criterion: criteria.getCriterion(c.uid)!, attachmentUid: a.uid };
}

before(async () => {
  fs.mkdirSync(path.join(project, 'out'));
  fs.writeFileSync(path.join(project, 'out', 'totals.csv'), 'region,total\nEMEA,10\nAPAC,20\nAMER,30\n');
  fs.writeFileSync(path.join(project, 'out', 'chart.png'), PNG_1PX);

  db = await import('./database');
  await db.initDatabase();
  (await import('./trusted-roots')).setActiveProjectRoot(project);
  artefacts = await import('./artefact-service');
  criteria = await import('./criteria-service');
  loop = await import('./criterion-loop-service');
  hd = await import('./human-decision');
  approvals = await import('./mobile-approvals');
  devices = await import('./paired-device-service');
  audit = await import('./peer-audit-service');
  channels = await import('./channel-event-service');

  const now = Date.now();
  db.getDb().run(
    `INSERT INTO plans (uid, title, status, author, author_type, project_path, created_at, updated_at)
     VALUES (?, 'Q3 board pack', 'in_progress', 't', 'human', ?, ?, ?)`,
    [PLAN, project, now, now],
  );
  db.getDb().run(
    `INSERT INTO plan_items (uid, plan_uid, kind, title, status, author, author_type, created_at, updated_at)
     VALUES (?, ?, 'action', 'Regional totals', 'pending', 't', 'human', ?, ?)`,
    [ITEM, PLAN, now, now],
  );
  const base = {
    pairingId: 'p', deviceType: 'mobile' as const, pairedAt: new Date().toISOString(),
    lastConnected: null, sharedSecret: 'x', instanceId: null,
  };
  devices.upsertPairedDevice({ ...base, fingerprint: CONFIRMED, alias: 'Test phone', confirmedAt: new Date().toISOString() });
  devices.upsertPairedDevice({ ...base, fingerprint: UNCONFIRMED, alias: 'Unconfirmed phone', confirmedAt: null });
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('what is waiting on a person', () => {
  test('a submission to judge is listed with where it lives and what it cites; a decided one is not', async () => {
    const { criterion } = await submitted('EMEA ties to the ledger');
    const decided = await submitted('APAC ties to the ledger');
    criteria.decideCriterion(decided.criterion.uid, { decision: 'approved' }, person());

    const { entries } = await approvals.handleApprovalMethod('criteria.awaiting', {}, peer(CONFIRMED).ctx) as {
      entries: import('./mobile-approvals').AwaitingEntry[];
    };
    const mine = entries.find((e) => e.uid === criterion.uid);
    assert.ok(mine, 'the submitted criterion is waiting');
    assert.equal(mine!.state, 'submitted');
    assert.equal(mine!.planTitle, 'Q3 board pack');
    assert.equal(mine!.itemTitle, 'Regional totals');
    assert.equal(mine!.evidence[0].name, 'totals.csv');
    assert.equal(mine!.evidence[0].where, 'lines 2–3');
    assert.equal(mine!.canApprove, true);
    assert.equal(mine!.canSendBack, true);
    assert.ok(!entries.some((e) => e.uid === decided.criterion.uid), 'an approved criterion is not waiting');
  });

  test('the submission posted a notice that names the criterion, so a push can open it', async () => {
    const { criterion } = await submitted('AMER ties to the ledger');
    const notice = channels.listChannelEvents(PLAN).find((e) => e.payload.criterionUid === criterion.uid);
    assert.ok(notice, 'a notice was posted');
    assert.equal(notice!.eventType, 'need-decision');
    assert.equal(notice!.payload.reason, 'submitted');
    assert.equal(notice!.itemUid, ITEM);
    assert.match(notice!.payload.message, /AMER ties to the ledger/);

    // Deciding answers it, so "needs decision" stops counting it.
    await approvals.handleApprovalMethod('criterion.decide', { criterionUid: criterion.uid, decision: 'approved' }, peer(CONFIRMED).ctx);
    assert.equal(channels.getChannelEvent(notice!.uid)!.status, 'resolved');
  });
});

describe('deciding from the phone', () => {
  test('a pairing never confirmed on the desktop cannot put a person\'s name to anything', async () => {
    const { criterion } = await submitted('Chart has a source line');
    await assert.rejects(
      approvals.handleApprovalMethod('criterion.decide', { criterionUid: criterion.uid, decision: 'approved' }, peer(UNCONFIRMED).ctx),
      (err: Error) => err.name === 'PeerAuthorizationError',
    );
    assert.equal(criteria.getCriterion(criterion.uid)!.state, 'submitted', 'nothing was recorded');
  });

  test('a confirmed phone approves: the sign-off is a person\'s, on the phone channel, and the device is audited', async () => {
    const { criterion } = await submitted('Totals are in thousands');
    const p = peer(CONFIRMED);
    const { criterion: after } = await approvals.handleApprovalMethod(
      'criterion.decide', { criterionUid: criterion.uid, decision: 'approved' }, p.ctx,
    ) as { criterion: import('./mobile-approvals').PhoneCriterion };
    assert.equal(after.state, 'met');
    const signoff = criteria.listSignoffs(criterion.uid).at(-1)!;
    assert.equal(signoff.channel, 'phone');
    assert.equal(signoff.actorType, 'human');
    assert.equal(signoff.device, 'Test phone', 'the sign-off names the device it was taken on (§13)');
    assert.ok(Object.keys(signoff.evidenceHashes ?? {}).length > 0, 'the hashes it was taken on are recorded');
    const entry = audit.listPeerAudit({ fingerprint: CONFIRMED }).find((e) => e.kind === 'decision');
    assert.ok(entry, 'the decision is in the device audit');
    assert.match(entry!.detail ?? '', new RegExp(criterion.uid));
    assert.deepEqual(p.broadcasts.map((b) => b.type), ['plan-item-criteria-changed']);
  });

  test('a send-back needs a note — it is what the agent reads next', async () => {
    const { criterion } = await submitted('Footnotes cite sources');
    await assert.rejects(
      approvals.handleApprovalMethod('criterion.decide', { criterionUid: criterion.uid, decision: 'sent_back' }, peer(CONFIRMED).ctx),
      /Say what is wrong/,
    );
    const { criterion: back } = await approvals.handleApprovalMethod(
      'criterion.decide', { criterionUid: criterion.uid, decision: 'sent_back', note: 'APAC is missing a footnote' }, peer(CONFIRMED).ctx,
    ) as { criterion: import('./mobile-approvals').PhoneCriterion };
    assert.equal(back.state, 'sent_back');
    assert.equal(back.lastDecision?.note, 'APAC is missing a footnote');
    assert.equal(back.lastDecision?.channel, 'phone');
  });
});

describe('previewing evidence', () => {
  test('the cited place streams to the asking peer, under its own id, in chunks the answer counts', async () => {
    const { attachmentUid } = await submitted('Preview check', 'out/totals.csv', { lines: '2-3' });
    const p = peer(CONFIRMED);
    const answer = await approvals.handleApprovalMethod(
      'artefact.preview', { attachmentUid, locator: { lines: '2-3' }, transferId: 'phone-transfer-0001' }, p.ctx,
    ) as { transferId: string; total: number; kind: string };
    assert.equal(answer.transferId, 'phone-transfer-0001');
    assert.equal(answer.kind, 'text');
    assert.equal(p.sent.length, answer.total);
    const preview = reassemble(p.sent, 'phone-transfer-0001') as Extract<import('./mobile-approvals').PhonePreview, { kind: 'text' }>;
    assert.equal(preview.name, 'totals.csv');
    const text = preview.sections.map((s) => s.body).join('\n');
    assert.match(text, /EMEA/);
    assert.doesNotMatch(text, /AMER/, 'only the cited lines');
  });

  test('a large preview is split so no chunk comes near the phone\'s 64 KB message cap', async () => {
    const rows = Array.from({ length: 4000 }, (_, i) => `row${i},${'x'.repeat(20)}`).join('\n');
    fs.writeFileSync(path.join(project, 'out', 'big.csv'), `name,value\n${rows}\n`);
    const { attachmentUid } = await submitted('Big sheet', 'out/big.csv', null);
    const p = peer(CONFIRMED);
    const answer = await approvals.handleApprovalMethod(
      'artefact.preview', { attachmentUid, transferId: 'phone-transfer-0002' }, p.ctx,
    ) as { total: number };
    assert.ok(answer.total > 1);
    for (const { message } of p.sent) assert.ok(JSON.stringify(message).length < 20_000);
    const preview = reassemble(p.sent, 'phone-transfer-0002') as Extract<import('./mobile-approvals').PhonePreview, { kind: 'text' }>;
    const chars = preview.sections.reduce((n, s) => n + s.body.length, 0);
    assert.ok(chars <= approvals.PREVIEW_TEXT_CHARS);
  });

  test('a transfer id the phone did not shape as one is refused before anything is read', async () => {
    const { attachmentUid } = await submitted('Bad id', 'out/totals.csv', null);
    const p = peer(CONFIRMED);
    await assert.rejects(
      approvals.handleApprovalMethod('artefact.preview', { attachmentUid, transferId: '../../x' }, p.ctx),
      /transferId/,
    );
    assert.equal(p.sent.length, 0);
  });

  test('an image goes scaled where the desktop can scale it, and as itself where it cannot', async () => {
    const { attachmentUid } = await submitted('Chart looks right', 'out/chart.png', null);
    const plain = await approvals.buildPreview(attachmentUid, null);
    assert.equal(plain.kind, 'image');
    assert.equal((plain as { scaled: boolean }).scaled, false);
    assert.equal((plain as { base64: string }).base64, PNG_1PX.toString('base64'));

    approvals.setPreviewImageScaler(() => ({ bytes: Buffer.from('scaled'), mime: 'image/jpeg' }));
    try {
      const scaled = await approvals.buildPreview(attachmentUid, { page: 2 });
      assert.deepEqual(
        { kind: scaled.kind, mime: (scaled as { mime: string }).mime, scaled: (scaled as { scaled: boolean }).scaled },
        { kind: 'image', mime: 'image/jpeg', scaled: true },
        'and a locator on an image does not stop it being shown',
      );
    } finally {
      approvals.setPreviewImageScaler(null);
    }
  });

  test('a cited cell comes with the rows and columns around it, and says which cells were cited', async () => {
    fs.writeFileSync(path.join(project, 'out', 'ledger.xlsx'), 'not read — the reader is stubbed');
    const { attachmentUid } = await submitted('EMEA in C14', 'out/ledger.xlsx', { sheet: 'Regional', range: 'C14' });
    let asked: unknown = null;
    const preview = await approvals.buildPreview(attachmentUid, { sheet: 'Regional', range: 'C14' }, async (_uid, at) => {
      asked = at;
      return {
        ok: true, kind: 'text', name: 'ledger.xlsx', itemUid: ITEM,
        reply: {
          ok: true, format: 'csv', where: 'sheet "Regional", A8:F20', outline: 'Sheets: Regional (A1:F40)',
          sections: [{ heading: 'Sheet "Regional", A8:F20', body: 'a,b\n1,2' }], notes: [],
        },
      };
    });
    assert.deepEqual(asked, { sheet: 'Regional', range: 'A8:F20' }, 'six rows and three columns either side, clamped at A1');
    assert.equal(preview.kind, 'text');
    const text = preview as Extract<import('./mobile-approvals').PhonePreview, { kind: 'text' }>;
    assert.deepEqual(text.grid, { firstRow: 8, firstCol: 1, cited: { from: { col: 3, row: 14 }, to: { col: 3, row: 14 } } });
    assert.equal(text.where, 'Regional!C14', 'the place cited, not the area read around it');
    assert.equal(text.sections[0].heading, 'Sheet "Regional"');
  });

  test('a locator carries only the fields the reader narrows by', () => {
    assert.deepEqual(
      approvals.sanitiseLocator({ sheet: 'Regional', range: 'C14', lines: [4, 6], path: '/etc/passwd', page: { x: 1 } }),
      { sheet: 'Regional', range: 'C14', lines: '4-6' },
    );
    assert.equal(approvals.sanitiseLocator('B2'), null);
  });
});

describe('the phone receives what the desktop sends (both halves of the protocol)', () => {
  test('the desktop\'s real chunks, out of order and with a repeat, assemble on the phone\'s real receiver', async () => {
    const { PreviewTransfers } = await import('../../../mobile/lib/preview-transfer');
    const rows = Array.from({ length: 3000 }, (_, i) => `r${i},${i * 7}`).join('\n');
    fs.writeFileSync(path.join(project, 'out', 'round-trip.csv'), `k,v\n${rows}\n`);
    const { attachmentUid } = await submitted('Round trip', 'out/round-trip.csv', null);

    const phone = new PreviewTransfers({ timeoutMs: 5_000, maxChunks: 800, maxChars: 12_000_000 });
    const body = phone.expect('phone-transfer-0003');
    const p = peer(CONFIRMED);
    const answer = await approvals.handleApprovalMethod(
      'artefact.preview', { attachmentUid, transferId: 'phone-transfer-0003' }, p.ctx,
    ) as { total: number };
    assert.ok(answer.total > 2, 'enough to be split');

    const messages = p.sent.map((s) => s.message).reverse();
    assert.equal(phone.accept({ ...messages[0], id: 'someone-elses-id' }), false, 'an id nobody asked for is not taken');
    for (const m of [messages[0], ...messages]) assert.equal(phone.accept(m), true);
    const preview = JSON.parse(await body);
    assert.equal(preview.kind, 'text');
    assert.equal(preview.name, 'round-trip.csv');
    assert.equal(phone.waiting, 0);
  });

  test('a transfer that breaks its shape, or its cap, fails instead of assembling', async () => {
    const { PreviewTransfers } = await import('../../../mobile/lib/preview-transfer');
    const phone = new PreviewTransfers({ timeoutMs: 5_000, maxChunks: 4, maxChars: 10 });

    const changing = phone.expect('changing-total-01');
    phone.accept({ cmd: 'preview.chunk', id: 'changing-total-01', seq: 0, total: 2, data: 'a' });
    phone.accept({ cmd: 'preview.chunk', id: 'changing-total-01', seq: 1, total: 3, data: 'b' });
    await assert.rejects(changing, /malformed/);

    const tooMany = phone.expect('too-many-chunks-1');
    phone.accept({ cmd: 'preview.chunk', id: 'too-many-chunks-1', seq: 0, total: 5, data: 'a' });
    await assert.rejects(tooMany, /malformed/);

    const tooBig = phone.expect('too-big-transfer1');
    phone.accept({ cmd: 'preview.chunk', id: 'too-big-transfer1', seq: 0, total: 2, data: '123456' });
    phone.accept({ cmd: 'preview.chunk', id: 'too-big-transfer1', seq: 1, total: 2, data: '789012' });
    await assert.rejects(tooBig, /larger than the phone accepts/);

    const slow = new PreviewTransfers({ timeoutMs: 20, maxChunks: 4, maxChars: 100 }).expect('never-arrives-01');
    await assert.rejects(slow, /did not arrive in time/);
  });
});
