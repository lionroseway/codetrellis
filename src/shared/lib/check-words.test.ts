/**
 * Phase 33 C8 — one renderer: one check's result says the same words in the
 * terminal, markdown, SARIF and JSON; a terminal that wants colour gets the
 * same words with colour, and a pipe or NO_COLOR gets none.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findingLine, findingNext, findingTitle, renderMarkdown, renderText, ruleFix, ruleLine, suiteGroups, type CheckResult, type RuleFinding } from './check-words';
import { toSarif } from '../../cli/sarif';
import { wantsColor } from '../../cli/conformity';

const stripe: RuleFinding = {
  path: 'src/checkout/pay.ts', imports: 'npm:stripe', rule: 'stripe-via-wrapper', words: 'only src/payments/index.ts may import npm:stripe',
  because: 'The wrapper sets idempotency keys and retries.', strength: 'block', suite: 'payments', fix: 'use src/payments/index.ts instead',
};
const refund: RuleFinding = {
  path: 'src/admin/refund.ts', imports: 'src/payments/charge.ts', rule: 'charge-from-checkout-only', words: 'src/admin/ may not import src/payments/charge.ts',
  because: 'refunds use refundCharge', strength: 'warn', suite: 'payments', fix: null,
};
const ADDS = '⚠ This change adds the rule “src/ may not import src/http/stripe.ts” (no-direct-stripe-http) at warn. It is checked once it is on the base branch.';
const HELD = '■ src/checkout/pay.ts: Sam set a breakpoint on it (“ask me first”); ask them before changing it';
const FIXTURE: CheckResult = {
  ok: false, files: 3, base: 'origin/main',
  says: [`✗ ${findingLine(stripe)}`, HELD],
  rules: [stripe, refund],
  rulebook: [{ rule: 'no-direct-stripe-http', words: ADDS, effect: 'tightens' }],
  notes: [`⚠ ${findingLine(refund)} (the rule warns; it does not fail the check)`, ADDS],
  checked: [
    { rule: 'stripe-via-wrapper', suite: 'payments', strength: 'block' }, { rule: 'charge-from-checkout-only', suite: 'payments', strength: 'warn' },
    { rule: 'payments-own-db', suite: 'payments', strength: 'block' }, { rule: 'web-not-db', suite: 'architecture', strength: 'block' },
    { rule: 'read-the-guide', suite: 'architecture', strength: 'guide' },
  ],
};
const PLACED: CheckResult = {
  ...FIXTURE,
  rules: [{ ...stripe, line: 14, text: "import Stripe from 'stripe';" }, { ...refund, line: 3, text: "import { createCharge } from '../payments/charge';" }],
};

const TEXT = `Does not conform (3 changed files since origin/main):

payments  ✗ 1 blocks · ⚠ 1 warns · ✓ 1 rule holds

  ✗ stripe-via-wrapper   only src/payments/index.ts may import npm:stripe: The wrapper sets idempotency keys and retries.
      src/checkout/pay.ts:14 imports npm:stripe   import Stripe from 'stripe';
      → use src/payments/index.ts instead

  ⚠ charge-from-checkout-only   src/admin/ may not import src/payments/charge.ts
      src/admin/refund.ts:3 imports src/payments/charge.ts   import { createCharge } from '../payments/charge';
      → refunds use refundCharge

architecture  ✓ 1 rule holds

rulebook
  ${ADDS}

also
  ${HELD}

2 findings block this change (exit 3).`;

test('the terminal: summary first, by suite then rule then place, the fix after →, the exit code in words', () => {
  assert.equal(renderText(PLACED), TEXT);
});

test('colour is only added: without the escapes it is the same text, and NO_COLOR or a pipe gets none', () => {
  const coloured = renderText(PLACED, { color: true });
  assert.notEqual(coloured, TEXT);
  assert.ok(coloured.includes('\x1b[31m✗\x1b[0m'));
  // eslint-disable-next-line no-control-regex
  assert.equal(coloured.replace(/\x1b\[[0-9;]*m/g, ''), TEXT);
  assert.equal(renderText(PLACED, { color: false }), TEXT);
  assert.equal(wantsColor({ isTTY: true }, {}), true);
  assert.equal(wantsColor({ isTTY: false }, {}), false, 'a pipe');
  assert.equal(wantsColor({ isTTY: true }, { NO_COLOR: '1' }), false);
  assert.equal(wantsColor({ isTTY: true }, {}, true), false, '--no-color');
  assert.equal(wantsColor({ isTTY: true }, { TERM: 'dumb' }), false);
  assert.equal(wantsColor({ isTTY: false }, { FORCE_COLOR: '1' }), true);
});

test('markdown carries the same content', () => {
  assert.equal(renderMarkdown(PLACED), `### CodeTrellis check: does not conform

3 changed files since origin/main · 2 findings block this change (exit 3).

**payments** · ✗ 1 blocks · ⚠ 1 warns · ✓ 1 rule holds

- ✗ **\`src/checkout/pay.ts:14 imports npm:stripe\`** · \`stripe-via-wrapper\` (block)  
  only src/payments/index.ts may import npm:stripe: The wrapper sets idempotency keys and retries.  
  → use src/payments/index.ts instead

- ⚠ **\`src/admin/refund.ts:3 imports src/payments/charge.ts\`** · \`charge-from-checkout-only\` (warn)  
  src/admin/ may not import src/payments/charge.ts  
  → refunds use refundCharge

**architecture** · ✓ 1 rule holds

**rulebook**

- ${ADDS}

**also**

- ${HELD}`);
});

test('one run says each finding in the same words in all four formats: text, markdown, SARIF and JSON', () => {
  const text = renderText(PLACED);
  const md = renderMarkdown(PLACED);
  const sarif = JSON.stringify(toSarif({ ...PLACED, breakpoints: [], tests: [], criteria: [], docs: [] }, {
    version: '0', root: '/r', read: (rel) => (rel === stripe.path ? "\n".repeat(13) + "import Stripe from 'stripe';\n" : null), ruleFile: () => '.codetrellis/rules/payments.yaml',
  }));
  const json = JSON.stringify(PLACED);
  for (const f of PLACED.rules) {
    const words = [f.path, f.imports, f.rule, f.words, findingNext(f)!];
    for (const [name, out] of [['text', text], ['markdown', md], ['sarif', sarif], ['json', json]] as const) {
      for (const w of words) assert.ok(out.includes(w), `${name} says “${w}”`);
    }
  }
  for (const out of [text, md]) assert.ok(out.includes(findingTitle(PLACED.rules[0])), 'where and what');
  assert.equal(PLACED.rules[0].line, 14, 'JSON carries where as data');
  // SARIF says the finding's own line, the one `says` carries, then the fix.
  assert.ok(sarif.includes(`${findingLine(stripe)} → ${stripe.fix}`));
});

test('a rule says its fix: the files that may, or the doors through it; else its reason comes next', () => {
  assert.equal(ruleFix({ kind: 'package', only: ['src/payments/index.ts'], except: [] }), 'use src/payments/index.ts instead');
  assert.equal(ruleFix({ except: ['db/types.ts'] }), 'import db/types.ts instead');
  assert.equal(ruleFix({ except: [] }), null);
  assert.equal(findingNext(refund), 'refunds use refundCharge');
  assert.equal(ruleLine(refund.words, refund), refund.words);
});

test('passing says so, and how many rules hold; a guide is not counted', () => {
  const ok: CheckResult = { ...FIXTURE, ok: true, says: [], rules: [], rulebook: [], notes: [] };
  const groups = suiteGroups(ok);
  assert.deepEqual(groups.map((g) => [g.suite, g.holds]), [['architecture', 1], ['payments', 3]]);
  assert.match(renderText(ok), /\n\nNothing blocks this change \(exit 0\)\.$/);
});
