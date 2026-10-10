import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planReload } from './plan-reload';

test('one plan, one burst: one notice that says how many files changed', () => {
  assert.deepEqual(planReload([{ planUid: 'p1', source: 'file-watcher', files: 40, warnings: [] }]), {
    planUids: ['p1'],
    title: 'Plan reloaded from disk',
    message: '40 files changed.',
  });
});

test('a pull touching several plans is one notice naming how many, not one each', () => {
  const r = planReload([
    { planUid: 'p1', files: 3 },
    { planUid: 'p2', files: 1 },
    { planUid: 'p3', files: 7, warnings: ['bad phase'] },
    { planUid: 'p1', files: 2 },
  ]);
  assert.deepEqual(r.planUids, ['p1', 'p2', 'p3']);
  assert.equal(r.title, '3 plans reloaded from disk');
  assert.equal(r.message, '13 files changed, 1 warning.');
});

test('an older backend that does not say how many files still gets a plain notice', () => {
  assert.deepEqual(planReload([{ planUid: 'p1' }]), { planUids: ['p1'], title: 'Plan reloaded from disk', message: 'External change picked up.' });
  assert.equal(planReload([{ planUid: 'p1', files: 1 }]).message, '1 file changed.');
});
