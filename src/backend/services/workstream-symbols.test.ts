/**
 * Which symbols a workstream's changes touch (Phase 32 A1.5): one fixture
 * per language, parsed by the app's real tree-sitter parser, in a real
 * repository with a linked worktree.
 *
 * Each fixture starts from the same shape — a function kept as is, a member
 * whose body the worktree edits, a function it deletes — and the worktree
 * adds one new function. What must come back is exactly: one added, one
 * modified, one removed, and nothing for the untouched symbols.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { initParser, parseVirtualFile } from './ast-parser';
import { computeChanges } from './workstream-watch-service';
import { diffSymbols, flatSymbols, withSymbolChanges, clearSymbolCache, pythonAll, type SymbolParser } from './workstream-symbols';
import type { ParsedSymbol } from '../../shared/types';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { env: ENV, encoding: 'utf-8' });
const parse: SymbolParser = (p, c) => parseVirtualFile(p, c)?.symbols ?? null;

interface Fixture { file: string; base: string; changed: string; expect: string[] }

/** base → changed, and the symbol changes that must be reported. */
const FIXTURES: Record<string, Fixture> = {
  typescript: {
    file: 'src/session.ts',
    base: 'export function keep() { return 1 }\nexport class Session {\n  renew() { return 1 }\n  stay() { return 1 }\n}\nexport function gone() { return 0 }\n',
    changed: 'export function keep() { return 1 }\nexport class Session {\n  renew() { return 2 }\n  stay() { return 1 }\n}\nexport function refresh() { return 3 }\n',
    expect: ['modified method Session.renew', 'added function refresh', 'removed function gone'],
  },
  python: {
    file: 'app/session.py',
    base: 'def keep():\n    return 1\n\nclass Session:\n    def renew(self):\n        return 1\n\n    def stay(self):\n        return 1\n\ndef gone():\n    return 0\n',
    changed: 'def keep():\n    return 1\n\nclass Session:\n    def renew(self):\n        return 2\n\n    def stay(self):\n        return 1\n\ndef refresh():\n    return 3\n',
    expect: ['modified method Session.renew', 'added function refresh', 'removed function gone'],
  },
  go: {
    file: 'ledger/session.go',
    base: 'package ledger\n\nfunc Keep() int { return 1 }\n\ntype Session struct{}\n\nfunc (s Session) Renew() int { return 1 }\n\nfunc Gone() int { return 0 }\n',
    changed: 'package ledger\n\nfunc Keep() int { return 1 }\n\ntype Session struct{}\n\nfunc (s Session) Renew() int { return 2 }\n\nfunc Refresh() int { return 3 }\n',
    expect: ['modified function (Session).Renew', 'added function Refresh', 'removed function Gone'],
  },
  java: {
    file: 'src/Session.java',
    base: 'class Session {\n  int renew() { return 1; }\n  int stay() { return 1; }\n  int gone() { return 0; }\n}\n',
    changed: 'class Session {\n  int renew() { return 2; }\n  int stay() { return 1; }\n  int refresh() { return 3; }\n}\n',
    expect: ['modified method Session.renew', 'added method Session.refresh', 'removed method Session.gone'],
  },
  ruby: {
    file: 'lib/session.rb',
    base: 'class Session\n  def renew\n    1\n  end\n\n  def stay\n    1\n  end\nend\n\ndef gone\n  0\nend\n',
    changed: 'class Session\n  def renew\n    2\n  end\n\n  def stay\n    1\n  end\nend\n\ndef refresh\n  3\nend\n',
    expect: ['modified function Session#renew', 'added function refresh', 'removed function gone'],
  },
};

let tmp: string;
let main: string;
let tree: string;

before(async () => {
  await initParser();
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ws-symbols-')));
  main = path.join(tmp, 'app');
  tree = path.join(tmp, 'app-feature');
  fs.mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  for (const f of Object.values(FIXTURES)) {
    fs.mkdirSync(path.dirname(path.join(main, f.file)), { recursive: true });
    fs.writeFileSync(path.join(main, f.file), f.base);
  }
  fs.writeFileSync(path.join(main, 'README.md'), '# app\n');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'init');
  git(main, 'worktree', 'add', '-q', tree, '-b', 'feature');
  for (const f of Object.values(FIXTURES)) fs.writeFileSync(path.join(tree, f.file), f.changed);
  fs.writeFileSync(path.join(tree, 'README.md'), '# app, changed\n');
  fs.writeFileSync(path.join(tree, 'src/new.ts'), 'export function brandNew() { return 1 }\n');
});

