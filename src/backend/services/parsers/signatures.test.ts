/**
 * Signatures (Phase 32 A2.1): a symbol's shape, as the contract signal will
 * compare it. The rule the whole feature rests on is principle 1 of the
 * awareness spec — stay quiet for ordinary edits — so each language is held
 * to it: a body edit, a comment or a reformat keeps the signature; a
 * parameter, a return type or a member changes it.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { initParser, parseVirtualFile } from '../ast-parser';
import type { ParsedSymbol } from '../../../shared/types';

before(async () => { await initParser(); });

/** name → signature, members as `Class.member`. */
function signatures(file: string, source: string): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  const visit = (list: ParsedSymbol[], parent: string | null) => {
    for (const s of list) {
      const name = parent ? `${parent}.${s.name}` : s.name;
      out[name] = s.signature;
      visit(s.children, name);
    }
  };
  visit(parseVirtualFile(file, source)?.symbols ?? [], null);
  return out;
}
const sig = (file: string, source: string, name: string) => signatures(file, source)[name];

describe('TypeScript', () => {
  const F = 'src/invoice.ts';

  test('parameters, type parameters and the return type make the signature', () => {
    assert.equal(sig(F, 'export function createInvoice<T extends Opts>(opts: T, currency?: string): Promise<Invoice> { return x }', 'createInvoice'),
      '<T extends Opts>(opts: T, currency?: string): Promise<Invoice>');
  });

  test('a body edit, a comment and a reformat keep it', () => {
    const base = sig(F, 'export function f(a: number, b: string): boolean {\n  return a > 0\n}', 'f');
    assert.equal(sig(F, 'export function f(a: number, b: string): boolean {\n  const x = 1\n  return a > x\n}', 'f'), base, 'body');
    assert.equal(sig(F, 'export function f(\n  a: number, // the count\n  b: string,\n): boolean { return a > 0 }', 'f'), base, 'reformat and comment');
  });

  test('adding, renaming or retyping a parameter changes it, and so does the return type', () => {
    const base = sig(F, 'export function f(a: number): boolean { return true }', 'f');
    for (const changed of [
      'export function f(a: number, b = 2): boolean { return true }',
      'export function f(count: number): boolean { return true }',
      'export function f(a: string): boolean { return true }',
      'export function f(a: number): number { return 1 }',
    ]) assert.notEqual(sig(F, changed, 'f'), base, changed);
  });

  test('arrow functions, including one bare parameter and a declared type', () => {
    const s = signatures(F, 'export const one = x => x + 1\nexport const handler: Handler = async (req, res) => { res.end() }');
    assert.equal(s.one, '(x)');
    assert.equal(s.handler, '(req, res): Handler');
  });

  test('a method has one; a class does not (its members carry theirs); a field has its type', () => {
    const s = signatures(F, 'export class Svc {\n  private readonly name: string = "x"\n  async run(n: number, ...rest: string[]): Promise<void> {}\n}');
    assert.equal(s.Svc, undefined);
    assert.equal(s['Svc.run'], '(n: number, ...rest: string[]): Promise<void>');
    assert.equal(s['Svc.name'], ': string');
  });

  test("an interface's and a type's shape are their members", () => {
    const base = signatures(F, 'export interface Invoice extends Base { id: string; total: number }\nexport type Money = { amount: number }');
    assert.equal(base.Invoice, 'extends Base { id: string total: number }');
    assert.equal(base.Money, '{ amount: number }');
    const grown = signatures(F, 'export interface Invoice extends Base {\n  id: string // key\n  total: number\n  currency: string\n}\nexport type Money = { amount: number; currency: string }');
    assert.notEqual(grown.Invoice, base.Invoice);
    assert.notEqual(grown.Money, base.Money);
    // Comments and layout inside an interface don't count.
    assert.equal(signatures(F, 'export interface Invoice extends Base {\n  id: string // key\n  total: number\n}').Invoice, base.Invoice);
  });
});

describe('JavaScript', () => {
  test('parameters, with defaults and destructuring', () => {
    const s = signatures('src/a.js', 'export function f(a, b = 1, { c } = {}) { return a }\nconst g = function (x) { return x }');
    assert.equal(s.f, '(a, b = 1, { c } = { })');
    assert.equal(s.g, '(x)');
    assert.equal(sig('src/a.js', 'export function f(a, b = 1, { c } = {}) { return a + 1 }', 'f'), s.f, 'a body edit keeps it');
  });
});

