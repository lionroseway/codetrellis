import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskFiles } from './task-rules';

test('a task\'s files are its file specs, project-relative: scoped, moved, and never a folder or outside the project', () => {
  assert.deepEqual(taskFiles({
    scopePath: 'packages/web',
    fileSpecs: [
      { path: 'src/api.ts', action: 'modify' },
      { path: './src/cart.ts', action: 'create' },
      { path: 'src/old.ts', action: 'move', moveTo: 'packages/web/src/new.ts' },
      { path: 'src/', action: 'modify', isDir: true },
      { path: '../../../etc/passwd', action: 'modify' },
    ],
  }, '/work/shop'), ['packages/web/src/api.ts', 'packages/web/src/cart.ts', 'packages/web/src/old.ts', 'packages/web/src/new.ts']);
  assert.deepEqual(taskFiles({ fileSpecs: [{ path: '/work/shop/src/a.ts', action: 'modify' }, { path: '/elsewhere/b.ts', action: 'modify' }] }, '/work/shop'), ['src/a.ts']);
  assert.deepEqual(taskFiles({}, '/work/shop'), []);
});
