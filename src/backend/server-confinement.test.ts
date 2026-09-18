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
 *
 * ## The first version of this guard was too narrow
 *
 * It asserted only that `req.query.project` was not read raw — and the
 * commit that added it claimed "the project root is never read raw",
 * which was not true. A root reaches this server by **three** spellings:
 *
 *   `?project=`   twenty-six handlers
 *   `?path=`      nine more, including every `git/*` route, which run
 *                 git with it as `cwd`
 *   request body  sixteen, which is the CLAUDE.md rule verbatim —
 *                 "never accept projectRoot / projectPath from a
 *                 request body"
 *
 * A guard that covers one spelling of three is worse than none, because
 * it reads as settled. All three are asserted below.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SERVER = path.resolve(import.meta.dirname, 'server.ts');

/** The functions allowed to touch a raw, caller-supplied root. */
const READERS = [
  'confineRoot', 'confineRootOptional',
  'requireProjectRoot', 'optionalProjectRoot', 'requireProjectPath',
];

/**
 * The one handler that legitimately takes an unconfined root: `scan` is
 * how a path BECOMES an opened project, so checking it against the
 * opened-project list would make it impossible to open anything. Its
 * control is the capability token every local transport requires.
 */
const EXEMPT_ROUTES = [
  "app.post('/api/project/scan'",
  // A list key, not a path. Confinement protects a value that is USED as
  // a path — opened, walked, or made a command's working directory.
  // These only index the recent-projects list, and confining them breaks
  // removing a stale entry whose directory has been deleted.
  "app.delete('/api/recent-projects'",
  "app.post('/api/recent-projects/pin'",
];

describe('project-root confinement', () => {
  test('req.query.project is read only inside the two confining helpers', () => {
    const lines = fs.readFileSync(SERVER, 'utf-8').split('\n');

    // Walk the file tracking which function body we are inside. Both
    // helpers are top-level `function` declarations, so a line is
    // "inside a reader" from its declaration until the next top-level
    // closing brace.
    let insideReader = false;
    let exemptDepth = 0;
    const offenders: Array<{ line: number; text: string }> = [];

    for (const [i, raw] of lines.entries()) {
      if (READERS.some((n) => raw.startsWith(`function ${n}(`))) insideReader = true;
      else if (insideReader && raw === '}') insideReader = false;

      const code = raw.trim();
      // A mention in a comment is documentation, not a read.
      if (code.startsWith('*') || code.startsWith('//')) continue;
      if (insideReader) continue;
      if (EXEMPT_ROUTES.some((r) => code.startsWith(r))) { exemptDepth = 1; continue; }
      if (exemptDepth > 0) {
        if (code === '});') exemptDepth = 0;
        continue;
      }

      const readsQueryRoot = code.includes('req.query.project');
      // `?path=` is a project root only where it is bound to one; the
      // file-reading routes use the same parameter name for a file.
      const readsPathRoot = /req\.query\.path/.test(code)
        && /\b(projectPath|projectRoot)\b/.test(code);
      // A body-supplied root is the rule stated verbatim in CLAUDE.md.
      const readsBodyRoot = /req\.body/.test(code)
        && /\b(projectPath|projectRoot)\b/.test(code)
        && !/:\s*raw(ProjectPath|ProjectRoot)/.test(code);

      if (!readsQueryRoot && !readsPathRoot && !readsBodyRoot) continue;

      // A raw value passed straight INTO a confining call is confined.
      // The call can span lines, so look at this line and the two above
      // it for the function name.
      const statement = [lines[i - 2], lines[i - 1], raw].join('\n');
      if (READERS.some((fn) => statement.includes(`${fn}(`))) continue;

      offenders.push({ line: i + 1, text: code });
    }

    assert.deepEqual(
      offenders,
      [],
      'A handler is reading a project root raw. Use confineRoot / ' +
      'confineRootOptional / requireProjectRoot / optionalProjectRoot / ' +
      'requireProjectPath — see the note above them in server.ts.\n' +
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
      // Either it resolves directly, or it delegates to another reader
      // that does — `confineRootOptional` is a thin wrapper over
      // `confineRoot`, and requiring the call here would force the
      // duplication this helper exists to avoid.
      const confines =
        body.includes('resolveTrustedProjectRoot') ||
        READERS.some((other) => other !== name && body.includes(`${other}(`));
      assert.ok(confines, `${name} no longer resolves through the trusted-root check`);
    }
  });

  test('every handler that takes a project path stops when one is refused', () => {
    // Both helpers respond on refusal and return null. A handler that
    // called one and carried on would send a second response and use an
    // unconfined value; this catches the missing early return.
    const lines = fs.readFileSync(SERVER, 'utf-8').split('\n');
    const missing: string[] = [];

    for (const [i, raw] of lines.entries()) {
      const call = raw.match(
        /const (\w+) = (requireProjectRoot|optionalProjectRoot|requireProjectPath|confineRoot|confineRootOptional)\(/,
      );
      if (!call) continue;
      const [, variable, fn] = call;
      // A multi-line call puts the guard after the closing paren.
      let j = i;
      while (j < lines.length && !lines[j].trimEnd().endsWith(';')) j++;
      const next = (lines[j + 1] ?? '').trim();
      const nullable = fn === 'optionalProjectRoot' || fn === 'confineRootOptional';
      const expected = nullable
        ? `if (${variable} === null) return;`
        : `if (!${variable}) return;`;
      if (next !== expected) missing.push(`server.ts:${j + 2} expected \`${expected}\`, found \`${next}\``);
    }

    assert.deepEqual(missing, [], `Refusal is not handled:\n${missing.join('\n')}`);
  });
});
