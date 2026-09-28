/**
 * Signals from footprints (Phase 32 A1.6): every kind, deduplication, and
 * resolution. Pure, so no repository is needed — the inputs are the shapes
 * the workstream service produces.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeSignals, reconcileSignals, type FootprintInput } from './awareness-signals';
import type { ChangedFile, SymbolChange } from '../../shared/types';

const sym = (name: string, change: SymbolChange['change'] = 'modified'): SymbolChange => ({ name, kind: 'function', change, line: 1 });
const file = (p: string, symbols?: SymbolChange[]): ChangedFile => ({ path: p, status: 'modified', ...(symbols ? { symbols } : {}) });
const ws = (root: string, branch: string, files: ChangedFile[], extra: Partial<FootprintInput> = {}): FootprintInput =>
  ({ root, branch, main: false, files, mainSinceBase: [], ...extra });
const brief = (drafts: ReturnType<typeof computeSignals>) => drafts.map((d) => `${d.severity} ${d.kind} ${d.subject.file ?? d.subject.files?.join('+')}${d.subject.symbol ? `#${d.subject.symbol}` : ''}`);

describe('collision', () => {
  test('the same symbol in two workstreams is high, named precisely', () => {
    const d = computeSignals([
      ws('/r/auth', 'auth-refresh', [file('src/session.ts', [sym('refreshToken'), sym('Session.renew')])]),
      ws('/r/billing', 'billing-v2', [file('src/session.ts', [sym('refreshToken')])]),
    ]);
    assert.deepEqual(brief(d), ['high collision src/session.ts#refreshToken']);
    assert.equal(d[0].summary, '`auth-refresh` and `billing-v2` both change src/session.ts → refreshToken');
    assert.deepEqual(d[0].workstreams, ['/r/auth', '/r/billing']);
  });

  test('the same file, different symbols, is medium; a file with a symbol collision is not also a file collision', () => {
    const d = computeSignals([
      ws('/r/a', 'a', [file('src/x.ts', [sym('one')]), file('src/y.ts', [sym('shared')])]),
      ws('/r/b', 'b', [file('src/x.ts', [sym('two')]), file('src/y.ts', [sym('shared'), sym('other')])]),
    ]);
    assert.deepEqual(brief(d), ['high collision src/y.ts#shared', 'medium collision src/x.ts']);
  });

  test('a file we do not parse can only collide at file level', () => {
    const d = computeSignals([ws('/r/a', 'a', [file('README.md')]), ws('/r/b', 'b', [file('README.md')])]);
    assert.deepEqual(brief(d), ['medium collision README.md']);
  });

  test('adding the same name in both, or removing what the other edits, collides too', () => {
    const d = computeSignals([
      ws('/r/a', 'a', [file('src/m.ts', [sym('formatMoney', 'added'), sym('legacy', 'removed')])]),
      ws('/r/b', 'b', [file('src/m.ts', [sym('formatMoney', 'added'), sym('legacy', 'modified')])]),
    ]);
    assert.deepEqual(brief(d).sort(), ['high collision src/m.ts#formatMoney', 'high collision src/m.ts#legacy']);
  });

  test('three workstreams on one file are three pairs, each its own signal', () => {
    const d = computeSignals([ws('/r/a', 'a', [file('f.ts')]), ws('/r/b', 'b', [file('f.ts')]), ws('/r/c', 'c', [file('f.ts')])]);
    assert.deepEqual(d.map((x) => x.workstreams.join('+')).sort(), ['/r/a+/r/b', '/r/a+/r/c', '/r/b+/r/c']);
  });

  test('no shared files, no signal', () => {
    assert.deepEqual(computeSignals([ws('/r/a', 'a', [file('a.ts')]), ws('/r/b', 'b', [file('b.ts')])]), []);
  });

  test('the main checkout collides like any other workstream', () => {
    const d = computeSignals([ws('/r', 'main', [file('src/app.ts')], { main: true }), ws('/r/feat', 'feat', [file('src/app.ts')])]);
    assert.deepEqual(brief(d), ['medium collision src/app.ts']);
  });
});

describe('stale-base', () => {
  test('main changed a file this workstream also changes since it branched: low', () => {
    const d = computeSignals([ws('/r/auth', 'auth-refresh', [file('src/session.ts'), file('src/new.ts')], { mainSinceBase: ['src/session.ts', 'docs/x.md'] })]);
    assert.deepEqual(brief(d), ['low stale-base src/session.ts']);
    assert.equal(d[0].summary, 'main changed src/session.ts since `auth-refresh` branched, and `auth-refresh` changes it too');
  });

  test('main moving on files this workstream leaves alone is not a signal; nor is the main checkout itself', () => {
    assert.deepEqual(computeSignals([ws('/r/a', 'a', [file('a.ts')], { mainSinceBase: ['b.ts'] })]), []);
    assert.deepEqual(computeSignals([ws('/r', 'main', [file('a.ts')], { main: true, mainSinceBase: ['a.ts'] })]), []);
  });

  test('many files are summarised, all of them kept in the subject', () => {
    const files = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'];
    const d = computeSignals([ws('/r/w', 'w', files.map((f) => file(f)), { mainSinceBase: files })]);
    assert.match(d[0].summary, /^main changed a\.ts, b\.ts, c\.ts and 2 more since `w` branched/);
    assert.deepEqual(d[0].subject.files, files);
  });
});

describe('deduplication and resolution', () => {
  const two = (symbols = [sym('refreshToken')]) => [
    ws('/r/auth', 'auth-refresh', [file('src/session.ts', symbols)]),
    ws('/r/billing', 'billing-v2', [file('src/session.ts', symbols)]),
  ];

  test('the same cause gives the same id, whichever order the workstreams come in', () => {
    const a = computeSignals(two());
    const b = computeSignals([...two()].reverse());
    assert.deepEqual(a.map((x) => x.id), b.map((x) => x.id));
    assert.match(a[0].id, /^[0-9a-f]{16}$/);
  });

  test('new signals open; firing again unchanged writes nothing', () => {
    const first = reconcileSignals([], computeSignals(two()), 1000);
    assert.equal(first.upserts.length, 1);
    assert.equal(first.upserts[0].state, 'open');
    const again = reconcileSignals(first.upserts, computeSignals(two()), 2000);
    assert.deepEqual(again, { upserts: [], resolved: [] });
  });

  test('a signal whose cause went away is resolved; coming back reopens it with its first-seen kept', () => {
    const first = reconcileSignals([], computeSignals(two()), 1000).upserts;
    const gone = reconcileSignals(first, computeSignals([two()[0]]), 2000);
    assert.deepEqual(gone.resolved, [first[0].id]);
    const resolvedRow = { ...first[0], state: 'resolved' as const };
    const back = reconcileSignals([resolvedRow], computeSignals(two()), 3000);
    assert.equal(back.upserts[0].state, 'open');
    assert.equal(back.upserts[0].firstSeen, 1000);
    // And an already-resolved signal is not resolved again.
    assert.deepEqual(reconcileSignals([resolvedRow], [], 4000).resolved, []);
  });

  test("a person's acknowledgement is not overruled by the signal firing again", () => {
    const [row] = reconcileSignals([], computeSignals(two()), 1000).upserts;
    const acked = { ...row, state: 'acknowledged' as const };
    // Same cause, now spelled differently (a symbol added): updated, still acknowledged.
    const next = reconcileSignals([acked], computeSignals(two([sym('refreshToken'), sym('x')])), 2000);
    for (const u of next.upserts.filter((u) => u.id === row.id)) assert.equal(u.state, 'acknowledged');
  });
});
