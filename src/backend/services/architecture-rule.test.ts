/**
 * Phase 32 A7.1 — an architecture rule, read and checked.
 *
 * Sam writes "web/ may not import db/, except db/types.ts, because web talks
 * to db through the API". A file under web/ importing db/client.ts breaks
 * it; importing db/types.ts does not, nor does anything under db/ itself.
 * Patterns are folders, files or globs; a rule written badly is refused
 * with why, and one that climbs out of the project is never kept.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breachWords, breaks, checkEdges, inPattern, parseArchitectureRule, ruleStatement, ruleWords } from './architecture-rule';

const RULE = parseArchitectureRule({
  id: 'web-not-db', from: 'web/', mayNotImport: 'db/', except: ['db/types.ts'], because: 'web talks to db through the API', by: 'Sam Lee',
}).rule!;

test('a folder, a file and a glob are each a pattern', () => {
  assert.equal(inPattern('web/', 'web/reports.ts'), true);
  assert.equal(inPattern('web/', 'webby/x.ts'), false);
  assert.equal(inPattern('web', 'web/reports.ts'), true, 'a folder named without its slash');
  assert.equal(inPattern('db/types.ts', 'db/types.ts'), true);
  assert.equal(inPattern('db/types.ts', 'db/types.tsx'), false);
  assert.equal(inPattern('src/**/ui/**', 'src/billing/ui/Form.tsx'), true);
  assert.equal(inPattern('src/**/ui/**', 'src/billing/api/charge.ts'), false);
  assert.equal(inPattern('src/*.ts', 'src/index.ts'), true);
  assert.equal(inPattern('src/*.ts', 'src/a/index.ts'), false);
});

test('web/ importing db/ breaks the rule; its door, and db/ itself, do not', () => {
  assert.equal(breaks(RULE, 'web/reports.ts', 'db/client.ts'), true);
  assert.equal(breaks(RULE, 'web/reports.ts', 'db/types.ts'), false, 'the door through the wall');
  assert.equal(breaks(RULE, 'db/client.ts', 'db/pool.ts'), false, 'db/ within itself');
  assert.equal(breaks(RULE, 'api/handler.ts', 'db/client.ts'), false, 'not from web/');
  assert.deepEqual(checkEdges([RULE], [
    { from: 'web/reports.ts', to: 'db/client.ts' },
    { from: 'web/reports.ts', to: 'api/client.ts' },
    { from: 'web/admin/users.ts', to: 'db/users.ts' },
  ]), [
    { rule: 'web-not-db', from: 'web/reports.ts', to: 'db/client.ts' },
    { rule: 'web-not-db', from: 'web/admin/users.ts', to: 'db/users.ts' },
  ]);
});

test('in words: the rule, and a breach of it', () => {
  assert.equal(ruleWords(RULE), 'web/ may not import db/ (except db/types.ts): web talks to db through the API');
  assert.equal(breachWords(RULE, { from: 'web/reports.ts', to: 'db/client.ts' }),
    'web/reports.ts imports db/client.ts, which the rule “web/ may not import db/” forbids: web talks to db through the API');
});

test('a rule written badly is refused with why; one that climbs out of the project is never kept', () => {
  assert.deepEqual(parseArchitectureRule({ id: 'Web Not DB', from: '', mayNotImport: '/etc/' }).problems, [
    'id must be a short slug, like web-not-db',
    'from must be a folder or a pattern, like web/',
    'mayNotImport must be relative to the project, like web/',
  ]);
  assert.deepEqual(parseArchitectureRule({ id: 'x', from: '../web/', mayNotImport: 'db/' }).problems, ['from may not climb out of the project']);
  assert.deepEqual(parseArchitectureRule({ id: 'x', from: 'web/', mayNotImport: 'web/' }).problems, ['from and mayNotImport must differ']);
  assert.deepEqual(parseArchitectureRule({ id: 'x', from: 'web/', mayNotImport: 'db/', except: 'db/types.ts' }).problems, ['except must be a list of files or patterns']);
  assert.equal(parseArchitectureRule({ id: 'x', from: './web/', mayNotImport: 'db/' }).rule!.from, 'web/');
});

// Phase 33 R5 — a package rule: only these files may import an outside package.
const STRIPE = parseArchitectureRule({
  id: 'stripe-via-wrapper', kind: 'package', package: 'npm:stripe', only: ['src/payments/index.ts'],
  strength: 'block', because: 'The wrapper sets idempotency keys and retries.',
}).rule!;

test('a package rule reads as the design writes it, everywhere unless a folder is said', () => {
  assert.equal(STRIPE.kind, 'package');
  assert.equal(STRIPE.from, '**');
  assert.equal(STRIPE.mayNotImport, 'npm:stripe');
  assert.deepEqual(STRIPE.only, ['src/payments/index.ts']);
  assert.equal(ruleWords(STRIPE), 'only src/payments/index.ts may import npm:stripe: The wrapper sets idempotency keys and retries.');
  const scoped = parseArchitectureRule({ id: 'x', kind: 'package', package: 'pypi:requests', from: 'services/api/', only: ['services/api/http.py'] }).rule!;
  assert.equal(ruleWords(scoped), 'in services/api/, only services/api/http.py may import pypi:requests');
});

test('a package rule is refused without a package or without who may import it', () => {
  assert.match(parseArchitectureRule({ id: 'x', kind: 'package', only: ['a.ts'] }).problems.join(' '), /ecosystem and a name/);
  assert.match(parseArchitectureRule({ id: 'x', kind: 'package', package: 'npm:stripe' }).problems.join(' '), /only must list/);
  assert.match(parseArchitectureRule({ id: 'x', kind: 'package', package: 'npm:stripe', only: ['a.ts'], except: ['stripe'] }).problems.join(' '), /except: /);
  assert.match(parseArchitectureRule({ id: 'x', kind: 'glob', from: 'a/', mayNotImport: 'b/' }).problems.join(' '), /kind must be/);
});

test('only the named files may import the package; its doors are open to all', () => {
  assert.equal(breaks(STRIPE, 'src/checkout/pay.ts', 'npm:stripe'), true);
  assert.equal(breaks(STRIPE, 'src/payments/index.ts', 'npm:stripe'), false);
  assert.equal(breaks(STRIPE, 'src/checkout/pay.ts', 'npm:stripe-js'), false);
  assert.equal(breaks(STRIPE, 'src/checkout/pay.ts', 'src/payments/index.ts'), false);
  const doors = { ...STRIPE, except: ['npm:stripe/types'] };
  assert.equal(breaks(doors, 'src/checkout/pay.ts', 'npm:stripe/types'), false);
  // An imports rule never reads a package as a path.
  assert.equal(breaks(RULE, 'web/reports.ts', 'npm:db'), false);
  assert.deepEqual(checkEdges([STRIPE, RULE], [
    { from: 'src/checkout/pay.ts', to: 'npm:stripe' },
    { from: 'src/payments/index.ts', to: 'npm:stripe' },
    { from: 'web/reports.ts', to: 'db/client.ts' },
  ]).map((b) => `${b.rule} ${b.from}`), ['stripe-via-wrapper src/checkout/pay.ts', 'web-not-db web/reports.ts']);
  assert.equal(breachWords(STRIPE, { from: 'src/checkout/pay.ts', to: 'npm:stripe' }),
    'src/checkout/pay.ts imports npm:stripe, which the rule “only src/payments/index.ts may import npm:stripe” forbids: The wrapper sets idempotency keys and retries.');
});

// Phase 33 R6 — a symbol rule: only these files may import a named export.
const CHARGE = parseArchitectureRule({
  id: 'charges-via-payments', kind: 'symbol', symbol: 'src/payments/charge.ts#createCharge', only: ['src/payments/'],
  strength: 'block', because: 'Charging goes through the payments module.',
}).rule!;

test('a symbol rule reads as a person writes it: the export, who may, everywhere unless a folder is said', () => {
  assert.equal(CHARGE.kind, 'symbol');
  assert.equal(CHARGE.mayNotImport, 'src/payments/charge.ts#createCharge');
  assert.equal(CHARGE.from, '**');
  assert.equal(ruleStatement(CHARGE), 'only src/payments/ may import createCharge from src/payments/charge.ts');
  const scoped = parseArchitectureRule({ id: 'x', kind: 'symbol', symbol: 'a.ts#b', from: 'web/', only: ['web/pay.ts'] }).rule!;
  assert.equal(ruleStatement(scoped), 'in web/, only web/pay.ts may import b from a.ts');
});

test('a symbol rule is refused without a file and a name, without who may, with an except, or climbing out', () => {
  const problems = (r: Record<string, unknown>) => parseArchitectureRule({ id: 'x', kind: 'symbol', ...r }).problems.join(' ');
  assert.match(problems({ symbol: 'src/payments/charge.ts', only: ['a/'] }), /a file and a name/);
  assert.match(problems({ symbol: 'a.ts#*', only: ['a/'] }), /one export/);
  assert.match(problems({ symbol: '../a.ts#b', only: ['a/'] }), /climb out/);
  assert.match(problems({ symbol: 'a.ts#b' }), /only must list/);
  assert.match(problems({ symbol: 'a.ts#b', only: ['a/'], except: ['c.ts'] }), /no except/);
  assert.match(parseArchitectureRule({ id: 'x', kind: 'nonsense' }).problems.join(' '), /imports, package, symbol, calls or folder/);
});

test('only the named files may import the export, directly, through a barrel or as a namespace; the module that defines it may', () => {
  const sym = 'src/payments/charge.ts#createCharge';
  assert.equal(breaks(CHARGE, 'src/api.ts', sym), true);
  assert.equal(breaks(CHARGE, 'src/api.ts', 'src/payments/charge.ts#*'), true);
  assert.equal(breaks(CHARGE, 'src/payments/checkout.ts', sym), false);
  assert.equal(breaks(CHARGE, 'src/payments/charge.ts', sym), false);
  assert.equal(breaks(CHARGE, 'src/api.ts', 'src/payments/charge.ts#refund'), false);
  assert.equal(breaks(CHARGE, 'src/api.ts', 'src/payments/charge.ts'), false);
  assert.equal(breaks(CHARGE, 'src/api.ts', 'npm:stripe'), false);
  // An imports rule never reads a symbol entry as a file in its folder.
  const web = parseArchitectureRule({ id: 'web-not-payments', from: 'src/web/', mayNotImport: 'src/payments/' }).rule!;
  assert.equal(breaks(web, 'src/web/a.ts', sym), false);
  assert.equal(breaks(web, 'src/web/a.ts', 'src/payments/charge.ts'), true);
  assert.deepEqual(checkEdges([CHARGE], [{ from: 'src/api.ts', to: sym }, { from: 'src/payments/x.ts', to: sym }]), [{ rule: 'charges-via-payments', from: 'src/api.ts', to: sym }]);
});

// Phase 33 R7 — a call rule: only these files may make a call.
const STRIPE_API = parseArchitectureRule({ id: 'stripe-api-via-payments', kind: 'calls', calls: 'http:API.stripe.com', only: ['src/payments/'], strength: 'block' }).rule!;

test('a call rule reads as a person writes it, and says call or use', () => {
  assert.equal(STRIPE_API.kind, 'calls');
  assert.equal(STRIPE_API.mayNotImport, 'http:api.stripe.com');
  assert.equal(ruleStatement(STRIPE_API), 'only src/payments/ may call api.stripe.com');
  const table = parseArchitectureRule({ id: 'ledger', kind: 'calls', calls: 'sql:ledger', from: 'services/', only: ['services/billing/'] }).rule!;
  assert.equal(ruleStatement(table), 'in services/, only services/billing/ may use the table ledger');
  assert.match(parseArchitectureRule({ id: 'x', kind: 'calls', calls: 'stripe', only: ['a/'] }).problems.join(' '), /http: and a host/);
  assert.match(parseArchitectureRule({ id: 'x', kind: 'calls', calls: 'sql:x' }).problems.join(' '), /only must list/);
});

test('only the named files may make the call; an imports rule never reads a call as a file', () => {
  assert.equal(breaks(STRIPE_API, 'src/api.ts', 'http:api.stripe.com/v1/charges'), true);
  assert.equal(breaks(STRIPE_API, 'src/payments/client.ts', 'http:api.stripe.com/v1/charges'), false);
  assert.equal(breaks(STRIPE_API, 'src/api.ts', 'http:files.stripe.com/v1/files'), false);
  assert.equal(breaks(STRIPE_API, 'src/api.ts', 'npm:stripe'), false);
  const any = parseArchitectureRule({ id: 'web-not-api', from: 'src/web/', mayNotImport: 'src/api/' }).rule!;
  assert.equal(breaks(any, 'src/web/a.ts', 'http:/api/users'), false);
});
