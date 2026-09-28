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

describe('languages without signature support', () => {
  test('give none, so they can raise no contract signal (spec §4.2: no body-hash fallback)', () => {
    assert.equal(sig('ledger/post.go', 'package ledger\n\nfunc Post(amount int) error { return nil }\n', 'Post'), undefined);
  });
});