beforeEach(() => clearSymbolCache());

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const described = (symbols: { change: string; kind: string; name: string }[] | undefined) =>
  (symbols ?? []).map((s) => `${s.change} ${s.kind} ${s.name}`);

describe('symbol changes per language, against the merge base', () => {
  for (const [lang, f] of Object.entries(FIXTURES)) {
    test(lang, () => {
      const changes = withSymbolChanges(tree, computeChanges(tree, 'main'), parse);
      const file = changes.files.find((x) => x.path === f.file);
      assert.ok(file, `${f.file} is a changed file`);
      assert.deepEqual(described(file!.symbols).sort(), [...f.expect].sort());
    });
  }
});

describe('what is not a symbol change', () => {
  test('a file in a language we do not parse keeps its path and carries no symbols', () => {
    const changes = withSymbolChanges(tree, computeChanges(tree, 'main'), parse);
    const readme = changes.files.find((x) => x.path === 'README.md')!;
    assert.equal(readme.status, 'modified');
    assert.equal(readme.symbols, undefined, 'unparsed, which is not the same as "changed no symbols"');
  });

  test('a new file: every symbol in it is added', () => {
    const changes = withSymbolChanges(tree, computeChanges(tree, 'main'), parse);
    assert.deepEqual(described(changes.files.find((x) => x.path === 'src/new.ts')!.symbols), ['added function brandNew']);
  });

  test('a deleted file: every symbol in it is removed', () => {
    fs.rmSync(path.join(tree, 'src/new.ts'));
    const other = path.join(tree, 'ledger/session.go');
    const saved = fs.readFileSync(other, 'utf-8');
    fs.rmSync(other);
    try {
      const changes = withSymbolChanges(tree, computeChanges(tree, 'main'), parse);
      assert.deepEqual(described(changes.files.find((x) => x.path === 'ledger/session.go')!.symbols).sort(), [
        'removed class Session', 'removed function (Session).Renew', 'removed function Gone', 'removed function Keep',
      ]);
    } finally {
      fs.writeFileSync(other, saved);
      fs.writeFileSync(path.join(tree, 'src/new.ts'), 'export function brandNew() { return 1 }\n');
    }
  });

  test('moving a function down the file without changing it is not a change', () => {
    const src = (order: string[]) => order.map((n) => `export function ${n}() { return 1 }\n`).join('\n');
    const syms = (s: string) => flatSymbols(parse('/x/a.ts', s)!, s);
    assert.deepEqual(diffSymbols(syms(src(['a', 'b'])), syms(src(['b', 'a']))), []);
  });

  test("a class is not modified when only its members are; it is when its own text changes", () => {
    const base = 'export class Session {\n  a() { return 1 }\n  b() { return 1 }\n}\n';
    const syms = (src: string) => flatSymbols(parse('/x/a.ts', src)!, src);
    const onlyMember = base.replace('a() { return 1 }', 'a() { return 2 }');
    assert.deepEqual(diffSymbols(syms(base), syms(onlyMember)).map((c) => c.name), ['Session.a']);
    const ownText = base.replace('export class Session {', 'export class Session extends Base {');
    assert.deepEqual(diffSymbols(syms(base), syms(ownText)).map((c) => `${c.change} ${c.name}`), ['modified Session']);
  });

  test('trailing whitespace is not a change; a real edit is', () => {
    const s: ParsedSymbol[] = [{ name: 'f', kind: 'function', startLine: 1, endLine: 1, children: [], modifiers: [] }];
    assert.deepEqual(diffSymbols(flatSymbols(s, 'f() {}'), flatSymbols(s, 'f() {}   ')), []);
    assert.equal(diffSymbols(flatSymbols(s, 'f() {}'), flatSymbols(s, 'f() { x }'))[0].change, 'modified');
  });
});

