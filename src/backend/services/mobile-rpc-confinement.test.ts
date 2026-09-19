/**
 * A peer cannot nominate a project root.
 *
 * Phase 19's rule — never take `projectRoot` / `projectPath` from a
 * request — was swept across the REST handlers and enforced by
 * `server-confinement.test.ts`. **The peer RPC surface was missed.**
 * Ten sites in `mobile-rpc-service.ts` read `params.projectPath` off
 * the wire and used it: `project.rescan` walked and parsed the
 * directory, and `plan.file.export`, `sysdoc.create` and
 * `plan.template.create` wrote into it.
 *
 * Pairing is not the control. A device is authenticated by DTLS and
 * checked against the capability matrix, and neither of those answers
 * "is this a project the user opened" — which is why the service audits
 * terminal access at all: a pairing can outlive the user's trust in the
 * device it was made with.
 *
 * This is the structural half, the same shape as the REST guard: it
 * asserts the raw parameter is read nowhere but the confining helper,
 * so an eleventh call site cannot quietly reintroduce it.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVICE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'mobile-rpc-service.ts',
);

/** Strip comments so prose describing the rule is not mistaken for a breach. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/**
 * Names a peer can supply that end up as a filesystem location.
 *
 * Spelling is not a security boundary: `planDir` reads the same directory
 * `projectPath` would.
 */
const PEER_PATH_NAMES = ['projectPath', 'projectRoot', 'planDir', 'dir', 'cwd', 'root'];

/**
 * Methods that legitimately take an unconfined path, each with its reason.
 *
 * This list is the point of widening the guard. Before, these were invisible
 * to it, and an invisible handler and a decided one look identical to whoever
 * reads the file next — which is exactly how `plan.file.import` sat here
 * reading any directory a phone named.
 */
const EXEMPT_METHODS: Record<string, string> = {
  // The peer twin of REST `/api/project/scan`, exempt there for the same
  // reason: this is how a path BECOMES an opened project, so checking it
  // against the opened list makes it impossible to open anything.
  //
  // OPEN QUESTION, deliberately recorded rather than settled here: REST scan's
  // control is the capability token, which is per-launch. This one's control is
  // a pairing, which can outlive the trust that created it — and opening a
  // project makes it a trusted root that every other confined method then
  // accepts. Whether that wants a confirmation step or its own capability
  // outside DEFAULT_GRANTS is a product decision, not a test's to make.
  'project.open': 'scanProject — how a path becomes an opened project',

  // List keys, not paths. Same reasoning as /api/recent-projects: these index
  // or annotate the recent-projects list and never open, walk, or execute in
  // the directory. Confining them breaks removing an entry whose directory has
  // already been deleted.
  'project.close': 'broadcasts a UI event only',
  'project.pin': 'recent-projects list key',
  'project.remove': 'recent-projects list key',
  'project.alias': 'recent-projects list key',

  // A terminal's starting directory. Confinement would be theatre — the
  // session it opens is a shell, so it can cd anywhere the process can reach.
  'terminal.create': 'PTY starting directory',

  // Reads the FILES TABLE, not the disk: `dir` is a database key, so it can
  // only ever return files already indexed from an opened project.
  'graph.directory': 'database key, not a filesystem path',

  // Deliberately browses the desktop's filesystem so a phone can pick a folder
  // to open — the peer equivalent of a file dialog. Confining it to opened
  // projects would mean you could only ever open what is already open.
  'fs.browse': 'browse-to-open, the peer file dialog',

  // Same call, same reasoning as the REST route: importing a plan directory is
  // how a plan travels between machines, so it cannot be restricted to
  // directories already inside a project. It needs a `plan.yaml` and ingests
  // plan-shaped YAML — not a general file read. A phone can already enumerate
  // the filesystem through `fs.browse` and open any directory through
  // `project.open`, so this grants nothing those two do not.
  'plan.file.import': 'plan transit between machines',
};

/** Any access form — dotted, bracketed, destructured, or via requireString. */
function readsPeerPath(line: string): boolean {
  for (const name of PEER_PATH_NAMES) {
    if (new RegExp(String.raw`params\s*(?:\.${name}\b|\[\s*['"\`]${name}['"\`]\s*\])`).test(line)) return true;
    if (new RegExp(String.raw`requireString\(\s*params\s*,\s*['"\`]${name}['"\`]`).test(line)) return true;
  }
  const d = line.match(/\{([^}]*)\}\s*=\s*params\b/);
  if (d) {
    return d[1].split(',').some((e) => PEER_PATH_NAMES.includes(e.split(':')[0].trim()));
  }
  return false;
}

describe('peer RPC project roots', () => {
  const source = fs.readFileSync(SERVICE, 'utf-8');
  const code = stripComments(source);
  const lines = code.split('\n');

  test('the confining helper exists and goes through trusted roots', () => {
    assert.match(
      code,
      /function peerProjectRoot\(/,
      'peerProjectRoot is the single door; without it this test proves nothing',
    );
    // It must delegate rather than reimplement the check. A local
    // path.resolve comparison is what the REST side had to remove:
    // lexical containment does not survive symlinks or junctions.
    assert.match(
      code,
      /resolveTrustedProjectRoot\(/,
      'peerProjectRoot must resolve through trusted-roots, not its own comparison',
    );
  });

  test('a peer-supplied path is read only where it is confined', () => {
    // Widened after the literal `params.projectPath` check was shown to be
    // defeated three ways, each a one-liner: a destructure
    // (`const { projectPath } = params`), a bracket access, and simply
    // choosing another name. `plan.file.import` was already through it under
    // the name `planDir`, reading any directory a paired phone asked for —
    // the eleventh call site the header below promises cannot exist.
    const offenders: string[] = [];

    let currentCase = '';
    lines.forEach((line, i) => {
      const m = line.match(/case\s+['"`]([\w.]+)['"`]\s*:/);
      if (m) currentCase = m[1];
      if (EXEMPT_METHODS[currentCase]) return;
      if (!readsPeerPath(line)) return;

      // Allowed: inside peerProjectRoot, and the one optional filter that
      // calls resolveTrustedProjectRoot on the same line or the next.
      const window = lines.slice(i, i + 3).join('\n');
      const confinedHere =
        /resolveTrustedProjectRoot\(/.test(window)
        || /peerProjectRoot\(/.test(window)
        || /resolveInsideTrustedRoot\(/.test(window);
      const insideHelper = /const nominated = params\.projectPath/.test(line);

      if (!confinedHere && !insideHelper) {
        offenders.push(`L${i + 1}: ${line.trim()}`);
      }
    });

    assert.deepEqual(
      offenders,
      [],
      'These read a peer-supplied project path without confining it. '
      + 'Use peerProjectRoot(params) instead:\n' + offenders.join('\n'),
    );
  });

  test('every method that takes a root uses the helper, not a fallback chain', () => {
    // The old shape was `(params.projectPath as string) || getActiveProjectPath()
    // || recentProjects[0]`. The cast is the tell: it means the value went
    // straight from the wire into use.
    const casts = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => /params\.projectPath as string/.test(l))
      .filter(({ i }) => !/resolveTrustedProjectRoot/.test(lines.slice(i, i + 3).join('\n')))
      .map(({ l, i }) => `L${i + 1}: ${l.trim()}`);

    assert.deepEqual(
      casts,
      [],
      'A raw cast of params.projectPath means the wire value is used directly:\n'
      + casts.join('\n'),
    );
  });
});
