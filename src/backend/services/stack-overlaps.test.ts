/**
 * Phase 32 B6.3 — where two plans in the stack meet, declared or actual.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AwarenessSignal, PlanItem } from '../../shared/types';
import { declaredFootprint, stackOverlaps, type PlanFootprint } from './stack-overlaps';

const action = (over: Partial<PlanItem>) => ({ uid: 'x', planUid: 'p', kind: 'action', title: 'x', status: 'pending', ...over }) as PlanItem;

test('a plan declares the files and functions its unfinished tasks name', () => {
  const { files, symbols } = declaredFootprint([
    action({ fileSpecs: [{ path: 'src/a.ts', action: 'modify' }, { path: 'src/dir', action: 'modify', isDir: true }] }),
    action({ symbolSpecs: [{ name: 'validate', kind: 'function', action: 'modify', filePath: 'src/v.ts' }] }),
    action({ status: 'done', fileSpecs: [{ path: 'src/finished.ts', action: 'modify' }] }),
    { ...action({ fileSpecs: [{ path: 'src/page.ts', action: 'modify' }] }), kind: 'object' } as PlanItem,
  ]);
  assert.deepEqual([...files].sort(), ['src/a.ts', 'src/v.ts']);
  assert.deepEqual([...symbols], [['src/v.ts#validate', 'validate']]);
});

const plan = (uid: string, label: string, over: Partial<PlanFootprint> = {}): PlanFootprint =>
  ({ uid, label, files: new Set(), symbols: new Map(), roots: [], ...over });

const signal = (over: Partial<AwarenessSignal>) => ({
  id: 's1', kind: 'contract', severity: 'high', subject: {}, workstreams: ['/wt/billing', '/wt/exports'],
  summary: 'billing-v2 changes validateCreateUser; exports imports it', firstSeen: 0, lastSeen: 0, state: 'open', ...over,
}) as AwarenessSignal;

test('two plans that plan to change the same file overlap, in words, from each side', () => {
  const out = stackOverlaps([
    plan('b', 'Billing v2', { files: new Set(['src/a.ts', 'src/b.ts']), symbols: new Map([['src/v.ts#validate', 'validate']]) }),
    plan('e', 'JIRA-150', { files: new Set(['src/a.ts']), symbols: new Map([['src/v.ts#validate', 'validate']]) }),
    plan('o', 'Other', { files: new Set(['src/z.ts']) }),
  ], []);
  const [fromBilling] = out.get('b')!;
  assert.equal(fromBilling.words, '⚠ overlaps JIRA-150');
  assert.deepEqual(fromBilling.declared, { files: ['src/a.ts'], symbols: ['validate'] });
  assert.equal(fromBilling.detail, 'Both plan to change validate and src/a.ts.');
  assert.equal(fromBilling.high, false);
  assert.equal(out.get('e')![0].words, '⚠ overlaps Billing v2');
  assert.deepEqual(out.get('o'), []);
});

test('an open signal between their lines of work is an actual overlap; a resolved one is not', () => {
  const plans = [
    plan('b', 'Billing v2', { roots: ['/wt/billing'] }),
    plan('e', 'JIRA-150', { roots: ['/wt/exports'] }),
  ];
  const [overlap] = stackOverlaps(plans, [signal({})]).get('e')!;
  assert.equal(overlap.words, '⚠ overlaps Billing v2');
  assert.equal(overlap.high, true);
  assert.deepEqual(overlap.actual.map((s) => s.id), ['s1']);
  assert.equal(overlap.detail, 'Open now: billing-v2 changes validateCreateUser; exports imports it');

  assert.deepEqual(stackOverlaps(plans, [signal({ state: 'resolved' })]).get('e'), []);
  assert.deepEqual(stackOverlaps(plans, [signal({ kind: 'drift' })]).get('e'), []);
});

test('two spellings of one folder are the same line of work', () => {
  const plans = [plan('b', 'B', { roots: ['/link/billing'] }), plan('e', 'E', { roots: ['/wt/exports'] })];
  const canon = (r: string) => r.replace('/link/', '/wt/');
  assert.equal(stackOverlaps(plans, [signal({})], canon).get('b')!.length, 1);
});
