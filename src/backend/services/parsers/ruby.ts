import type { ParserPlugin, SyntaxNode } from './base';
import type { ParsedSymbol, ImportDeclaration } from '../../../shared/types';

/**
 * Ruby parser plugin — Phase 27.
 *
 * See [docs/PHASE-27-LANGUAGE-EXPANSION.md](../../../../docs/PHASE-27-LANGUAGE-EXPANSION.md).
 *
 * This closes a live bug rather than adding a language. `'ruby'` was
 * already in `SupportedLanguage` and `.rb` was already in the scanner's
 * `LANG_MAP`, with no parser behind either — so a Rails repository
 * scanned, drew every file as a node, and showed zero symbols and zero
 * edges. Confidently empty, with no error to read. Exactly the state Go
 * was in before Phase 20.
 *
 * tree-sitter-ruby nodes, verified against the committed grammar:
 *
 *   program                 root
 *   class / module          `name` is a `constant`, body is `body_statement`
 *   method                  `def foo`
 *   singleton_method        `def self.foo`
 *   call                    `require`, `attr_reader`, everything else
 *   assignment              `CONST = …`
 *
 * ## Naming
 *
 * Methods are qualified the way Ruby writes them: `Invoice#post` for an
 * instance method, `Invoice.open_invoices` for a class method. Ruby
 * codebases are full of `call`, `run`, `perform` and `to_s` on different
 * classes, so flat names would collide constantly — the same problem Go
 * had with `Handle` and `String`, and the same fix.
 */

function lineOf(node: SyntaxNode): { startLine: number; endLine: number } {
  return { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 };
}

function nameOf(node: SyntaxNode): string | null {
  return node.childForFieldName('name')?.text ?? null;
}

/** The `body_statement` of a class or module, if it has one. */
function bodyOf(node: SyntaxNode): SyntaxNode | null {
  return node.children.find((c: SyntaxNode) => c.type === 'body_statement') ?? null;
}

/** `attr_reader :total, :status` → ['total', 'status']. */
const ATTR_CALLS = new Set(['attr_reader', 'attr_writer', 'attr_accessor']);

function attrNames(call: SyntaxNode): string[] {
  const args = call.children.find((c: SyntaxNode) => c.type === 'argument_list');
  if (!args) return [];
  return args.children
    .filter((c: SyntaxNode) => c.type === 'simple_symbol')
    .map((c: SyntaxNode) => c.text.replace(/^:/, ''))
    .filter(Boolean);
}

/**
 * Symbols declared directly inside a class or module body.
 *
 * Recursive, because Ruby nests freely — `module Billing; class Invoice`
 * is the norm, not an edge case — and a flat walk of the file's top
 * level would miss every method in the codebase.
 */
function symbolsInBody(
  body: SyntaxNode | null,
  qualifier: string | null,
  singleton = false,
): ParsedSymbol[] {
  if (!body) return [];
  const out: ParsedSymbol[] = [];
  // Inside `class << self` every definition is a CLASS method, spelled
  // `Klass.name`, however it is written in the body.
  const sep = singleton ? '.' : '#';

  for (const child of body.children) {
    switch (child.type) {
      case 'method': {
        const name = nameOf(child);
        if (!name) break;
        out.push({
          name: qualifier ? `${qualifier}${sep}${name}` : name,
          kind: 'function',
          ...lineOf(child),
          children: [],
          modifiers: [singleton ? 'class_method' : 'instance_method'],
        });
        break;
      }

      case 'singleton_method': {
        const name = nameOf(child);
        if (!name) break;
        // `def self.foo` — a class method, written `Klass.foo`.
        out.push({
          name: qualifier ? `${qualifier}.${name}` : name,
          kind: 'function',
          ...lineOf(child),
          children: [],
          modifiers: ['class_method'],
        });
        break;
      }

      case 'call': {
        // `attr_reader :total` declares real, referenceable methods; a
        // reader looking for `Invoice#total` should find it.
        const fn = child.children.find((c: SyntaxNode) => c.type === 'identifier')?.text;
        if (!fn || !ATTR_CALLS.has(fn)) break;
        for (const attr of attrNames(child)) {
          out.push({
            name: qualifier ? `${qualifier}${sep}${attr}` : attr,
            // attr_* genuinely defines methods in Ruby, so that is what
            // they are — there is no separate property concept to model.
            kind: 'method',
            ...lineOf(child),
            children: [],
            modifiers: [fn],
          });
        }
        break;
      }

      case 'class':
      case 'module':
        out.push(...classOrModule(child, qualifier));
        break;

      case 'singleton_class': {
        // `class << self` — the canonical way to declare several class
        // methods at once, and it arrives as its own node type rather
        // than as `singleton_method` children. It used to fall through
        // to `default: break`, so a class whose entire public interface
        // was written this way contributed NO symbols at all. ActiveRecord
        // and service-object codebases are full of it.
        const reopened = child.children.find(
          (c: SyntaxNode) => c.type === 'self' || c.type === 'constant',
        );
        // `class << obj` reopens some OTHER object's singleton; those
        // methods do not belong to this class and are not named by it.
        if (reopened?.type !== 'self') break;
        out.push(...symbolsInBody(bodyOf(child), qualifier, true));
        break;
      }

      case 'assignment': {
        // `CONST = …` at class level. Only constants — a local
        // assignment is not part of the public shape.
        const target = child.children[0];
        if (target?.type !== 'constant') break;
        out.push({
          name: qualifier ? `${qualifier}::${target.text}` : target.text,
          kind: 'variable',
          ...lineOf(child),
          children: [],
          modifiers: ['constant'],
        });
        break;
      }

      default:
        break;
    }
  }

  return out;
}

