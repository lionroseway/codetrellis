/**
 * Phase 33 G8 — the rules overlay's marks: which edges break which rules
 * (a file edge, or a cluster edge by the files under it), a node's ⊘ count,
 * the rules about a file, and what a suite keeps lit; and the window's
 * pattern matching is the backend's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breachesOf, edgeBreaches, nodeBreachMark, ruleCovers, rulesForFile, suiteCovers, type OverlayRuleView } from './rule-overlay';
import { inRulePattern } from '../../shared/lib/rule-pattern';
import { inPattern } from '../../backend/services/architecture-rule';

const WEB: OverlayRuleView = {
  rule: { id: 'web-not-db', from: 'web/', mayNotImport: 'db/', except: ['db/types.ts'], suite: 'architecture', strength: 'block' },
  words: 'web/ may not import db/', breaches: [{ rule: 'web-not-db', from: 'web/report.ts', to: 'db/client.ts' }],
};
const STRIPE: OverlayRuleView = {
  rule: { id: 'stripe-via-wrapper', kind: 'package', from: '**', mayNotImport: 'npm:stripe', only: ['src/payments/index.ts'], except: [], suite: 'payments', strength: 'block' },
  words: 'only src/payments/index.ts may import npm:stripe', breaches: [{ rule: 'stripe-via-wrapper', from: 'src/checkout/pay.ts', to: 'npm:stripe' }],
};
const GUIDE: OverlayRuleView = {
  rule: { id: 'read-me', from: 'docs/', mayNotImport: 'src/', except: [], suite: 'architecture', strength: 'guide' },
  words: 'docs/ may not import src/', breaches: [{ rule: 'read-me', from: 'docs/a.ts', to: 'src/b.ts' }],
};
const VIEWS = [WEB, STRIPE, GUIDE];

test('the window matches patterns exactly as the backend does', () => {
  const cases: Array<[string, string]> = [
    ['web/', 'web/a.ts'], ['web/', 'webby/a.ts'], ['web', 'web/a.ts'], ['web/a.ts', 'web/a.ts'], ['src/**/ui/**', 'src/x/ui/b.tsx'],
    ['src/*.ts', 'src/a.ts'], ['src/*.ts', 'src/x/a.ts'], ['**', 'anything/at/all.ts'], ['./web/', 'web/a.ts'],
    ['src/backend/**/*.ts', 'src/backend/server.ts'], ['**/*.test.ts', 'a.test.ts'], ['src/**/ui/**', 'src/ui/a.tsx'],
  ];
  for (const [p, f] of cases) assert.equal(inRulePattern(p, f), inPattern(p, f), `${p} ~ ${f}`);
});

test('a guide breaks nothing on the graph; an edge breaks the rules whose breaches run between its ends', () => {
  const b = breachesOf(VIEWS);
  assert.equal(b.length, 2);
  assert.deepEqual(edgeBreaches(b, ['web/report.ts'], ['db/client.ts']), ['web-not-db']);
  assert.deepEqual(edgeBreaches(b, ['db/client.ts'], ['web/report.ts']), []);
  // A cluster edge, by the files under each cluster.
  assert.deepEqual(edgeBreaches(b, ['web/a.ts', 'web/report.ts'], ['db/client.ts', 'db/pool.ts']), ['web-not-db']);
});

test('a node marks the imports from its files that break a rule; a package import marks only its importer', () => {
  const b = breachesOf(VIEWS);
  const mark = nodeBreachMark(b, ['src/checkout/pay.ts']);
  assert.equal(mark?.count, 1);
  assert.deepEqual(mark?.rules, ['stripe-via-wrapper']);
  assert.equal(mark?.title, '⊘ 1 import breaks a rule:\nsrc/checkout/pay.ts → npm:stripe (stripe-via-wrapper)');
  assert.equal(nodeBreachMark(b, ['db/client.ts']), null);
  assert.equal(nodeBreachMark(b, ['src/payments/index.ts']), null);
});

test('the rules about a file, and what a suite keeps lit', () => {
  assert.equal(ruleCovers(WEB.rule, 'db/client.ts'), true, 'what the rule guards');
  assert.equal(ruleCovers(STRIPE.rule, 'src/payments/index.ts'), true);
  // A guide is about a file too: it is shown to agents whose work touches it.
  assert.deepEqual(rulesForFile(VIEWS, 'src/checkout/pay.ts').map((r) => [r.rule.id, r.here.length]), [['stripe-via-wrapper', 1], ['read-me', 0]]);
  assert.deepEqual(rulesForFile([WEB], 'api/x.ts'), []);
  assert.equal(suiteCovers(VIEWS, 'architecture', ['web/a.ts']), true);
  assert.equal(suiteCovers([WEB], 'payments', ['web/a.ts']), false);
});

test('G10: a package rule is about the files that can import from its ecosystem, and the files that may: npm:stripe is not about a Python file', () => {
  const npm = { id: 'stripe-via-wrapper', kind: 'package' as const, from: '**', mayNotImport: 'npm:stripe', only: ['src/payments/index.ts'], except: [], suite: 'payments', strength: 'block' };
  assert.equal(ruleCovers(npm, 'src/api.ts'), true);
  assert.equal(ruleCovers(npm, 'src/payments/index.ts'), true);
  assert.equal(ruleCovers(npm, 'services/api/app/billing.py'), false);
  assert.equal(ruleCovers(npm, 'README.md'), false);
  assert.equal(ruleCovers({ ...npm, mayNotImport: 'pypi:stripe', only: ['services/api/app/billing.py'] }, 'services/api/app/routes/users.py'), true);
  assert.equal(ruleCovers({ ...npm, mayNotImport: 'pypi:stripe', only: ['services/api/app/billing.py'] }, 'src/api.ts'), false);
});
