/**
 * Declared intent (Phase 32 A2.4): what an agent may claim, and how a claim
 * becomes files in its workstream's footprint.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseIntentPath, parseIntentSymbol, intentFiles, declareIntent, getIntent, clearIntent, clearAllIntents,
} from './intent-service';

const ROOTS = ['/work/acme-billing', '/work/acme'];

describe('what may be declared', () => {
  test('a path is relative to the repository; an absolute one is accepted inside the workstream or project', () => {
    assert.equal(normaliseIntentPath('src/billing/invoice.ts', ROOTS), 'src/billing/invoice.ts');
    assert.equal(normaliseIntentPath('./src/x.ts', ROOTS), 'src/x.ts');
    assert.equal(normaliseIntentPath('src/a/../b.ts', ROOTS), 'src/b.ts');
    assert.equal(normaliseIntentPath('/work/acme-billing/src/x.ts', ROOTS), 'src/x.ts');
    assert.equal(normaliseIntentPath('/work/acme/src/y.ts', ROOTS), 'src/y.ts');
  });

  test('nothing that climbs out of the repository, and nothing empty', () => {
    for (const bad of ['../secrets.txt', 'src/../../etc/passwd', '/etc/passwd', '/work/other/x.ts', '', '   ', '.', 'a\0b']) {
      assert.equal(normaliseIntentPath(bad, ROOTS), null, JSON.stringify(bad));
    }
  });

  test('a symbol is a name, optionally qualified, optionally pinned to a file', () => {
    assert.deepEqual(parseIntentSymbol('createInvoice', ROOTS), { path: null, name: 'createInvoice' });
    assert.deepEqual(parseIntentSymbol('Session.renew', ROOTS), { path: null, name: 'Session.renew' });
    assert.deepEqual(parseIntentSymbol('src/billing/invoice.ts#createInvoice', ROOTS), { path: 'src/billing/invoice.ts', name: 'createInvoice' });
    for (const bad of ['drop table', '1abc', '../x.ts#f', 'f()', '']) assert.equal(parseIntentSymbol(bad, ROOTS), null, bad);
  });
});

describe('the files a claim covers', () => {
  test('bare names apply to every path; a pinned symbol claims its own file', () => {
    assert.deepEqual(intentFiles({ paths: ['src/a.ts', 'src/b.ts'], symbols: ['total', 'src/c.ts#render'] }), [
      { path: 'src/a.ts', symbols: ['total'] },
      { path: 'src/b.ts', symbols: ['total'] },
      { path: 'src/c.ts', symbols: ['render'] },
    ]);
  });

  test('paths alone claim whole files', () => {
    assert.deepEqual(intentFiles({ paths: ['src/a.ts'], symbols: [] }), [{ path: 'src/a.ts', symbols: [] }]);
  });
});

describe('one intent per session', () => {
  beforeEach(() => clearAllIntents());
  const intent = (sessionId: string, summary: string) =>
    ({ sessionId, agentType: 'codex', summary, paths: ['src/a.ts'], symbols: [], declaredAt: 1 });

  test('declaring again replaces it; clearing ends it', () => {
    declareIntent(intent('s1', 'first'));
    declareIntent(intent('s1', 'second'));
    declareIntent(intent('s2', 'other'));
    assert.equal(getIntent('s1')?.summary, 'second');
    assert.equal(clearIntent('s1'), true);
    assert.equal(getIntent('s1'), null);
    assert.equal(clearIntent('s1'), false);
    assert.equal(getIntent('s2')?.summary, 'other');
  });
});