function classOrModule(node: SyntaxNode, parentQualifier: string | null): ParsedSymbol[] {
  const name = nameOf(node);
  if (!name) return [];

  const qualified = parentQualifier ? `${parentQualifier}::${name}` : name;
  const isClass = node.type === 'class';

  const superclass = node.children
    .find((c: SyntaxNode) => c.type === 'superclass')
    ?.text.replace(/^<\s*/, '')
    .trim();

  const modifiers = [isClass ? 'class' : 'module'];
  if (superclass) modifiers.push(`extends:${superclass}`);

  const self: ParsedSymbol = {
    name: qualified,
    kind: isClass ? 'class' : 'interface',
    ...lineOf(node),
    children: [],
    modifiers,
  };

  return [self, ...symbolsInBody(bodyOf(node), qualified)];
}

function extractSymbols(root: SyntaxNode): ParsedSymbol[] {
  const out: ParsedSymbol[] = [];

  for (const child of root.children) {
    switch (child.type) {
      case 'class':
      case 'module':
        out.push(...classOrModule(child, null));
        break;

      case 'method': {
        const name = nameOf(child);
        if (name) {
          out.push({ name, kind: 'function', ...lineOf(child), children: [], modifiers: [] });
        }
        break;
      }

      case 'assignment': {
        const target = child.children[0];
        if (target?.type === 'constant') {
          out.push({
            name: target.text,
            kind: 'variable',
            ...lineOf(child),
            children: [],
            modifiers: ['constant'],
          });
        }
        break;
      }

      default:
        break;
    }
  }

  return out;
}

/**
 * `require 'json'`, `require_relative '../lib/ledger'`.
 *
 * Both are ordinary method calls in Ruby, not syntax, so they arrive as
 * `call` nodes and have to be recognised by name.
 */
const REQUIRE_CALLS = new Set(['require', 'require_relative', 'load', 'autoload']);

/**
 * Requires are collected from the WHOLE tree, not `program`'s direct
 * children.
 *
 * `require` is a method call, so it is legal anywhere an expression is,
 * and the places it actually appears are mostly not the top level: inside
 * a `module`/`class` body, behind an `if RUBY_VERSION` guard, or wrapped
 * in `begin/rescue LoadError` for an optional dependency. Scanning only
 * the top level dropped every one of those — the dependency edge was
 * missing precisely for the conditional dependencies worth seeing.
 */
function* callNodes(node: SyntaxNode): Iterable<SyntaxNode> {
  if (node.type === 'call') yield node;
  for (const child of node.children) yield* callNodes(child);
}

function extractImports(root: SyntaxNode): ImportDeclaration[] {
  const imports: ImportDeclaration[] = [];

  for (const child of callNodes(root)) {
    // The callee must be the FIRST child: `require 'json'`. A call with
    // a receiver (`loader.require 'x'`) puts the receiver there instead,
    // and is not Kernel#require. Matching any identifier child mattered
    // little while this only saw the top level; walking the whole tree,
    // it would start claiming unrelated calls.
    const head = child.children[0];
    const fn = head?.type === 'identifier' ? head.text : undefined;
    if (!fn || !REQUIRE_CALLS.has(fn)) continue;

    const args = child.children.find((c: SyntaxNode) => c.type === 'argument_list');
    if (!args) continue;

    for (const arg of args.children) {
      if (arg.type !== 'string') continue;
      // `'json'` → json. The string node includes its quotes and, in the
      // grammar, `string_content` children.
      const source = arg.text.replace(/^['"]/, '').replace(/['"]$/, '');
      if (!source) continue;

      imports.push({
        source,
        specifiers: [source.split('/').pop() || source],
        isDefault: false,
        isNamespace: false,
        // `require_relative` resolves like a path; `require` is a
        // load-path lookup. Ruby is the first language here where the
        // two are syntactically identical in `source`, so the extractor
        // has to record which was written.
        isRelative: fn === 'require_relative',
      });
    }
  }

  return imports;
}

export const rubyPlugin: ParserPlugin = {
  language: 'ruby',
  extensions: ['.rb', '.rake'],
  grammarFile: 'tree-sitter-ruby.wasm',
  grammarKey: 'ruby',
  extractSymbols,
  extractImports,
};
