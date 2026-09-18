/**
 * Every exported component is reachable from the render tree.
 *
 * Phase 29 §4.15. The §2 audit greps `src/frontend/` for endpoint paths
 * to decide what is surfaced — so a component that calls an endpoint
 * marks it "surfaced" whether or not anything renders that component.
 * That blind spot hid ten endpoints: `/api/team-activity`,
 * `/api/contributions`, the four `/api/audio/*` and the four
 * `/api/peers/remote-*`, each called only from a file nothing imports.
 *
 * Worse than a dead file is a dead file that keeps getting worked on.
 * Phase 22 rewrote the agent Timeline into `AgentPanel`, which
 * `PlanPanel` had already replaced — so the rewrite never reached a
 * user and `agent-turns.test.ts` tested logic no interface ran.
 *
 * A grep cannot notice that. A test can: if nothing references a
 * component's exported name, it is not on screen, whatever its endpoint
 * calls imply. New orphans fail here; existing ones are listed below
 * with a reason each, so "we know about it" is written down rather than
 * remembered.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Rendered by `main.tsx` into the DOM, so nothing imports them by name
 * in the way this check looks for.
 */
const ENTRY_POINTS = new Set(['App.tsx', 'main.tsx']);

/**
 * Known orphans, each with why it is still here. An entry is a promise
 * that somebody looked, not a way to silence the test — removing the
 * file or wiring it up should delete its row.
 */
const KNOWN_ORPHANS: Record<string, string> = {
  'components/layout/AgentPanel.tsx':
    'Superseded by PlanPanel in the same ui-store slot. Kept for its Plan tab, '
    + 'the only reader of agent-store currentPlan (the session-JSONL plan heuristic). '
    + 'Phase 29 §4.15 — deleting it is a separate decision about that heuristic.',
  'components/pairing/RemotePeersPanel.tsx':
    'Phase 10 peer workspace view. Not wired: Phase 19 Gate 1.2 changes the pairing '
    + 'and reconnect protocol, so its four /api/peers/remote-* reads are wired after that lands.',
  'components/settings/WebcamQrScanner.tsx':
    'QR pairing scanner. Same reason as RemotePeersPanel — pairing is mid-change.',
  'lib/spec-doc-types.tsx':
    'Metadata for PlanDocType. Plan documents are the model PlanItem replaced '
    + '(see §5); no component reads planDocs. Dead with its model.',
};

/**
 * Strip comments before looking for references.
 *
 * Without this, prose counts as use. `AgentTurns.tsx` explains in its
 * header why `AgentPanel` is superseded — and that mention alone made
 * `AgentPanel` look wired. §2 of the Phase 29 register hit the same
 * thing in its endpoint audit ("a segment mentioned only in a comment
 * counts as a use — including, comically, the comments written by this
 * phase"). A check that passes because somebody described the problem
 * is worse than no check.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/** Exported component/const/function names declared by a file. */
function exportedNames(source: string): string[] {
  const names = new Set<string>();
  for (const m of source.matchAll(/^export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_]+)/gm)) {
    names.add(m[1]);
  }
  for (const m of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }
  return [...names];
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

describe('frontend render tree', () => {
  test('every .tsx file has at least one export something else references', () => {
    const files = walk(FRONTEND);
    // Sanity: if the walk finds almost nothing, the test is passing
    // because it looked at an empty list.
    assert.ok(files.length > 50, `expected a real component tree, walked ${files.length} files`);

    // Referrers: everything EXCEPT test files.
    //
    // This file names its known orphans by path, and a path contains
    // the component's name — so scanning tests made every allowlisted
    // component look referenced *by being allowlisted*, and the guard
    // quietly passed on files it was meant to catch. Tests are excluded
    // for a second reason too: a component only a test mentions is
    // still not on anyone's screen, which is the thing being checked.
    const isTest = (f: string) => /\.test\.tsx?$/.test(f);
    const sources = new Map<string, string>();
    for (const f of files) {
      if (!isTest(f)) sources.set(f, stripComments(fs.readFileSync(f, 'utf-8')));
    }
    // .ts files can import a .tsx, so they count as referrers too.
    for (const f of walkTs(FRONTEND)) {
      if (!isTest(f)) sources.set(f, stripComments(fs.readFileSync(f, 'utf-8')));
    }

    const orphans: string[] = [];

    for (const file of files) {
      const rel = path.relative(FRONTEND, file).split(path.sep).join('/');
      if (ENTRY_POINTS.has(path.basename(file))) continue;
      if (isTest(file)) continue;

      const names = exportedNames(fs.readFileSync(file, 'utf-8'));
      if (names.length === 0) continue;

      const referenced = names.some((name) => {
        const pattern = new RegExp(`\\b${name}\\b`);
        for (const [other, src] of sources) {
          if (other === file) continue;
          if (pattern.test(src)) return true;
        }
        return false;
      });

      if (!referenced) orphans.push(rel);
    }

    const unexpected = orphans.filter((o) => !(o in KNOWN_ORPHANS));
    assert.deepEqual(
      unexpected,
      [],
      'These components are not referenced by anything, so nothing renders them. '
      + 'Wire them up, delete them, or add a row to KNOWN_ORPHANS saying why they stay: '
      + unexpected.join(', '),
    );

    // The allowlist has to stay honest in the other direction too: a
    // row for a file that is now wired up (or gone) is stale, and a
    // stale allowlist is how the next orphan hides.
    const staleRows = Object.keys(KNOWN_ORPHANS).filter((k) => !orphans.includes(k));
    assert.deepEqual(
      staleRows,
      [],
      'KNOWN_ORPHANS lists files that are no longer orphaned. Remove these rows: '
      + staleRows.join(', '),
    );
  });
});

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkTs(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}
