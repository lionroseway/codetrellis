/**
 * A plan's budget on the phone, and marking an agent's change seen there
 * (Phase 32, owner's request).
 *
 * What has to hold: the phone gets the same flagged changes as the desktop
 * chip, in the same words; marking one seen takes a pairing confirmed on
 * the desktop, is recorded in the person's name and in the device audit,
 * and tells the desktop windows; and nothing about another plan or an
 * unknown change is accepted.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-mobile-budget-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });

let db: typeof import('./database');
let budgets: typeof import('./budget-service');
let mobile: typeof import('./mobile-budget');
let devices: typeof import('./paired-device-service');
let audit: typeof import('./peer-audit-service');

const PLAN = 'b0d9e700-0000-4000-8000-000000000001';
const OTHER = 'b0d9e700-0000-4000-8000-000000000002';
const CONFIRMED = 'AA:BB:CC:budget-confirmed';
const UNCONFIRMED = 'AA:BB:CC:budget-unconfirmed';
const AGENT = { actor: 'codex', actorType: 'mcp', channel: 'mcp' as const };
const PERSON = { actor: 'saif@example.com', actorType: 'human', channel: 'desktop' as const };

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

before(async () => {
  db = await import('./database');
  await db.initDatabase();
  budgets = await import('./budget-service');
  mobile = await import('./mobile-budget');
  devices = await import('./paired-device-service');
  audit = await import('./peer-audit-service');
  const now = Date.now();
  for (const uid of [PLAN, OTHER]) {
    db.getDb().run(
      `INSERT INTO plans (uid, title, status, author, author_type, project_path, created_at, updated_at)
       VALUES (?, 'Q3 board pack', 'in_progress', 't', 'human', ?, ?, ?)`,
      [uid, tmp, now, now],
    );
  }
  const base = {
    pairingId: 'p', deviceType: 'mobile' as const, pairedAt: new Date().toISOString(),
    lastConnected: null, sharedSecret: 'x', instanceId: null,
  };
  devices.upsertPairedDevice({ ...base, fingerprint: CONFIRMED, alias: 'Saif phone', confirmedAt: new Date().toISOString() });
  devices.upsertPairedDevice({ ...base, fingerprint: UNCONFIRMED, alias: 'Unconfirmed', confirmedAt: null });

  budgets.setBudget({ planUid: PLAN, minutes: 120, by: PERSON });
  budgets.setBudget({ planUid: PLAN, minutes: 240, exempt: true, by: AGENT });
  budgets.setBudget({ planUid: OTHER, minutes: 60, by: AGENT });
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('budget.get', () => {
  test('the ceiling, the spend, and the agent\'s change in the desktop chip\'s words', async () => {
    const got = await mobile.handleBudgetMethod('budget.get', { planUid: PLAN }, peer(CONFIRMED).ctx) as import('./mobile-budget').PhoneBudget;
    assert.deepEqual(got.budget, { minutes: 240, costUsd: null, exempt: true });
    assert.equal(got.spentMinutes, 0);
    assert.equal(got.spentCostUsd, null, 'an unknown cost stays unknown');
    // The person's own change is not flagged; the agent's is.
    assert.equal(got.flaggedChanges.length, 1);
    assert.deepEqual(
      { by: got.flaggedChanges[0].by, byType: got.flaggedChanges[0].byType, words: got.flaggedChanges[0].words },
      { by: 'codex', byType: 'mcp', words: 'raised the time ceiling 2h → 4h, exempted the plan from its ceiling' },
    );
  });

  test('an unknown or missing plan is refused', async () => {
    await assert.rejects(mobile.handleBudgetMethod('budget.get', { planUid: 'no-such-plan' }, peer(CONFIRMED).ctx), /Plan not found/);
    await assert.rejects(mobile.handleBudgetMethod('budget.get', {}, peer(CONFIRMED).ctx), /planUid is required/);
  });
});

describe('budget.acknowledge', () => {
  test('needs a pairing confirmed on the desktop', async () => {
    const [change] = budgets.flaggedBudgetChanges(PLAN);
    await assert.rejects(
      mobile.handleBudgetMethod('budget.acknowledge', { planUid: PLAN, changeId: change.id }, peer(UNCONFIRMED).ctx),
      /pairing confirmed on the desktop/,
    );
    assert.equal(budgets.flaggedBudgetChanges(PLAN).length, 1, 'still flagged');
  });

  test('another plan\'s change, or one that does not exist, is refused', async () => {
    const [theirs] = budgets.flaggedBudgetChanges(OTHER);
    await assert.rejects(
      mobile.handleBudgetMethod('budget.acknowledge', { planUid: PLAN, changeId: theirs.id }, peer(CONFIRMED).ctx),
      /No such budget change on this plan/,
    );
    await assert.rejects(
      mobile.handleBudgetMethod('budget.acknowledge', { planUid: PLAN, changeId: 'x' }, peer(CONFIRMED).ctx),
      /changeId must be a number/,
    );
    assert.equal(budgets.flaggedBudgetChanges(OTHER).length, 1);
  });

  test('from a confirmed phone: unflagged, in the person\'s name, audited, and the desktop told', async () => {
    const [change] = budgets.flaggedBudgetChanges(PLAN);
    const p = peer(CONFIRMED);
    const after = await mobile.handleBudgetMethod('budget.acknowledge', { planUid: PLAN, changeId: change.id }, p.ctx) as import('./mobile-budget').PhoneBudget;
    assert.deepEqual(after.flaggedChanges, []);

    const recorded = budgets.listBudgetChanges(PLAN).find((c) => c.id === change.id)!;
    assert.equal(recorded.flagged, false);
    assert.ok(recorded.acknowledgedBy, 'recorded who saw it');
    assert.ok(recorded.acknowledgedAt);

    const entry = audit.listPeerAudit({ fingerprint: CONFIRMED }).find((e) => e.method === 'budget.acknowledge');
    assert.equal(entry?.kind, 'decision');
    assert.equal(entry?.alias, 'Saif phone');
    assert.deepEqual(p.broadcasts, [{ type: 'plan-budget-changed', data: { planUid: PLAN, acknowledged: change.id } }]);
  });
});
