import { test } from 'node:test';
import assert from 'node:assert/strict';
import { architectureMarkdown, callChanges, folderLinks, folderOf, packagesIn } from './review-architecture';

test('a file\'s folder is its first two segments, or its only one, or the root', () => {
  assert.deepEqual(['packages/web/src/api.ts', 'web/a.ts', 'a.ts', './services/api/app/db.py'].map(folderOf), ['packages/web', 'web', '.', 'services/api']);
});

test('imports between folders are counted both ways; imports inside a folder are not architecture', () => {
  const links = folderLinks(
    [{ from: 'packages/web/src/a.ts', to: 'services/api/x.ts' }, { from: 'packages/web/src/b.ts', to: 'services/api/y.ts' }, { from: 'packages/web/src/a.ts', to: 'packages/web/src/b.ts' }],
    [{ from: 'packages/web/src/c.ts', to: 'packages/shared/z.ts' }],
  );
  assert.deepEqual(links.map((l) => [l.from, l.to, l.added, l.removed]), [['packages/web', 'services/api', 2, 0], ['packages/web', 'packages/shared', 0, 1]]);
});

test('outside packages are read from npm, pip and go manifests', () => {
  assert.deepEqual([...packagesIn('package.json', '{"dependencies":{"stripe":"^14"},"devDependencies":{"vitest":"^2"}}')], ['stripe', 'vitest']);
  assert.deepEqual([...packagesIn('svc/requirements.txt', 'fastapi==0.110\n# a comment\nSQLAlchemy>=2\n-r base.txt\n')], ['fastapi', 'sqlalchemy']);
  assert.deepEqual([...packagesIn('go.mod', 'module x\n\nrequire (\n\tgithub.com/stripe/stripe-go/v76 v76.0.0\n\tgolang.org/x/text v0.14.0 // indirect\n)\nrequire example.com/one v1.0.0\n')],
    ['github.com/stripe/stripe-go/v76', 'golang.org/x/text', 'example.com/one']);
  assert.deepEqual([...packagesIn('package.json', 'not json')], []);
});

test('a call is new when its kind and target were not there before; one gone is dropped', () => {
  const before = [{ kind: 'http_call' as const, protocol: 'http' as const, line: 3, method: 'GET', urlPattern: '/api/users' }];
  const after = [
    { kind: 'http_call' as const, protocol: 'http' as const, line: 4, method: 'GET', urlPattern: '/api/users' },
    { kind: 'http_call' as const, protocol: 'http' as const, line: 9, method: 'POST', urlPattern: '/api/charges' },
  ];
  assert.deepEqual(callChanges('web/pay.ts', before, after), [{ file: 'web/pay.ts', line: 9, kind: 'http_call', what: 'POST /api/charges', change: 'added' }]);
  assert.deepEqual(callChanges('web/pay.ts', after, before).map((c) => [c.change, c.what]), [['removed', 'POST /api/charges']]);
});

test('the section says when nothing changes, and when the imports could not be read', () => {
  const empty = { base: 'a', head: 'b', edgesKnown: true, folders: [], packages: [], calls: [], rules: [], words: [], order: [] };
  assert.equal(architectureMarkdown(empty), '### What this change does to the architecture\n\nNo imports between folders, outside packages, cross-system calls or rules change.');
  assert.match(architectureMarkdown({ ...empty, edgesKnown: false, words: ['The imports between folders are not known: x'] }), /_The imports between folders are not known/);
  assert.equal(architectureMarkdown({ ...empty, words: ['Adds an HTTP call to POST /api/charges (web/pay.ts:9)'] }).split('\n')[2], '- Adds an HTTP call to POST /api/charges (web/pay.ts:9)');
});
