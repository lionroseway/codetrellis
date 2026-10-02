import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanRefs } from './plan-file-refs';

test('a plan file\'s refs are cleaned: http(s) links only, bounded keys and titles, no duplicates', () => {
  const got = cleanRefs([
    { url: 'https://acme.atlassian.net/browse/FIN-88', key: 'FIN-88', kind: 'jira', title: 'Board pack' },
    { url: 'https://acme.atlassian.net/browse/FIN-88/' }, // the same link again
    { url: 'javascript:alert(1)', key: 'X-1' },
    { url: 'file:///etc/passwd' },
    { url: 'not a url' },
    { url: 'https://figma.com/file/abc', key: '../../etc', kind: 'nonsense', title: '  ' },
    'https://bare-string.example',
    null,
  ]);
  assert.deepEqual(got, [
    { url: 'https://acme.atlassian.net/browse/FIN-88', key: 'FIN-88', kind: 'jira', title: 'Board pack' },
    { url: 'https://figma.com/file/abc', key: null, kind: 'figma', title: null },
  ]);
});

test('anything that is not a list is nothing, and a long list is cut short', () => {
  assert.deepEqual(cleanRefs({ url: 'https://x.example' }), []);
  assert.deepEqual(cleanRefs(undefined), []);
  const many = Array.from({ length: 80 }, (_, i) => ({ url: `https://x.example/${i}` }));
  assert.equal(cleanRefs(many).length, 50);
  assert.equal(cleanRefs([{ url: `https://x.example/${'a'.repeat(3000)}` }]).length, 0);
  assert.equal(cleanRefs([{ url: 'https://x.example', title: 'T'.repeat(500) }])[0].title!.length, 200);
});
