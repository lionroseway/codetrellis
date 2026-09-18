/**
 * The project root is never read raw — Phase 19.
 *
 * `resolveTrustedProjectRoot()` has existed for a long time and was
 * called **once** in `server.ts`, while twenty-six handlers read
 * `req.query.project` and passed it straight on. The rule in CLAUDE.md
 * is worded "never accept `projectRoot` / `projectPath` from a request
 * body", and the wording turned out to be narrower than the rule: a
 * query parameter is exactly as caller-nominated as a body field, and
 * several of those paths become the working directory of a `git`
 * invocation.
 *
 * Fixing twenty-six call sites leaves a twenty-seventh to be written
 * next month, which is why this test exists rather than only the
 * end-to-end one. A new handler that reads the parameter raw is not a
 * type error, fails no other test, and looks exactly like the twenty-six
 * that came before it.
 *
 * This is the same move as `getParseableExtensions()`,
 * `findUnparsedLanguages()` and `flattenSymbols()` elsewhere in this
 * codebase: derive the second thing from the first, or assert they
 * agree. Never ask the next person to remember.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SERVER = path.resolve(import.meta.dirname, 'server.ts');

/** The two functions allowed to touch the raw parameter. */
const READERS = ['requireProjectRoot', 'optionalProjectRoot'];

describe('project-root confinement', () => {
  test('req.query.project is read only inside the two confining helpers', () => {
    const lines = fs.readFileSync(SERVER, 'utf-8').split('\n');

    // Walk the file tracking which function body we are inside. Both
    // helpers are top-level `function` declarations, so a line is
    // "inside a reader" from its declaration until the next top-level
    // closing brace.
    let insideReader = false;
    const offenders: Array<{ line: number; text: string }> = [];

    for (const [i, raw] of lines.entries()) {
      if (READERS.some((n) => raw.startsWith(`function ${n}(`))) insideReader = true;
      else if (insideReader && raw === '}') insideReader = false;

      if (!raw.includes('req.query.project')) continue;
      if (insideReader) continue;
      // A mention in a comment is documentation, not a read.
      const code = raw.trim();
      if (code.startsWith('*') || code.startsWith('//')) continue;

      offenders.push({ line: i + 1, text: code });
    }

    assert.deepEqual(
      offenders,
      [],
      'A handler is reading the project path raw. Use requireProjectRoot / ' +
      'optionalProjectRoot — see the note above them in server.ts.\n' +
      offenders.map((o) => `  server.ts:${o.line}  ${o.text}`).join('\n'),
    );
  });

  test('both helpers resolve through the trusted-root check', () => {
    // The guard above is only worth anything while the helpers actually
    // confine. If someone "simplified" one to return the raw value, the
    // first test would still pass and every endpoint would be open
    // again.
    const source = fs.readFileSync(SERVER, 'utf-8');
    for (const name of READERS) {
      const start = source.indexOf(`function ${name}(`);
      assert.notEqual(start, -1, `${name} is missing`);
      const body = source.slice(start, source.indexOf('\n}', start));
      assert.ok(
        body.includes('resolveTrustedProjectRoot'),
        `${name} no longer resolves through the trusted-root check`,
      );
    }
  });

  test('every handler that takes a project path stops when one is refused', () => {
    // Both helpers respond on refusal and return null. A handler that
    // called one and carried on would send a second response and use an
    // unconfined value; this catches the missing early return.
    const lines = fs.readFileSync(SERVER, 'utf-8').split('\n');
    const missing: string[] = [];

    for (const [i, raw] of lines.entries()) {
      const call = raw.match(/const (\w+) = (require|optional)ProjectRoot\(req, res\);/);
      if (!call) continue;
      const [, variable, kind] = call;
      const next = (lines[i + 1] ?? '').trim();
      const expected = kind === 'require'
        ? `if (!${variable}) return;`
        : `if (${variable} === null) return;`;
      if (next !== expected) missing.push(`server.ts:${i + 2} expected \`${expected}\`, found \`${next}\``);
    }

    assert.deepEqual(missing, [], `Refusal is not handled:\n${missing.join('\n')}`);
  });
});