describe('Python', () => {
  const F = 'app/invoice.py';

  test('parameters and the return annotation', () => {
    assert.equal(sig(F, 'def create_invoice(opts: dict, currency: str = "GBP", *args, **kw) -> "Invoice":\n    return 1\n', 'create_invoice'),
      '(opts: dict, currency: str = "GBP", *args, **kw) -> "Invoice"');
  });

  test('a body edit and a comment keep it; a decorator does not change how it is called', () => {
    const base = sig(F, 'def f(a: int) -> int:\n    return a\n', 'f');
    assert.equal(sig(F, 'def f(a: int) -> int:  # doubled\n    return a * 2\n', 'f'), base);
    assert.equal(sig(F, '@lru_cache\ndef f(a: int) -> int:\n    return a\n', 'f'), base);
  });

  test('a new parameter or return type changes it', () => {
    const base = sig(F, 'def f(a: int) -> int:\n    return a\n', 'f');
    assert.notEqual(sig(F, 'def f(a: int, b: int = 0) -> int:\n    return a\n', 'f'), base);
    assert.notEqual(sig(F, 'def f(a: int) -> str:\n    return a\n', 'f'), base);
  });

  test('methods and async functions have one; classes do not', () => {
    const s = signatures(F, 'class Svc:\n    def run(self, n: int) -> None:\n        pass\n\nasync def fetch(url) -> bytes:\n    pass\n');
    assert.equal(s.Svc, undefined);
    assert.equal(s['Svc.run'], '(self, n: int) -> None');
    assert.equal(s.fetch, '(url) -> bytes');
  });
});

/**
 * The other eight languages (A2.7), each held to the same contract: a body
 * edit, a comment and a reformat keep the signature; a parameter, a return
 * type and a type parameter change it. `base` is the function as written,
 * `same` the same function edited inside its body, commented and
 * reformatted, and each of `changed` alters its shape.
 */
