/**
 * Signals from footprints (Phase 32 A1.6): every kind, deduplication, and
 * resolution. Pure, so no repository is needed — the inputs are the shapes
 * the workstream service produces.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeSignals, contractCandidates, importableName, outsideScope, reconcileSignals, type ContractChange, type FootprintInput, type WorkstreamScope } from './awareness-signals';
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
    assert.deepEqual(again, { upserts: [], resolved: [], reopened: [] });
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

describe('contract (A2.3)', () => {
  const sig = { before: '(opts: Opts): Invoice', after: '(opts: Opts, currency: string): Invoice' };
  const contract = (over: Partial<ContractChange> = {}): ContractChange => ({
    file: 'src/billing.ts', symbol: 'createInvoice', change: 'signature', signature: sig,
    importers: [{ path: 'src/checkout.ts', possibly: false }, { path: 'src/cart.ts', possibly: false }], ...over,
  });
  const changer = (c: ContractChange[]) => ws('/r/billing', 'billing-v2', [file('src/billing.ts', [sym('createInvoice')])], { contracts: c });

  test('a signature change imported by files the other workstream changes is high, and says who, what and where', () => {
    const d = computeSignals([
      changer([contract()]),
      ws('/r/checkout', 'checkout-fix', [file('src/checkout.ts'), file('src/cart.ts'), file('README.md')]),
    ]);
    assert.deepEqual(brief(d), ['high contract src/billing.ts#createInvoice']);
    assert.equal(d[0].summary,
      '`billing-v2` changed createInvoice in src/billing.ts: (opts: Opts): Invoice → (opts: Opts, currency: string): Invoice. `checkout-fix` imports it in 2 files');
    assert.deepEqual(d[0].subject, {
      file: 'src/billing.ts', symbol: 'createInvoice', by: '/r/billing', change: 'signature', signature: sig,
      importers: ['src/cart.ts', 'src/checkout.ts'],
    });
    assert.deepEqual(d[0].workstreams, ['/r/billing', '/r/checkout']);
  });

  test('an importer the other workstream does not change raises nothing: its code still matches main', () => {
    const d = computeSignals([changer([contract()]), ws('/r/other', 'other', [file('src/unrelated.ts')])]);
    assert.deepEqual(brief(d), []);
  });

  test('an importer the other workstream deletes raises nothing', () => {
    const d = computeSignals([changer([contract()]), ws('/r/c', 'c', [{ path: 'src/checkout.ts', status: 'deleted' }])]);
    assert.deepEqual(brief(d), []);
  });

  test('only a namespace import is medium, and says "may use it"', () => {
    const d = computeSignals([
      changer([contract({ importers: [{ path: 'src/checkout.ts', possibly: true }] })]),
      ws('/r/checkout', 'checkout-fix', [file('src/checkout.ts')]),
    ]);
    assert.deepEqual(brief(d), ['medium contract src/billing.ts#createInvoice']);
    assert.match(d[0].summary, /`checkout-fix` may use it in 1 file \(it imports the module as a whole\)$/);
    assert.equal(d[0].subject.possibly, true);
  });

  test('a removed export imported elsewhere is high too', () => {
    const d = computeSignals([
      changer([contract({ change: 'removed', signature: undefined })]),
      ws('/r/checkout', 'checkout-fix', [file('src/checkout.ts')]),
    ]);
    assert.equal(d[0].severity, 'high');
    assert.equal(d[0].summary, '`billing-v2` removed createInvoice from src/billing.ts. `checkout-fix` imports it in 1 file');
  });

  test('each direction is its own signal; a workstream importing its own change is not told about it', () => {
    const a = ws('/r/a', 'a', [file('src/x.ts'), file('src/y.ts')], {
      contracts: [contract({ file: 'src/x.ts', symbol: 'one', importers: [{ path: 'src/y.ts', possibly: false }] })],
    });
    const b = ws('/r/b', 'b', [file('src/y.ts'), file('src/x.ts')], {
      contracts: [contract({ file: 'src/y.ts', symbol: 'two', importers: [{ path: 'src/x.ts', possibly: false }] })],
    });
    const d = computeSignals([a, b]).filter((s) => s.kind === 'contract');
    assert.deepEqual(d.map((s) => `${s.subject.by} ${s.subject.symbol}`).sort(), ['/r/a one', '/r/b two']);
    assert.notEqual(d[0].id, d[1].id);
  });

  test('which changes are contract changes: exported, and a signature change or a removal; never a body-only edit', () => {
    const f: ChangedFile = { path: 'src/billing.ts', status: 'modified', symbols: [
      { name: 'createInvoice', kind: 'function', change: 'modified', line: 1, exported: true, signature: sig },
      { name: 'formatTotal', kind: 'function', change: 'modified', line: 5, exported: true },
      { name: 'helper', kind: 'function', change: 'modified', line: 9, signature: sig },
      { name: 'Session.renew', kind: 'method', change: 'removed', line: 12, exported: true },
      { name: 'addLine', kind: 'function', change: 'added', line: 20, exported: true },
    ] };
    assert.deepEqual(contractCandidates([f]).map((c) => `${c.change} ${c.symbol}`), ['signature createInvoice', 'removed Session.renew']);
    // A removal from a renamed file is looked up where its importers point: the old path.
    const moved: ChangedFile = { path: 'src/new.ts', from: 'src/old.ts', status: 'renamed', symbols: [{ name: 'gone', kind: 'function', change: 'removed', line: 1, exported: true }] };
    assert.equal(contractCandidates([moved])[0].file, 'src/old.ts');
    assert.equal(importableName('Session.renew'), 'Session');
    assert.equal(importableName('Invoice#post'), 'Invoice');
    assert.equal(importableName('(Ledger).Post'), 'Ledger');
  });
});

describe('declared intent in a collision (A2.4)', () => {
  test('an intent on a function the other side changes is a high collision, before anything is edited', () => {
    const d = computeSignals([
      ws('/r/auth', 'auth-refresh', [], { intended: [{ path: 'src/session.ts', symbols: ['refreshToken'] }] }),
      ws('/r/billing', 'billing-v2', [file('src/session.ts', [sym('refreshToken')])]),
    ]);
    assert.deepEqual(brief(d), ['high collision src/session.ts#refreshToken']);
    assert.equal(d[0].summary, '`auth-refresh` means to change src/session.ts → refreshToken (declared), and `billing-v2` changes it');
    assert.deepEqual(d[0].subject.intended, ['/r/auth']);
  });

  test('two intents on one file are a medium collision, and say nothing has changed yet', () => {
    const d = computeSignals([
      ws('/r/a', 'a', [], { intended: [{ path: 'src/x.ts', symbols: [] }] }),
      ws('/r/b', 'b', [], { intended: [{ path: 'src/x.ts', symbols: [] }] }),
    ]);
    assert.deepEqual(brief(d), ['medium collision src/x.ts']);
    assert.equal(d[0].summary, '`a` and `b` both mean to change src/x.ts (declared; nothing changed yet)');
    assert.deepEqual(d[0].subject.intended, ['/r/a', '/r/b']);
  });

  test('the declared overlap and the edit it foretells are one signal: same id, no longer marked declared', () => {
    const other = ws('/r/billing', 'billing-v2', [file('src/session.ts', [sym('refreshToken')])]);
    const [declared] = computeSignals([ws('/r/auth', 'auth-refresh', [], { intended: [{ path: 'src/session.ts', symbols: ['refreshToken'] }] }), other]);
    const [edited] = computeSignals([ws('/r/auth', 'auth-refresh', [file('src/session.ts', [sym('refreshToken')])]), other]);
    assert.equal(declared.id, edited.id);
    assert.equal(edited.subject.intended, undefined);
    assert.equal(edited.summary, '`auth-refresh` and `billing-v2` both change src/session.ts → refreshToken');
  });

  test('an intent elsewhere raises nothing', () => {
    const d = computeSignals([
      ws('/r/a', 'a', [], { intended: [{ path: 'src/y.ts', symbols: ['f'] }] }),
      ws('/r/b', 'b', [file('src/x.ts', [sym('f')])]),
    ]);
    assert.deepEqual(brief(d), []);
  });
});

describe('drift (A2.5)', () => {
  const scope = (over: Partial<WorkstreamScope> = {}): WorkstreamScope => ({ paths: ['src/billing/invoice.ts'], dirs: [], items: ['item-1'], declared: false, ...over });

  test('a file outside the claimed item\'s files is medium drift, naming the file and the item', () => {
    const d = computeSignals([ws('/r/billing', 'billing-v2', [file('src/billing/invoice.ts'), file('config/shared.ts')], { scope: scope() })]);
    assert.deepEqual(brief(d), ['medium drift config/shared.ts']);
    assert.equal(d[0].summary, '`billing-v2` changes 1 file outside the scope its claimed item gives it: config/shared.ts');
    assert.deepEqual(d[0].subject, { files: ['config/shared.ts'], items: ['item-1'] });
    assert.deepEqual(d[0].workstreams, ['/r/billing']);
  });

  test('inside the scope, nothing: files named, anything under a folder, both ends of a move, and plan files', () => {
    const s = scope({ dirs: ['src/billing/'], paths: ['src/old.ts', 'src/new.ts'] });
    assert.deepEqual(outsideScope([
      file('src/billing/tax/vat.ts'),
      { path: 'src/new.ts', from: 'src/old.ts', status: 'renamed' },
      file('.codetrellis/plans/abc/plan.md'),
    ], s), []);
    // A move out of scope is outside it.
    assert.deepEqual(outsideScope([{ path: 'lib/new.ts', from: 'src/old.ts', status: 'renamed' }], s), ['lib/new.ts']);
  });

  test('where the scope came from is said: items, declared intent, or both', () => {
    const one = (sc: WorkstreamScope) => computeSignals([ws('/r/w', 'w', [file('x.ts')], { scope: sc })])[0].summary;
    assert.match(one(scope({ items: [], declared: true })), /outside the scope its declared intent gives it: x\.ts$/);
    assert.match(one(scope({ items: ['a', 'b'] })), /outside the scope its claimed items give it/);
    assert.match(one(scope({ declared: true })), /outside the scope its claimed item and its declared intent give it/);
  });

  test('no scope at all is nothing to drift from; many files are summarised, all kept in the subject', () => {
    assert.deepEqual(brief(computeSignals([ws('/r/w', 'w', [file('a.ts')])])), []);
    const many = computeSignals([ws('/r/w', 'w', ['a', 'b', 'c', 'd', 'e'].map((n) => file(`${n}.ts`)), { scope: scope() })]);
    assert.match(many[0].summary, /5 files outside .*: a\.ts, b\.ts, c\.ts and 2 more$/);
    assert.equal(many[0].subject.files!.length, 5);
  });
});

describe('intended and cooldown (A3.2)', () => {
  const pair = (auth: SymbolChange[], billing: SymbolChange[]) => [
    ws('/r/auth', 'auth-refresh', [file('src/session.ts', auth)]),
    ws('/r/billing', 'billing-v2', [file('src/session.ts', billing)]),
  ];
  const answered = (state: 'acknowledged' | 'intended' | 'dismissed', inputs: FootprintInput[]) => {
    const [d] = computeSignals(inputs);
    return { ...d, firstSeen: 1, lastSeen: 1, state, stateBy: { actor: 'saif', actorType: 'human' as const, channel: 'desktop' as const }, stateAt: 1 };
  };

  test('a body edit keeps the shape, so an answer holds', () => {
    const before = answered('acknowledged', pair([sym('refresh')], [sym('renew')]));
    const r = reconcileSignals([before], computeSignals(pair([sym('refresh')], [sym('renew')])), 2);
    assert.deepEqual(r.reopened, []);
    assert.equal(r.upserts.length, 0, 'nothing moved');
  });

  test('a new symbol in the file changes the shape: an acknowledged signal opens again, saying from what', () => {
    const before = answered('acknowledged', pair([sym('refresh')], [sym('renew')]));
    const r = reconcileSignals([before], computeSignals(pair([sym('refresh'), sym('rotate', 'added')], [sym('renew')])), 2);
    assert.deepEqual(r.reopened, [before.id]);
    const [u] = r.upserts;
    assert.equal(u.state, 'open');
    assert.deepEqual(u.reopened, { from: 'acknowledged', at: 2 });
    assert.equal(u.stateBy, undefined, 'the old answer is not carried');
  });

  test('intended holds until either side changes shape; a new signature is a new shape', () => {
    const withSig = (sig: string): SymbolChange => ({ ...sym('refreshToken'), signature: { before: '()', after: sig } });
    const before = answered('intended', pair([sym('refreshToken')], [sym('refreshToken')]));
    assert.deepEqual(reconcileSignals([before], computeSignals(pair([sym('refreshToken')], [sym('refreshToken')])), 2).reopened, []);
    const r = reconcileSignals([before], computeSignals(pair([withSig('(force: boolean)')], [sym('refreshToken')])), 2);
    assert.deepEqual(r.upserts[0].reopened, { from: 'intended', at: 2 });
  });

  test('a declared intent landing as an edit keeps the shape (the A2.4 promise)', () => {
    const declared = [ws('/r/auth', 'auth-refresh', [], { intended: [{ path: 'src/session.ts', symbols: ['refreshToken'] }] }), ws('/r/billing', 'billing-v2', [file('src/session.ts', [sym('refreshToken')])])];
    const before = answered('acknowledged', declared);
    const r = reconcileSignals([before], computeSignals(pair([sym('refreshToken')], [sym('refreshToken')])), 2);
    assert.deepEqual(r.reopened, []);
    assert.equal(r.upserts[0].state, 'acknowledged');
  });

  test('dismissed stays dismissed while it lasts; a row without a shape takes one quietly', () => {
    const dismissed = answered('dismissed', pair([sym('refresh')], [sym('renew')]));
    const r1 = reconcileSignals([dismissed], computeSignals(pair([sym('refresh'), sym('rotate', 'added')], [sym('renew')])), 2);
    assert.equal(r1.upserts[0].state, 'dismissed');
    const old = { ...answered('acknowledged', pair([sym('refresh')], [sym('renew')])), shape: undefined as unknown as string };
    const r2 = reconcileSignals([old], computeSignals(pair([sym('refresh'), sym('rotate', 'added')], [sym('renew')])), 2);
    assert.deepEqual(r2.reopened, []);
    assert.equal(r2.upserts[0].state, 'acknowledged');
    assert.ok(r2.upserts[0].shape);
  });

  test('drift reopens when another file falls outside the scope', () => {
    const sc = { paths: ['a.ts'], dirs: [], items: ['i'], declared: false };
    const before = answered('intended', [ws('/r/w', 'w', [file('a.ts'), file('b.ts')], { scope: sc })]);
    assert.deepEqual(reconcileSignals([before], computeSignals([ws('/r/w', 'w', [file('a.ts'), file('b.ts')], { scope: sc })]), 2).reopened, []);
    assert.deepEqual(reconcileSignals([before], computeSignals([ws('/r/w', 'w', [file('a.ts'), file('b.ts'), file('c.ts')], { scope: sc })]), 2).reopened, [before.id]);
  });
});

describe('rule (A7.2)', () => {
  const RULE = { id: 'web-not-db', from: 'web/', mayNotImport: 'db/', because: 'web talks to db through the API' };

  test('one high signal per workstream and rule, naming each import it adds and why', () => {
    const d = computeSignals([
      ws('/r/exports', 'exports-v2', [file('web/reports.ts'), file('web/admin.ts')], {
        ruleBreaches: [{ rule: RULE, edges: [{ from: 'web/reports.ts', to: 'db/client.ts' }, { from: 'web/admin.ts', to: 'db/users.ts' }] }],
      }),
    ]);
    assert.deepEqual(brief(d), ['high rule web/admin.ts+web/reports.ts']);
    assert.deepEqual(d[0].workstreams, ['/r/exports']);
    assert.deepEqual(d[0].subject.rule, { id: 'web-not-db', words: 'web/ may not import db/', because: 'web talks to db through the API' });
    assert.deepEqual(d[0].subject.edges, [{ from: 'web/admin.ts', to: 'db/users.ts' }, { from: 'web/reports.ts', to: 'db/client.ts' }]);
    assert.equal(d[0].summary, '`exports-v2` now imports db/ from web/ (web/admin.ts → db/users.ts, web/reports.ts → db/client.ts), which the rule “web/ may not import db/” forbids: web talks to db through the API');
  });

  test('its id is the workstream and rule, so a new import across it is the same signal with a new shape', () => {
    const one = computeSignals([ws('/r/x', 'x', [file('web/a.ts')], { ruleBreaches: [{ rule: RULE, edges: [{ from: 'web/a.ts', to: 'db/a.ts' }] }] })]);
    const two = computeSignals([ws('/r/x', 'x', [file('web/a.ts')], { ruleBreaches: [{ rule: RULE, edges: [{ from: 'web/a.ts', to: 'db/a.ts' }, { from: 'web/a.ts', to: 'db/b.ts' }] }] })]);
    assert.equal(one[0].id, two[0].id);
    assert.notEqual(one[0].shape, two[0].shape);
    assert.deepEqual(computeSignals([ws('/r/x', 'x', [file('web/a.ts')], { ruleBreaches: [] })]), []);
  });

  test('a rule at warn raises a medium signal; at block, or written before strength, a high one (R4)', () => {
    const at = (strength?: 'block' | 'warn') => computeSignals([ws('/r/x', 'x', [file('web/a.ts')], {
      ruleBreaches: [{ rule: { ...RULE, ...(strength ? { strength } : {}) }, edges: [{ from: 'web/a.ts', to: 'db/a.ts' }] }],
    })])[0].severity;
    assert.deepEqual([at('warn'), at('block'), at()], ['medium', 'high', 'high']);
  });
});
