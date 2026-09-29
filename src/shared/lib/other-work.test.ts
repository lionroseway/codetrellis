/**
 * "Other work in flight" in words (Phase 32 A5.2): which overlaps a review
 * lists, what it says happened to each, and what merging means.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { otherWorkInFlight, otherWorkMarkdown } from './other-work';
import type { AwarenessSignal } from '../types';

const BILLING = '/work/acme-billing';
const CHECKOUT = '/work/acme-checkout';
const AUTH = '/work/acme-auth';
const label = (root: string) => ({ [BILLING]: 'billing-v2', [CHECKOUT]: 'checkout-fix', [AUTH]: 'auth-refresh' }[root] ?? root);

function signal(over: Partial<AwarenessSignal>): AwarenessSignal {
  return {
    id: 'x', kind: 'collision', severity: 'medium', subject: { file: 'src/a.ts' }, workstreams: [BILLING, CHECKOUT].sort(),
    summary: '', firstSeen: 1, lastSeen: 2, state: 'open', ...over,
  } as AwarenessSignal;
}

const contract = signal({
  id: 'k1', kind: 'contract', severity: 'high',
  subject: { file: 'src/billing/invoice.ts', symbol: 'createInvoice', by: BILLING, change: 'signature', signature: { before: '(order)', after: '(order, currency)' }, importers: ['src/checkout/submit.ts'] },
});

describe('otherWorkInFlight', () => {
  test('the changer is told who will need updating; the importer is told to merge after', () => {
    const forBilling = otherWorkInFlight({ root: BILLING, name: 'billing-v2' }, [contract], label);
    assert.equal(forBilling.entries[0].merge, 'Merging this changes createInvoice; checkout-fix imports it and will need updating.');
    assert.equal(forBilling.openHigh, 1);
    const forCheckout = otherWorkInFlight({ root: CHECKOUT, name: 'checkout-fix' }, [contract], label);
    assert.equal(forCheckout.entries[0].merge, 'This imports createInvoice, which billing-v2 changes: merge after it and update, or ask it to keep the old form.');
  });

  test('only overlaps naming the workstream under review are listed', () => {
    const other = signal({ id: 'c9', workstreams: [AUTH, CHECKOUT].sort() });
    const got = otherWorkInFlight({ root: BILLING, name: 'billing-v2' }, [contract, other], label);
    assert.deepEqual(got.entries.map((e) => e.signalId), ['k1']);
  });

  test('what happened to each: intended is a decision, acknowledged carries the agent\'s note, fixed is history', () => {
    const intended = signal({ id: 'i', state: 'intended', stateBy: { actor: 'sam', actorType: 'human', channel: 'phone' } });
    const acked = signal({
      id: 'a', state: 'acknowledged', stateBy: { actor: 'sam', actorType: 'human', channel: 'desktop' },
      told: [{ sessionId: 's1', agentType: 'codex', toldAt: 1, note: 'I will pass the currency from the cart.' }],
    });
    const fixed = signal({ id: 'f', state: 'resolved' });
    const open = signal({ id: 'o', severity: 'low' });
    const got = otherWorkInFlight({ root: BILLING, name: 'billing-v2' }, [fixed, intended, acked, open], label);
    assert.deepEqual(got.entries.map((e) => [e.signalId, e.outcome]), [['o', 'open'], ['a', 'acknowledged'], ['i', 'intended'], ['f', 'fixed']]);
    assert.equal(got.entries[2].outcomeWords, 'Marked intended by the person, from their phone: a decision, not an accident.');
    assert.deepEqual(got.entries[1].notes, ['codex: I will pass the currency from the cart.']);
    assert.equal(got.entries[3].outcomeWords, 'Fixed: what caused it is gone.');
    assert.equal(got.openHigh, 0);
  });

  test('an answer through the local API says it was not verified as the person', () => {
    const got = otherWorkInFlight({ root: BILLING, name: 'billing-v2' }, [signal({ state: 'acknowledged', stateBy: { actor: 'x', actorType: 'unverified', channel: 'local-api' } })], label);
    assert.equal(got.entries[0].outcomeWords, 'Acknowledged by someone through the local API, not verified as the person.');
  });

  test('only the five most recent fixed overlaps are kept', () => {
    const many = Array.from({ length: 8 }, (_, i) => signal({ id: `f${i}`, state: 'resolved' }));
    assert.equal(otherWorkInFlight({ root: BILLING, name: 'billing-v2' }, many, label).entries.length, 5);
  });
});

describe('otherWorkMarkdown', () => {
  test('each overlap in the desktop\'s words, with the merge line and what happened', () => {
    const md = otherWorkMarkdown(otherWorkInFlight({ root: BILLING, name: 'billing-v2' }, [contract], label));
    assert.match(md, /^### Other work in flight\n/);
    assert.match(md, /- \*\*HIGH · Changed signature\.\*\* billing-v2 changed createInvoice's signature in src\/billing\/invoice\.ts: createInvoice\(order\) is now createInvoice\(order, currency\)\. checkout-fix imports it, in 1 file: src\/checkout\/submit\.ts\./);
    assert.match(md, /\n {2}Merging this changes createInvoice; checkout-fix imports it and will need updating\.\n {2}Open: nobody has answered it yet\./);
  });

  test('nothing overlapping says so', () => {
    assert.match(otherWorkMarkdown(otherWorkInFlight({ root: BILLING, name: 'billing-v2' }, [], label)), /No other line of work overlaps with `billing-v2`\./);
  });
});
