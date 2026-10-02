import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overlapsByFile, filePlannedMark, clusterPlannedMark, planOverlapLines } from './play-forward';
import type { PlayForward, PlannedOverlap } from '@shared/types/play-forward';

const overlap = (id: string, kind: PlannedOverlap['kind'], subject: string, file: string | null, serious = false, sequenced = false): PlannedOverlap => ({
  id, kind, subject, file, serious, sequenced,
  plans: [{ uid: 'a', label: 'JIRA-142', tasks: [] }, { uid: 'b', label: 'JIRA-150', tasks: [] }],
  words: `◇ planned overlap: JIRA-142 and JIRA-150 both plan to change ${subject}`,
  decisions: [], left: false,
});
const data = (overlaps: PlannedOverlap[]): PlayForward => ({
  project: '/p', plans: [], files: [], overlaps, words: '',
  projection: { ghostFiles: [], modifiedFiles: [], removedFiles: [], newEdges: [], removedEdges: [] },
});

test('a file in a planned overlap is marked with its words; a material is not on the graph', () => {
  const d = data([overlap('1', 'file', 'src/a.ts', 'src/a.ts'), overlap('2', 'material', 'data/b.xlsx', null)]);
  const byFile = overlapsByFile(d);
  assert.deepEqual(filePlannedMark(byFile, 'src/a.ts'), {
    title: '◇ planned overlap: JIRA-142 and JIRA-150 both plan to change src/a.ts', serious: false, sequenced: false, count: 1,
  });
  assert.equal(filePlannedMark(byFile, 'src/c.ts'), undefined);
  assert.deepEqual([...byFile.keys()], ['src/a.ts']);
});

test('a cluster sums its files once each; serious if any is; quiet only when all are sequenced', () => {
  const d = data([
    overlap('1', 'file', 'src/a.ts', 'src/a.ts', false, true),
    overlap('2', 'symbol', 'src/b.ts#pay', 'src/b.ts', true),
  ]);
  const m = clusterPlannedMark(overlapsByFile(d), ['src/a.ts', 'src/b.ts', 'src/a.ts']);
  assert.equal(m?.count, 2);
  assert.equal(m?.serious, true);
  assert.equal(m?.sequenced, false);
  assert.match(m!.title, /\(serious\)$/);
  assert.equal(clusterPlannedMark(overlapsByFile(d), ['src/z.ts']), undefined);
});

test('a plan lists its planned overlaps by the other plan and the short name', () => {
  const d = data([overlap('1', 'file', 'src/billing/invoice.ts', 'src/billing/invoice.ts'), overlap('2', 'symbol', 'src/b.ts#refreshToken', 'src/b.ts', true, true)]);
  assert.deepEqual(planOverlapLines(d, 'a').map((l) => l.words), ['◇ will overlap JIRA-150: invoice.ts', '◇ will overlap JIRA-150: refreshToken (sequenced)']);
  assert.deepEqual(planOverlapLines(d, 'b').map((l) => l.words)[0], '◇ will overlap JIRA-142: invoice.ts');
  assert.deepEqual(planOverlapLines(d, 'z'), []);
  assert.deepEqual(planOverlapLines(null, 'a'), []);
});
