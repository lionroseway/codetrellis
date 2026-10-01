import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playForwardOf, type ForwardPlan } from './play-forward';
import type { PlanItem } from '../../shared/types';

const task = (uid: string, title: string, extra: Partial<PlanItem> = {}): PlanItem =>
  ({ uid, planUid: 'p', parentUid: null, kind: 'action', title, body: '', status: 'pending', sortOrder: 0, createdAt: 1, updatedAt: 1, ...extra }) as PlanItem;
const spec = (path: string, action: 'create' | 'modify' | 'delete' | 'move' = 'modify', moveTo?: string) => ({ path, action, ...(moveTo ? { moveTo } : {}) });
const none = () => new Map<string, string[]>();
const EXISTING = new Set(['src/billing/invoice.ts', 'src/billing/tax.ts', 'src/auth/session.ts', 'src/old.ts']);

test('two plans planning to change one file overlap, in words; a done task plans nothing', () => {
  const plans: ForwardPlan[] = [
    { uid: 'a', label: 'JIRA-142', items: [task('a1', 'Round VAT per line', { fileSpecs: [spec('src/billing/invoice.ts')] }), task('a2', 'Old work', { status: 'done', fileSpecs: [spec('src/billing/tax.ts')] })] },
    { uid: 'b', label: 'JIRA-150', items: [task('b1', 'Add currency', { fileSpecs: [spec('src/billing/invoice.ts'), spec('src/billing/currency.ts', 'create')] })] },
  ];
  const f = playForwardOf('/p', plans, EXISTING, none);
  assert.equal(f.overlaps.length, 1);
  assert.deepEqual(
    { kind: f.overlaps[0].kind, serious: f.overlaps[0].serious, sequenced: f.overlaps[0].sequenced, words: f.overlaps[0].words },
    { kind: 'file', serious: false, sequenced: false, words: '◇ planned overlap: JIRA-142 and JIRA-150 both plan to change src/billing/invoice.ts' },
  );
  assert.deepEqual(f.overlaps[0].plans.map((p) => [p.label, p.tasks.map((t) => t.title)]), [['JIRA-142', ['Round VAT per line']], ['JIRA-150', ['Add currency']]]);
  // tax.ts is a done task's: the code now, not the future.
  assert.deepEqual(f.files.map((x) => [x.path, x.change]), [['src/billing/currency.ts', 'create'], ['src/billing/invoice.ts', 'modify']]);
  assert.deepEqual(f.projection.ghostFiles.map((g) => g.path), ['src/billing/currency.ts']);
  assert.deepEqual(f.plans, [{ uid: 'a', label: 'JIRA-142', ahead: 1 }, { uid: 'b', label: 'JIRA-150', ahead: 1 }]);
  assert.equal(f.words, 'Planned by 2 active plans · 1 file to change, 1 to create · 1 planned overlap');
});

test('a function both name is serious, and stands for its file; deleting what another changes is serious', () => {
  const plans: ForwardPlan[] = [
    { uid: 'a', label: 'auth-refresh', items: [task('a1', 'Refresh', { symbolSpecs: [{ name: 'refreshToken', filePath: 'src/auth/session.ts' }] as PlanItem['symbolSpecs'] }), task('a2', 'Retire old', { fileSpecs: [spec('src/old.ts', 'delete')] })] },
    { uid: 'b', label: 'billing-v2', items: [task('b1', 'Charge', { symbolSpecs: [{ name: 'refreshToken', filePath: 'src/auth/session.ts' }] as PlanItem['symbolSpecs'], fileSpecs: [spec('src/old.ts')] })] },
  ];
  const f = playForwardOf('/p', plans, EXISTING, none);
  assert.deepEqual(f.overlaps.map((o) => [o.kind, o.serious, o.words]), [
    ['symbol', true, '◇ planned overlap: auth-refresh and billing-v2 both plan to change refreshToken in src/auth/session.ts'],
    ['file', true, '◇ planned overlap: auth-refresh plans to delete src/old.ts, which billing-v2 plans to change'],
  ]);
  // The function's overlap stands for its file: no second one for session.ts.
  assert.equal(f.overlaps.filter((o) => o.file === 'src/auth/session.ts').length, 1);
  assert.equal(f.files.find((x) => x.path === 'src/old.ts')?.change, 'delete');
});

test('two plans relying on one spreadsheet overlap in words; a plan with nothing ahead does not', () => {
  const plans: ForwardPlan[] = [
    { uid: 'a', label: 'Q3 board pack', items: [task('a1', 'Summarise')] },
    { uid: 'b', label: 'Forecast refresh', items: [task('b1', 'Refresh forecast')] },
    { uid: 'c', label: 'Archive', items: [task('c1', 'Archived work', { status: 'done' })] },
  ];
  const materials = () => new Map([['a1', ['data/sales-2026.xlsx']], ['b1', ['data/sales-2026.xlsx']], ['c1', ['data/sales-2026.xlsx']]]);
  const f = playForwardOf('/p', plans, EXISTING, materials);
  assert.deepEqual(f.overlaps.map((o) => [o.kind, o.file, o.words]), [
    ['material', null, '◇ planned overlap: Q3 board pack and Forecast refresh both rely on data/sales-2026.xlsx'],
  ]);
});

test('an overlap whose tasks already wait on one another is sequenced, and says which waits', () => {
  const plans: ForwardPlan[] = [
    { uid: 'a', label: 'JIRA-142', items: [task('a1', 'Round VAT', { fileSpecs: [spec('src/billing/invoice.ts')] })] },
    { uid: 'b', label: 'JIRA-150', items: [task('b1', 'Add currency', { fileSpecs: [spec('src/billing/invoice.ts')], dependencies: ['a1'] })] },
  ];
  const f = playForwardOf('/p', plans, EXISTING, none);
  assert.equal(f.overlaps[0].sequenced, true);
  assert.equal(f.overlaps[0].words, '◇ planned overlap: JIRA-142 and JIRA-150 both plan to change src/billing/invoice.ts · sequenced: JIRA-150 waits on JIRA-142');
  assert.equal(f.words, 'Planned by 2 active plans · 1 file to change · 1 planned overlap (1 sequenced)');
});

test('a move is a removal and a new file; nothing planned says so; ids are stable', () => {
  const plans: ForwardPlan[] = [{ uid: 'a', label: 'Tidy', items: [task('a1', 'Move tax', { fileSpecs: [spec('src/billing/tax.ts', 'move', 'src/tax/index.ts')] })] }];
  const f = playForwardOf('/p', plans, EXISTING, none);
  assert.deepEqual(f.projection.removedFiles.map((r) => r.path), ['src/billing/tax.ts']);
  assert.deepEqual(f.projection.ghostFiles.map((r) => r.path), ['src/tax/index.ts']);
  assert.equal(playForwardOf('/p', [], EXISTING, none).words, 'No active plans: nothing is planned.');
  assert.equal(playForwardOf('/p', [{ uid: 'a', label: 'Tidy', items: [task('a1', 'Think')] }], EXISTING, none).words, 'Planned by 1 active plan · none of their tasks name a file or a material yet');
  const twice = () => playForwardOf('/p', [
    { uid: 'a', label: 'A', items: [task('a1', 'x', { fileSpecs: [spec('src/billing/invoice.ts')] })] },
    { uid: 'b', label: 'B', items: [task('b1', 'y', { fileSpecs: [spec('src/billing/invoice.ts')] })] },
  ], EXISTING, none).overlaps[0].id;
  assert.equal(twice(), twice());
});
