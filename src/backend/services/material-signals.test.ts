/**
 * Phase 32 A6.3 — signals from tasks' materials: each rule, one signal per
 * material naming every task, and nothing from one task alone.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeMaterialSignals, type MaterialTaskInput } from './material-signals';
import { briefLine, kindWords, sideWords } from '../../shared/lib/signal-words';

const V1 = 'a'.repeat(64);
const V2 = 'b'.repeat(64);
const SALES = 'data/sales-2026.xlsx';

function task(id: string, title: string, over: Partial<MaterialTaskInput> = {}): MaterialTaskInput {
  return { id: `task:${id}`, title, brief: [SALES], reads: [], outputs: [], cited: [], ...over };
}
const read = (sha256: string | null, owner = 'task:report', ownerTitle = 'Q3 report', path = SALES) => ({ path, sha256, owner, ownerTitle });
const label = (root: string) => root;

describe('material signals', () => {
  test('one task and its own file raise nothing, whatever changed', () => {
    const alone = task('report', 'Q3 report', {
      reads: [read(V1)],
      outputs: ['out/report.docx'],
      cited: [{ path: SALES, part: 'Summary!B2:F9', sha256: V1, signedOff: true }],
    });
    assert.deepEqual(computeMaterialSignals([alone], { [SALES]: V2 }), []);
  });

  test('contract: changed since two tasks cited it; high when one was signed off', () => {
    const report = task('report', 'Q3 report', { reads: [read(V1)], cited: [{ path: SALES, part: 'Summary!B2:F9', sha256: V1, signedOff: true }] });
    const pack = task('pack', 'Board pack', { reads: [read(V1)], cited: [{ path: SALES, part: 'Summary!B2:F9', sha256: V1, signedOff: false }] });
    const [s, ...rest] = computeMaterialSignals([pack, report], { [SALES]: V2 });
    assert.equal(rest.length, 0, 'one signal per material');
    assert.equal(s.kind, 'contract');
    assert.equal(s.severity, 'high');
    assert.deepEqual(s.workstreams, ['task:pack', 'task:report']);
    assert.deepEqual(s.subject, {
      material: SALES, parts: ['Summary!B2:F9'], citedBy: ['task:pack', 'task:report'], signedOff: ['task:report'],
      labels: { 'task:pack': 'Board pack', 'task:report': 'Q3 report' },
    });
    assert.equal(s.summary, '`data/sales-2026.xlsx` changed. 2 tasks cite Summary!B2:F9; 1 was already signed off');
    assert.equal(kindWords(s), 'Changed material');
    assert.deepEqual(sideWords(s, label).map((x) => x.words), [
      'Board pack cites Summary!B2:F9 of data/sales-2026.xlsx, as it was before it changed.',
      'Q3 report cites Summary!B2:F9 of data/sales-2026.xlsx, as it was before it changed, and a person already signed that off.',
    ]);

    // Nobody signed off: medium.
    const unsigned = task('report', 'Q3 report', { reads: [read(V1)], cited: [{ path: SALES, part: 'Summary!B2:F9', sha256: V1, signedOff: false }] });
    assert.equal(computeMaterialSignals([pack, unsigned], { [SALES]: V2 })[0].severity, 'medium');
    // Cited against the version that is there now: nothing to say.
    assert.deepEqual(computeMaterialSignals([pack, report], { [SALES]: V1 }).filter((x) => x.kind === 'contract'), []);
  });

  test('contract: one task cites it and another reads it', () => {
    const report = task('report', 'Q3 report', { cited: [{ path: SALES, part: 'Summary!B2:F9', sha256: V1, signedOff: false }] });
    const pack = task('pack', 'Board pack', { reads: [read(V2)] });
    const [s] = computeMaterialSignals([report, pack], { [SALES]: V2 });
    assert.equal(s.kind, 'contract');
    assert.equal(s.summary, '`data/sales-2026.xlsx` changed. “Q3 report” cites Summary!B2:F9. “Board pack” uses it too');
    assert.equal(sideWords(s, label).find((x) => x.root === 'task:pack')!.words, 'Board pack uses data/sales-2026.xlsx.');
  });

  test('version-split: two tasks last read different versions', () => {
    const report = task('report', 'Q3 report', { reads: [read(V1)] });
    const pack = task('pack', 'Board pack', { reads: [read(V2)] });
    const [s, ...rest] = computeMaterialSignals([report, pack], { [SALES]: V2 });
    assert.equal(rest.length, 0);
    assert.equal(s.kind, 'version-split');
    assert.equal(s.severity, 'medium');
    assert.deepEqual(s.subject.readVersions, { 'task:pack': 'current', 'task:report': 'earlier' });
    assert.equal(s.summary, '“Board pack”, “Q3 report” read different versions of `data/sales-2026.xlsx`; “Board pack” has the current one');
    assert.equal(kindWords(s), 'Different versions');
    assert.deepEqual(sideWords(s, label).map((x) => x.words), [
      'Board pack read the current version of data/sales-2026.xlsx.',
      'Q3 report read an earlier version of data/sales-2026.xlsx.',
    ]);
    // Neither has the current one.
    assert.match(computeMaterialSignals([report, pack], { [SALES]: 'c'.repeat(64) })[0].summary, /neither has the current one$/);
  });

  test('stale-base: it changed after both read it, and neither read it since', () => {
    const report = task('report', 'Q3 report', { reads: [read(V1)] });
    const pack = task('pack', 'Board pack', { reads: [read(V1)] });
    const [s, ...rest] = computeMaterialSignals([report, pack], { [SALES]: V2 });
    assert.equal(rest.length, 0);
    assert.equal(s.kind, 'stale-base');
    assert.equal(s.severity, 'low');
    assert.equal(s.summary, '`data/sales-2026.xlsx` changed after “Board pack”, “Q3 report” read it, and neither has read it since');
    assert.equal(kindWords(s), 'Material changed');
    // Both on the current version: nothing.
    assert.deepEqual(computeMaterialSignals([report, pack], { [SALES]: V1 }), []);
    // One reader alone: nothing.
    assert.deepEqual(computeMaterialSignals([report], { [SALES]: V2 }), []);
  });

  test('collision: two tasks record the same output', () => {
    const report = task('report', 'Q3 report', { outputs: ['out/board.pptx'] });
    const pack = task('pack', 'Board pack', { outputs: ['out/board.pptx', 'out/notes.md'] });
    const [s, ...rest] = computeMaterialSignals([report, pack], {});
    assert.equal(rest.length, 0);
    assert.deepEqual([s.kind, s.severity, s.subject.material, s.workstreams], ['collision', 'medium', 'out/board.pptx', ['task:pack', 'task:report']]);
    assert.equal(s.summary, '“Board pack”, “Q3 report” both record `out/board.pptx` as their output');
    assert.equal(kindWords(s), 'Same output');
  });

  test('drift: a task reads another task\'s material that is not in its brief', () => {
    const pack = task('pack', 'Board pack', { brief: [], reads: [read(V1)] });
    const [s, ...rest] = computeMaterialSignals([pack], { [SALES]: V1 });
    assert.equal(rest.length, 0);
    assert.deepEqual([s.kind, s.severity, s.workstreams], ['drift', 'low', ['task:pack', 'task:report']]);
    assert.equal(s.subject.by, 'task:pack');
    assert.equal(s.summary, '“Board pack” read `data/sales-2026.xlsx`, which is not in its brief (given to “Q3 report”)');
    assert.equal(kindWords(s), 'Outside its brief');
    assert.deepEqual(sideWords(s, label).map((x) => x.words), [
      'Board pack read data/sales-2026.xlsx, which its brief does not include.',
      'Q3 report was given it.',
    ]);
    // In its brief (a plan page's material, say): nothing.
    assert.deepEqual(computeMaterialSignals([task('pack', 'Board pack', { reads: [read(V1)] })], { [SALES]: V1 }), []);
    // Its own file: nothing.
    assert.deepEqual(computeMaterialSignals([task('report', 'Q3 report', { brief: [], reads: [read(V1)] })], { [SALES]: V1 }), []);
  });

  test('ids are stable, and renaming a task changes the words but not the shape', () => {
    const mk = (title: string) => [task('report', title, { reads: [read(V1)] }), task('pack', 'Board pack', { reads: [read(V2)] })];
    const [a] = computeMaterialSignals(mk('Q3 report'), { [SALES]: V2 });
    const [b] = computeMaterialSignals(mk('Q3 report (final)'), { [SALES]: V2 });
    assert.equal(a.id, b.id);
    assert.equal(a.shape, b.shape);
    assert.notEqual(a.summary, b.summary);
    // A different material is a different signal.
    const [c] = computeMaterialSignals(mk('Q3 report').map((t) => ({ ...t, brief: ['x.xlsx'], reads: t.reads.map((r) => ({ ...r, path: 'x.xlsx' })) })), { 'x.xlsx': V2 });
    assert.notEqual(a.id, c.id);
  });

  test('each task\'s own line, as its Brief and its agent read it (A6.4)', () => {
    const report = task('report', 'Q3 report', { reads: [read(V1)], cited: [{ path: SALES, part: 'Summary!B2:F9', sha256: V1, signedOff: true }] });
    const pack = task('pack', 'Board pack', { reads: [read(V2)] });
    const [contract] = computeMaterialSignals([report, pack], { [SALES]: V2 });
    assert.equal(briefLine(contract, 'task:report'),
      'data/sales-2026.xlsx changed since this task cited Summary!B2:F9. A person had already signed this task\'s citation off. “Board pack” uses it too.');
    assert.equal(briefLine(contract, 'task:pack'),
      'data/sales-2026.xlsx changed since “Q3 report” cited Summary!B2:F9. “Q3 report” had already been signed off. This task uses it too.');

    const [split] = computeMaterialSignals([task('report', 'Q3 report', { reads: [read(V1)] }), pack], { [SALES]: V2 });
    assert.equal(briefLine(split, 'task:pack'), 'This task read the current data/sales-2026.xlsx; “Q3 report” worked from an earlier version.');
    assert.equal(briefLine(split, 'task:report'), 'This task worked from an earlier version of data/sales-2026.xlsx; “Board pack” has the current one.');

    const [stale] = computeMaterialSignals([task('report', 'Q3 report', { reads: [read(V1)] }), task('pack', 'Board pack', { reads: [read(V1)] })], { [SALES]: V2 });
    assert.equal(briefLine(stale, 'task:report'), 'data/sales-2026.xlsx changed after this task and “Board pack” read it.');

    const [collision] = computeMaterialSignals([task('report', 'Q3 report', { outputs: ['out/board.pptx'] }), task('pack', 'Board pack', { outputs: ['out/board.pptx'] })], {});
    assert.equal(briefLine(collision, 'task:pack'), 'This task and “Q3 report” both record out/board.pptx as their output.');

    const [drift] = computeMaterialSignals([task('pack', 'Board pack', { brief: [], reads: [read(V1)] })], { [SALES]: V1 });
    assert.equal(briefLine(drift, 'task:pack'), 'This task read data/sales-2026.xlsx, which “Q3 report” was given, not this task.');
    assert.equal(briefLine(drift, 'task:report'), '“Board pack” read data/sales-2026.xlsx, which this task was given.');
  });
});
