/**
 * A rule sees an import wherever the language lets a file write one: a `use` in
 * a Rust function or test module, a `using` in a C# namespace, a `require` or an
 * `import()` in TypeScript. These parsers read only the top level, so a package
 * rule under-reported without saying so. The parsers' own tests hold what each
 * one reads (parsers/nested-imports.test.ts); this holds that a rule gets it,
 * through a scan and through the check that gates a change.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';

const SUITE = `suite: nested
rules:
  - id: cargo-stripe
    kind: package
    package: cargo:stripe
    only: [rs/billing/]
    strength: block
  - id: nuget-stripe
    kind: package
    package: nuget:Stripe
    only: [cs/Billing/]
    strength: block
  - id: npm-stripe
    kind: package
    package: npm:stripe
    only: [ts/billing/]
    strength: block
  - id: web-not-db
    from: ts/web/
    mayNotImport: ts/db/
    strength: block
  - id: raw-only-in-db
    kind: symbol
    symbol: ts/db/conn.ts#raw
    only: [ts/db/]
    strength: block
`;

const FILES: Record<string, string> = {
  // Rust
  'rs/billing/charge.rs': 'fn charge() { use stripe::Charge; }\n',
  'rs/app/in_function.rs': 'fn f() { use stripe::Charge; }\n',
  'rs/app/in_test_module.rs': '#[cfg(test)]\nmod tests {\n    use stripe::mock;\n}\n',
  'rs/app/in_pub_use.rs': 'mod inner { pub use stripe::Charge; }\n',
  'rs/app/top.rs': 'use stripe::Charge;\n',
  'rs/app/clean.rs': 'fn f() { use serde::Deserialize; }\n',
  // C#
  'cs/Billing/Charge.cs': 'namespace Billing { using Stripe; class Charge {} }\n',
  'cs/App/InNamespace.cs': 'namespace App { using Stripe; class A {} }\n',
  'cs/App/InNestedNamespace.cs': 'namespace App { namespace Inner { using Stripe.Checkout; class B {} } }\n',
  'cs/App/InIf.cs': '#if NET6_0\nusing Stripe;\n#endif\nclass C {}\n',
  'cs/App/Top.cs': 'using Stripe;\nclass D {}\n',
  'cs/App/Clean.cs': 'namespace App { using Striped; class E { void M() { using var s = Open(); } } }\n',
  // TypeScript and JavaScript
  'ts/billing/charge.ts': "const stripe = require('stripe');\nexport { stripe };\n",
  'ts/web/top.ts': "import Stripe from 'stripe';\nexport { Stripe };\n",
  'ts/web/in_require.js': "function f() {\n  return require('stripe');\n}\nmodule.exports = { f };\n",
  'ts/web/in_import.ts': "export async function f() {\n  return import('stripe');\n}\n",
  'ts/web/clean.ts': "export const s = require('striped');\nexport const name = 'stripe';\nexport const where = require.resolve('stripe');\n",
  // An imports rule and a symbol rule read the same calls.
  'ts/db/conn.ts': 'export function raw(sql: string) { return sql; }\nexport function safe(sql: string) { return sql; }\n',
  'ts/web/uses_raw.ts': "export function view() {\n  const { raw } = require('../db/conn');\n  return raw('select 1');\n}\n",
};

interface RuleView { rule: { id: string }; breaches: Array<{ from: string; to: string }> | null }

test.describe.serial('Imports at any depth, in Rust, C# and TypeScript', () => {
  test.setTimeout(240_000);
  let h: Harness;
  let root: string;

  const breachesOf = async (id: string) => {
    const res = await h.client.raw('GET', `/api/rules?project=${encodeURIComponent(root)}`);
    const rules = ((await res.json()) as { rules: RuleView[] }).rules;
    return (rules.find((r) => r.rule.id === id)?.breaches ?? []).map((b) => `${b.from} > ${b.to}`).sort();
  };

  test.beforeAll(async () => {
    h = await setupHarness('nested-imports');
    root = h.fixture.projectPath;
    for (const [rel, text] of Object.entries({ ...FILES, '.codetrellis/rules/nested.yaml': SUITE })) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), text);
    }
    await h.client.scanProject(root);
  });

  test.afterAll(async () => {
    await h?.teardown();
  });

  test('Rust: in a function, a test module and a pub use; its own folder may', async () => {
    expect(await breachesOf('cargo-stripe')).toEqual([
      'rs/app/in_function.rs > cargo:stripe',
      'rs/app/in_pub_use.rs > cargo:stripe',
      'rs/app/in_test_module.rs > cargo:stripe',
      'rs/app/top.rs > cargo:stripe',
    ]);
  });

  test('C#: in a namespace, however nested, and an #if; its own folder may', async () => {
    expect(await breachesOf('nuget-stripe')).toEqual([
      'cs/App/InIf.cs > nuget:Stripe',
      'cs/App/InNamespace.cs > nuget:Stripe',
      'cs/App/InNestedNamespace.cs > nuget:Stripe.Checkout',
      'cs/App/Top.cs > nuget:Stripe',
    ]);
  });

  test('TypeScript and JavaScript: require and import(); require.resolve and a look-alike are not it', async () => {
    expect(await breachesOf('npm-stripe')).toEqual([
      'ts/web/in_import.ts > npm:stripe',
      'ts/web/in_require.js > npm:stripe',
      'ts/web/top.ts > npm:stripe',
    ]);
  });

  test('an imports rule and a symbol rule see a require too', async () => {
    expect(await breachesOf('web-not-db')).toEqual(['ts/web/uses_raw.ts > ts/db/conn.ts']);
    expect(await breachesOf('raw-only-in-db')).toEqual(['ts/web/uses_raw.ts > ts/db/conn.ts#raw']);
  });

  test('a require of another export of the same file is not a use of this one', async () => {
    fs.writeFileSync(path.join(root, 'ts/web/uses_raw.ts'), "export function view() {\n  const { safe } = require('../db/conn');\n  return safe('select 1');\n}\n");
    await h.client.scanProject(root);
    expect(await breachesOf('raw-only-in-db')).toEqual([]);
    expect(await breachesOf('web-not-db')).toEqual(['ts/web/uses_raw.ts > ts/db/conn.ts']);
  });

  test('the check fails a change that adds one, naming the rule', () => {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    if (!fs.existsSync(path.join(root, '.git'))) git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-qm', 'base', '--allow-empty');
    const body = "export async function later() {\n  return import('stripe');\n}\n";
    fs.writeFileSync(path.join(root, 'ts/web/added.ts'), body);

    const cli = path.resolve(__dirname, '../../bin/codetrellis.mjs');
    const env = { ...process.env, CODETRELLIS_DATA_DIR: path.join(h.fixture.dataDir, 'cli') };
    const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd: root, env, encoding: 'utf8' });
    try {
      expect(run('start', '--quiet').status).toBe(0);
      const check = run('check', '--base', 'HEAD');
      expect(check.stdout).toContain('npm-stripe');
      expect(check.stdout).toContain('ts/web/added.ts');
      expect(check.stdout).toContain('npm:stripe');
      expect(check.status).toBe(3);
    } finally {
      run('stop');
    }
  });
});
