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

  test('params.projectPath is read only where it is confined', () => {
    const offenders: string[] = [];

    lines.forEach((line, i) => {
      if (!line.includes('params.projectPath')) return;

      // Allowed: inside peerProjectRoot, and the one optional filter that
      // calls resolveTrustedProjectRoot on the same line or the next.
      const window = lines.slice(i, i + 3).join('\n');
      const confinedHere = /resolveTrustedProjectRoot\(/.test(window);
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
