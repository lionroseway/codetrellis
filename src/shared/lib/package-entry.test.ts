/**
 * Phase 33 R5 — an outside import as its package, in each language, and a
 * rule's package covering the entries under it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ecosystemOfPath, isPackageEntry, packageApplies, packageEntry, packageMatches, packageProblem } from './package-entry';

test('each language names the package an outside import comes from', () => {
  const cases: Array<[string, string, string | null]> = [
    ['typescript', 'stripe', 'npm:stripe'],
    ['typescript', 'stripe/lib/errors', 'npm:stripe'],
    ['javascript', '@stripe/stripe-js/pure', 'npm:@stripe/stripe-js'],
    ['typescript', './api', null],
    ['typescript', 'node:fs', null],
    ['python', 'stripe.api_resources', 'pypi:stripe'],
    ['python', '.models', null],
    ['go', 'github.com/stripe/stripe-go/v76/charge', 'go:github.com/stripe/stripe-go'],
    ['go', 'golang.org/x/sync/errgroup', 'go:golang.org/x/sync'],
    ['go', 'net/http', null],
    ['rust', 'serde::Deserialize', 'cargo:serde'],
    ['rust', 'crate::billing', null],
    ['rust', 'std::collections::HashMap', null],
    ['ruby', 'active_support/core_ext', 'gem:active_support'],
    ['java', 'com.stripe.Stripe', 'maven:com.stripe.Stripe'],
    ['kotlin', 'com.stripe.model.Charge', 'maven:com.stripe.model.Charge'],
    ['csharp', 'Stripe.Checkout', 'nuget:Stripe.Checkout'],
    ['php', '\\Stripe\\StripeClient', 'composer:Stripe\\StripeClient'],
    ['swift', 'Stripe', 'swift:Stripe'],
    ['sql', 'anything', null],
  ];
  for (const [lang, source, want] of cases) assert.equal(packageEntry(lang, source), want, `${lang} ${source}`);
  // Relative by the parser's say-so (Ruby's require_relative) is never a package.
  assert.equal(packageEntry('ruby', 'billing/invoice', true), null);
});

test('a rule covers its package and what is under it, in the language\'s own separator', () => {
  assert.equal(packageMatches('npm:stripe', 'npm:stripe'), true);
  assert.equal(packageMatches('npm:stripe', 'npm:stripe-js'), false);
  assert.equal(packageMatches('maven:com.stripe', 'maven:com.stripe.model.Charge'), true);
  assert.equal(packageMatches('maven:com.stripe', 'maven:com.striped.Thing'), false);
  assert.equal(packageMatches('nuget:Stripe', 'nuget:Stripe.Checkout'), true);
  assert.equal(packageMatches('composer:Stripe', 'composer:Stripe\\StripeClient'), true);
  assert.equal(packageMatches('npm:stripe', 'pypi:stripe'), false);
});

test('a package entry is told from a project path; a bad one is named', () => {
  assert.equal(isPackageEntry('npm:stripe'), true);
  assert.equal(isPackageEntry('src/payments/index.ts'), false);
  assert.equal(packageProblem('npm:stripe'), null);
  assert.match(packageProblem('stripe') ?? '', /ecosystem and a name/);
  assert.match(packageProblem('bower:jquery') ?? '', /ecosystem and a name/);
});

test('G10: the ecosystem a file imports from, by its extension; a file in no language imports none', () => {
  assert.equal(ecosystemOfPath('packages/web/src/api.ts'), 'npm');
  assert.equal(ecosystemOfPath('web/App.TSX'), 'npm');
  assert.equal(ecosystemOfPath('services/api/app/billing.py'), 'pypi');
  assert.equal(ecosystemOfPath('internal/ledger/ledger.go'), 'go');
  assert.equal(ecosystemOfPath('app/Models/Invoice.php'), 'composer');
  assert.equal(ecosystemOfPath('README.md'), null);
  assert.equal(ecosystemOfPath('.github/CODEOWNERS'), null);
  assert.equal(ecosystemOfPath('v1.2/Makefile'), null);
  assert.equal(packageApplies('npm:stripe', 'src/api.ts'), true);
  assert.equal(packageApplies('npm:stripe', 'app/billing.py'), false);
});
