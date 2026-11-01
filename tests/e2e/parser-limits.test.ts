/**
 * One file a parser plugin cannot finish costs that file what it could not read.
 *
 * Nesting too deep for the call stack threw out of a plugin, and nothing caught
 * it, so it ended the scan's whole AST pass: no file had symbols or imports, and
 * rules had nothing to read. These files are small, because depth takes no size.
 * Generated code is the realistic source. Every language is here, nested both
 * ways, because which plugins recurse is not something to keep in mind.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';

const N = 20_000;
const nest = (open: string, close: string, inner = '') => open.repeat(N) + inner + close.repeat(N);

/** Deep expressions, and deep declarations, in every language with a plugin. */
const DEEP: Record<string, string> = {
  'deep/expr.rb': `require 'stripe'\nX = ${nest('[', ']')}\nrequire 'after_deep'\n`,
  'deep/mods.rb': `${nest('module A\n', 'end\n', "require 'stripe'\n")}`,
  'deep/classes.rb': `require 'stripe'\n${nest('class A\n', 'end\n')}`,
  'deep/expr.py': `import stripe\nx = ${nest('[', ']')}\n`,
  'deep/expr.ts': `import 'stripe';\nconst x = ${nest('[', ']')};\n`,
  'deep/ns.ts': `import 'stripe';\n${nest('namespace A {', '}')}\n`,
  'deep/expr.js': `require('stripe');\nconst x = ${nest('[', ']')};\n`,
  'deep/expr.rs': `use stripe::X;\nfn f() { let x = ${nest('(', ')', '1')}; }\n`,
  'deep/mods.rs': `use stripe::X;\n${nest('mod a {', '}')}\n`,
  'deep/expr.go': `package deep\nimport "github.com/stripe/stripe-go"\nvar a = ${nest('(', ')', '1')}\n`,
  'deep/Expr.java': `import stripe.X;\nclass Expr { int a = ${nest('(', ')', '1')}; }\n`,
  'deep/Classes.java': `import stripe.X;\n${nest('class A {', '}')}\n`,
  'deep/Expr.cs': `using Stripe;\nclass Expr { int a = ${nest('(', ')', '1')}; }\n`,
  'deep/Classes.cs': `using Stripe;\n${nest('class A {', '}')}\n`,
  'deep/Namespaces.cs': `using Stripe;\n${nest('namespace A {', '}')}\n`,
  'deep/Expr.kt': `import stripe.X\nval a = ${nest('(', ')', '1')}\n`,
  'deep/Classes.kt': `import stripe.X\n${nest('class A {', '}')}\n`,
  'deep/Expr.swift': `import Stripe\nlet a = ${nest('(', ')', '1')}\n`,
  'deep/Classes.swift': `import Stripe\n${nest('class A {', '}')}\n`,
  'deep/expr.php': `<?php\nuse Stripe\\X;\n$a = ${nest('[', ']')};\n`,
};

const SUITE = `suite: limits
rules:
  - id: gem-ledger
    kind: package
    package: gem:acme_ledger
    only: [lib/allowed.rb]
    strength: block
  - id: gem-stripe
    kind: package
    package: gem:stripe
    only: [lib/allowed.rb]
    strength: block
`;

interface RuleView { rule: { id: string }; breaches: Array<{ from: string; to: string }> | null }

test.describe.serial('A file a parser cannot finish', () => {
  test.setTimeout(240_000);
  let h: Harness;
  let root: string;

  const breachesOf = async (id: string) => {
    const res = await h.client.raw('GET', `/api/rules?project=${encodeURIComponent(root)}`);
    const rules = ((await res.json()) as { rules: RuleView[] }).rules;
    return (rules.find((r) => r.rule.id === id)?.breaches ?? []).map((b) => `${b.from} > ${b.to}`).sort();
  };
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };

  test.beforeAll(async () => {
    h = await setupHarness('parser-limits');
    root = h.fixture.projectPath;
    write('lib/allowed.rb', "require 'acme_ledger'\nrequire 'stripe'\n");
    write('lib/ordinary.rb', "require 'acme_ledger'\nclass Ordinary\n  def go; end\nend\n");
    write('.codetrellis/rules/limits.yaml', SUITE);
    for (const [rel, text] of Object.entries(DEEP)) write(rel, text);
    await h.client.scanProject(root);
  });

  test.afterAll(async () => {
    await h?.teardown();
  });

  test('the rest of the project keeps its graph', async () => {
    expect(await breachesOf('gem-ledger')).toEqual(['lib/ordinary.rb > gem:acme_ledger']);
    const res = await h.client.raw('GET', `/api/symbols/search?q=Ordinary&project=${encodeURIComponent(root)}`);
    expect(JSON.stringify(await res.json())).toContain('Ordinary');
  });

  test('its own imports are still read, even when its declarations nest too deep to list', async () => {
    expect(await breachesOf('gem-stripe')).toEqual([
      'deep/classes.rb > gem:stripe',
      'deep/expr.rb > gem:stripe',
      'deep/mods.rb > gem:stripe',
    ]);
  });

  test('the check still judges a change that holds one', () => {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-qm', 'base', '--allow-empty');
    write('lib/added.rb', "require 'acme_ledger'\n");
    write('deep/added.rb', `X = ${nest('[', ']')}\n`);
    write('deep/AddedClasses.cs', nest('class A {', '}'));

    const cli = path.resolve(__dirname, '../../bin/codetrellis.mjs');
    const env = { ...process.env, CODETRELLIS_DATA_DIR: path.join(h.fixture.dataDir, 'cli') };
    const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd: root, env, encoding: 'utf8' });
    try {
      expect(run('start', '--quiet').status).toBe(0);
      const check = run('check', '--base', 'HEAD');
      expect(check.stdout).toContain('lib/added.rb');
      expect(check.stdout).not.toContain('not checked');
      expect(check.status).toBe(3);
    } finally {
      run('stop');
    }
  });
});