const CASES: Array<{ lang: string; file: string; name: string; base: string; expect: string; same: string; changed: string[] }> = [
  {
    lang: 'Go', file: 'ledger/post.go', name: 'Post',
    base: 'package ledger\n\nfunc Post(amount int, memo string) (int, error) { return amount, nil }\n',
    expect: '(amount int, memo string) (int, error)',
    same: 'package ledger\n\n// Post records it.\nfunc Post(\n\tamount int, // cents\n\tmemo string,\n) (int, error) {\n\tlog(memo)\n\treturn amount * 2, nil\n}\n',
    changed: [
      'package ledger\n\nfunc Post(amount int64, memo string) (int, error) { return 0, nil }\n',
      'package ledger\n\nfunc Post(amount int, memo string) error { return nil }\n',
      'package ledger\n\nfunc Post[T any](amount int, memo string) (int, error) { return amount, nil }\n',
    ],
  },
  {
    lang: 'Go, a method (its receiver is its name, not its shape)', file: 'ledger/post.go', name: '(Ledger).Post',
    base: 'package ledger\n\nfunc (l *Ledger) Post(amount int) error { return nil }\n',
    expect: '(amount int) error',
    same: 'package ledger\n\nfunc (led *Ledger) Post(amount int) error {\n\treturn led.add(amount)\n}\n',
    changed: ['package ledger\n\nfunc (l *Ledger) Post(amount int, at time.Time) error { return nil }\n'],
  },
  {
    lang: 'Rust', file: 'src/ledger.rs', name: 'post',
    base: 'pub fn post(amount: i64, memo: &str) -> Result<i64, Error> { Ok(amount) }\n',
    expect: '(amount: i64, memo: &str) -> Result<i64, Error>',
    same: '/// Posts it.\npub fn post(\n    amount: i64, // cents\n    memo: &str,\n) -> Result<i64, Error> {\n    Ok(amount * 2)\n}\n',
    changed: [
      'pub fn post(amount: i32, memo: &str) -> Result<i64, Error> { Ok(0) }\n',
      'pub fn post(amount: i64, memo: &str) -> i64 { amount }\n',
      'pub fn post<T: Into<i64>>(amount: T, memo: &str) -> Result<i64, Error> { Ok(0) }\n',
    ],
  },
  {
    lang: 'Java', file: 'src/Ledger.java', name: 'Ledger.post',
    base: 'public class Ledger {\n  public int post(int amount, String memo) throws IOException { return amount; }\n}\n',
    expect: 'int (int amount, String memo) throws IOException',
    same: 'public class Ledger {\n  /** Posts it. */\n  @Override\n  public int post(\n      int amount, // cents\n      String memo) throws IOException {\n    return amount * 2;\n  }\n}\n',
    changed: [
      'public class Ledger {\n  public int post(long amount, String memo) throws IOException { return 0; }\n}\n',
      'public class Ledger {\n  public long post(int amount, String memo) throws IOException { return 0; }\n}\n',
      'public class Ledger {\n  public int post(int amount, String memo) { return 0; }\n}\n',
    ],
  },
  {
    lang: 'C#', file: 'src/Ledger.cs', name: 'Ledger.Post',
    base: 'public class Ledger {\n  public int Post(int amount, string memo = "") { return amount; }\n}\n',
    expect: 'int (int amount, string memo = "")',
    same: 'public class Ledger {\n  /// <summary>Posts it.</summary>\n  [Obsolete]\n  public int Post(\n    int amount, // cents\n    string memo = "") => amount * 2;\n}\n',
    changed: [
      'public class Ledger {\n  public int Post(decimal amount, string memo = "") { return 0; }\n}\n',
      'public class Ledger {\n  public Task<int> Post(int amount, string memo = "") { return null; }\n}\n',
      'public class Ledger {\n  public int Post<T>(int amount, string memo = "") { return 0; }\n}\n',
    ],
  },
  {
    lang: 'Kotlin', file: 'src/Ledger.kt', name: 'Ledger.post',
    base: 'class Ledger {\n  fun post(amount: Int, memo: String = ""): Int { return amount }\n}\n',
    expect: '(amount: Int, memo: String = ""): Int',
    same: 'class Ledger {\n  // Posts it.\n  fun post(\n    amount: Int, // cents\n    memo: String = "",\n  ): Int = amount * 2\n}\n',
    changed: [
      'class Ledger {\n  fun post(amount: Long, memo: String = ""): Int { return 0 }\n}\n',
      'class Ledger {\n  fun post(amount: Int, memo: String = ""): Long { return 0 }\n}\n',
      'class Ledger {\n  fun <T> post(amount: Int, memo: String = ""): Int { return 0 }\n}\n',
    ],
  },
  {
    lang: 'Swift', file: 'Sources/Ledger.swift', name: 'Ledger.post',
    base: 'class Ledger {\n  func post(amount: Int, memo: String) throws -> Int { return amount }\n}\n',
    expect: '(amount: Int, memo: String) throws -> Int',
    same: 'class Ledger {\n  /// Posts it.\n  func post(\n    amount: Int, // cents\n    memo: String\n  ) throws -> Int {\n    return amount * 2\n  }\n}\n',
    changed: [
      'class Ledger {\n  func post(_ amount: Int, memo: String) throws -> Int { return 0 }\n}\n',
      'class Ledger {\n  func post(amount: Int, memo: String) -> Int { return 0 }\n}\n',
      'class Ledger {\n  func post<T>(amount: Int, memo: String) throws -> Int { return 0 }\n}\n',
    ],
  },
  {
    lang: 'Ruby', file: 'lib/ledger.rb', name: 'Ledger#post',
    base: 'class Ledger\n  def post(amount, memo = nil)\n    amount\n  end\nend\n',
    expect: '(amount, memo = nil)',
    same: 'class Ledger\n  # Posts it.\n  def post(amount, # cents\n           memo = nil)\n    log(memo)\n    amount * 2\n  end\nend\n',
    changed: [
      'class Ledger\n  def post(amount, memo: nil)\n    amount\n  end\nend\n',
      'class Ledger\n  def post(amount)\n    amount\n  end\nend\n',
    ],
  },
  {
    lang: 'PHP', file: 'src/Ledger.php', name: 'Ledger.post',
    base: '<?php\nclass Ledger {\n  public function post(int $amount, string $memo = ""): int { return $amount; }\n}\n',
    expect: '(int $amount, string $memo = ""): int',
    same: '<?php\nclass Ledger {\n  /** Posts it. */\n  public function post(\n    int $amount, // cents\n    string $memo = "",\n  ): int {\n    return $amount * 2;\n  }\n}\n',
    changed: [
      '<?php\nclass Ledger {\n  public function post(float $amount, string $memo = ""): int { return 0; }\n}\n',
      '<?php\nclass Ledger {\n  public function post(int $amount, string $memo = ""): ?int { return 0; }\n}\n',
    ],
  },
];

for (const c of CASES) {
  describe(c.lang, () => {
    test('its parameters, return type and type parameters make the signature', () => {
      assert.equal(sig(c.file, c.base, c.name), c.expect);
    });
    test('a body edit, a comment and a reformat keep it', () => {
      assert.equal(sig(c.file, c.same, c.name), c.expect);
    });
    test('a parameter, the return type or a type parameter changes it', () => {
      for (const changed of c.changed) {
        const got = sig(c.file, changed, c.name);
        assert.ok(got, `no signature for: ${changed}`);
        assert.notEqual(got, c.expect, changed);
      }
    });
  });
}

describe('what has no signature', () => {
  test('a type in these languages gives none, so a change to it reads "signature unknown", never unchanged', () => {
    assert.equal(sig('ledger/types.go', 'package ledger\n\ntype Entry struct { Amount int }\n', 'Entry'), undefined);
    assert.equal(sig('src/Ledger.kt', 'data class Entry(val amount: Int)\n', 'Entry'), undefined);
  });
  test('a Ruby method with no brackets or parameters still has one', () => {
    assert.equal(sig('lib/ledger.rb', 'def total\n  1\nend\n', 'total'), '()');
    assert.equal(sig('lib/ledger.rb', 'def post amount, memo\n  1\nend\n', 'post'), '(amount, memo)');
  });
});