describe('signature changes (A2.1)', () => {
  const syms = (file: string, src: string) => flatSymbols(parse(file, src)!, src);

  test('a parameter change is a modification that carries the signature before and after', () => {
    const before = 'export function createInvoice(opts: Opts): Invoice { return make(opts) }\n';
    const after = 'export function createInvoice(opts: Opts, currency: string): Invoice { return make(opts) }\n';
    assert.deepEqual(diffSymbols(syms('/x/a.ts', before), syms('/x/a.ts', after)), [{
      name: 'createInvoice', kind: 'function', change: 'modified', line: 1,
      signature: { before: '(opts: Opts): Invoice', after: '(opts: Opts, currency: string): Invoice' },
    }]);
  });

  test('a body-only edit is a modification with no signature on it', () => {
    const before = 'def total(items: list) -> int:\n    return sum(items)\n';
    const after = 'def total(items: list) -> int:\n    return sum(i for i in items if i)\n';
    const [change] = diffSymbols(syms('/x/a.py', before), syms('/x/a.py', after));
    assert.equal(change.change, 'modified');
    assert.equal('signature' in change, false);
  });

  test('a parser that gives no signature says nothing about one', () => {
    const s: ParsedSymbol[] = [{ name: 'f', kind: 'function', startLine: 1, endLine: 1, children: [], modifiers: [] }];
    const withSig: ParsedSymbol[] = [{ ...s[0], signature: '(a)' }];
    assert.equal('signature' in diffSymbols(flatSymbols(s, 'f(a) {}'), flatSymbols(withSig, 'f(a, b) {}'))[0], false);
  });

  test('in a real worktree, a changed method signature is reported with it', () => {
    const file = path.join(tree, 'src/session.ts');
    const saved = fs.readFileSync(file, 'utf-8');
    fs.writeFileSync(file, saved.replace('renew() { return 2 }', 'renew(force: boolean) { return 2 }'));
    try {
      const changes = withSymbolChanges(tree, computeChanges(tree, 'main'), parse);
      const renew = changes.files.find((x) => x.path === 'src/session.ts')!.symbols!.find((x) => x.name === 'Session.renew')!;
      assert.deepEqual(renew.signature, { before: '()', after: '(force: boolean)' });
    } finally {
      fs.writeFileSync(file, saved);
    }
  });

  test("the fixtures' body edits carry no signature", () => {
    const changes = withSymbolChanges(tree, computeChanges(tree, 'main'), parse);
    const withSignature = changes.files.flatMap((f) => (f.symbols ?? []).filter((x) => x.signature).map((x) => `${f.path} ${x.name}`));
    assert.deepEqual(withSignature, []);
  });
});

describe('safety and cost', () => {
  test('a symlink out of the worktree is not read', () => {
    const outside = path.join(tmp, 'secret.ts');
    fs.writeFileSync(outside, 'export function secret() { return 42 }\n');
    const link = path.join(tree, 'src/link.ts');
    fs.symlinkSync(outside, link);
    try {
      const changes = withSymbolChanges(tree, computeChanges(tree, 'main'), parse);
      const f = changes.files.find((x) => x.path === 'src/link.ts');
      assert.ok(f, 'the link itself is a changed file');
      assert.ok(!described(f!.symbols).some((d) => d.includes('secret')), 'its target was not parsed');
    } finally {
      fs.rmSync(link);
    }
  });

  test('an unchanged file is parsed once across repeated listings', () => {
    let calls = 0;
    const counting: SymbolParser = (p, c) => { calls++; return parse(p, c); };
    withSymbolChanges(tree, computeChanges(tree, 'main'), counting);
    const first = calls;
    withSymbolChanges(tree, computeChanges(tree, 'main'), counting);
    assert.ok(first > 0);
    assert.equal(calls, first, 'the second listing hit the cache');
  });
});

