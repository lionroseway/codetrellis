import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPlacePath, locateStored, PLANS_PREFIX } from './material-place';
import { validateImportedAttachment } from './task-attachments-service';

test('a stored material path is project-relative, or a place in the plans folder', () => {
  assert.equal(PLANS_PREFIX, 'plans://');
  assert.equal(isPlacePath('plans://Materials/sales.csv'), true);
  assert.equal(isPlacePath('data/sales.csv'), false);
  assert.deepEqual(locateStored('data/sales.csv', '/work/app'), { root: '/work/app', rel: 'data/sales.csv' });
  assert.equal(locateStored('/etc/passwd', '/work/app'), null);
  assert.equal(locateStored('https://example.com/x.csv', '/work/app'), null);
  assert.equal(locateStored('', '/work/app'), null);
});

test('a plan file\'s material place never climbs out of the folder', () => {
  const ok = validateImportedAttachment({ kind: 'file_ref', value: 'plans://Materials/sales.csv' }, 'item-1');
  assert.ok(!('refused' in ok), JSON.stringify(ok));
  for (const value of ['plans://../secrets.csv', 'plans://Materials/../../x', 'plans://a//b']) {
    const v = validateImportedAttachment({ kind: 'file_ref', value }, 'item-1');
    assert.deepEqual(v, { refused: 'path leaves the plans folder' }, value);
  }
  assert.deepEqual(validateImportedAttachment({ kind: 'file_ref', value: 'gopher://x' }, 'item-1'),
    { refused: 'absolute paths and URLs are not file references; use a path inside the project' });
});