describe('what another file can import (A2.3)', () => {
  const syms = (file: string, src: string) => flatSymbols(parse(file, src)!, src, file);
  const exported = (file: string, src: string) => syms(file, src).filter((s) => s.exported).map((s) => s.name).sort();

  test('TS/JS: what is marked export, and the members of an exported class', () => {
    const src = 'export function createInvoice(opts: Opts) {}\nfunction helper() {}\nexport class Session { renew() {} }\nclass Hidden { x() {} }\n';
    assert.deepEqual(exported('/x/billing.ts', src), ['Session', 'Session.renew', 'createInvoice']);
  });

  test('Python: no leading underscore, or listed in __all__', () => {
    const src = '__all__ = ["_legacy_total"]\n\ndef total(items):\n    return 1\n\ndef _helper():\n    return 2\n\ndef _legacy_total():\n    return 3\n';
    assert.deepEqual(exported('/x/db.py', src), ['_legacy_total', 'total']);
  });

  test('__all__ is read as assigned, annotated, tupled or extended', () => {
    assert.deepEqual([...pythonAll("__all__ = ['a', \"b\"]\n__all__ += ('_c',)\n__all__: list[str] = [\n    'd',\n]\n")].sort(), ['_c', 'a', 'b', 'd']);
    assert.deepEqual([...pythonAll('x = ["not_this"]\n')], []);
  });

  test('a language that marks nothing gives no exported flag, so no contract can come from it', () => {
    assert.deepEqual(exported('/x/query.sql', 'SELECT 1;\n'), []);
  });

  test('the other eight, by their own rules (A2.7)', () => {
    assert.deepEqual(exported('/x/ledger.go', 'package ledger\n\nfunc Post() {}\nfunc reset() {}\nfunc (l *Ledger) Total() int { return 0 }\nfunc (l *Ledger) add() {}\n'),
      ['(Ledger).Total', 'Post']);
    assert.deepEqual(exported('/x/ledger.rs', 'pub fn post() {}\nfn helper() {}\npub(crate) struct Ledger {}\n'), ['Ledger', 'post']);
    assert.deepEqual(exported('/x/Ledger.java', 'public class Ledger {\n  public void post() {}\n  void pkg() {}\n  private void helper() {}\n}\n'),
      ['Ledger', 'Ledger.pkg', 'Ledger.post']);
    // C#: members are private unless they say otherwise.
    assert.deepEqual(exported('/x/Ledger.cs', 'public class Ledger {\n  public void Post() {}\n  internal void Near() {}\n  void Helper() {}\n}\n'),
      ['Ledger', 'Ledger.Near', 'Ledger.Post']);
    assert.deepEqual(exported('/x/Ledger.kt', 'class Ledger {\n  fun post() {}\n  private fun helper() {}\n}\nprivate fun local() {}\n'), ['Ledger', 'Ledger.post']);
    assert.deepEqual(exported('/x/Ledger.swift', 'class Ledger {\n  func post() {}\n  private func helper() {}\n  fileprivate func near() {}\n}\n'), ['Ledger', 'Ledger.post']);
    assert.deepEqual(exported('/x/Ledger.php', '<?php\nclass Ledger {\n  public function post() {}\n  function open() {}\n  private function helper() {}\n}\n'), ['Ledger', 'Ledger.open', 'Ledger.post']);
    assert.deepEqual(exported('/x/ledger.rb', 'class Ledger\n  def post\n  end\nend\n'), ['Ledger', 'Ledger#post']);
  });

  test('a change whose shape cannot be compared says so, never "unchanged" (A2.7)', () => {
    const was = 'package ledger\n\ntype Entry struct { Amount int }\n\nfunc Post(a int) error { return nil }\n';
    const now = 'package ledger\n\ntype Entry struct { Amount int; Memo string }\n\nfunc Post(a int) error { return log(a) }\n';
    const changes = diffSymbols(syms('/x/ledger.go', was), syms('/x/ledger.go', now));
    assert.deepEqual(changes.map((c) => [c.name, c.change, c.signatureUnknown ?? false, !!c.signature]), [['Entry', 'modified', true, false], ['Post', 'modified', false, false]]);
  });

  test('a removed or un-exported symbol keeps the flag: its importers break either way', () => {
    const was = 'export function createInvoice(opts: Opts) { return 1 }\nexport function old() {}\n';
    const now = 'function createInvoice(opts: Opts) { return 1 }\n';
    const changes = diffSymbols(syms('/x/a.ts', was), syms('/x/a.ts', now));
    assert.deepEqual(changes.map((c) => [c.name, c.change, c.exported ?? false]), [['createInvoice', 'modified', true], ['old', 'removed', true]]);
  });
});
