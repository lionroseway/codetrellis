/**
 * Signals from footprints (Phase 32 A1.6). Pure: no database, no git — the
 * caller hands in each workstream's changes and what main changed since it
 * branched, and gets back the signals that hold now.
 *
 * Two kinds so far (awareness spec §4.3):
 *
 *  - **collision** — two workstreams change the same file. On the same
 *    symbol it is `high` (they will conflict); on the same file but
 *    different symbols, or in a file we do not parse, `medium` (it will need
 *    reconciling). A file with symbol collisions is not also reported as a
 *    file collision: one precise signal, not two overlapping ones.
 *  - **stale-base** — main has changed files this workstream also changes
 *    since it branched. `low`: worth knowing, nothing is broken yet.
 *
 * Staying quiet (§4.4) starts here: one signal per (kind, subject,
 * workstreams), with an id derived from exactly that, so a signal that keeps
 * firing is the same row updated rather than a new one; and a signal whose
 * cause went away is resolved, not left open.
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import type { AwarenessSignal, ChangedFile, SignalKind, SignalSeverity } from '../../shared/types';

export interface FootprintInput {
  root: string;
  branch: string | null;
  main: boolean;
  files: ChangedFile[];
  /** Files main changed since this workstream's merge base (empty for the main checkout). */
  mainSinceBase: string[];
}

/** A signal as computed, before it has a history. */
export type SignalDraft = Pick<AwarenessSignal, 'id' | 'kind' | 'severity' | 'subject' | 'workstreams' | 'summary'>;

const signalId = (kind: SignalKind, subject: string, workstreams: string[]) =>
  createHash('sha1').update(`${kind}\0${subject}\0${workstreams.join('\0')}`).digest('hex').slice(0, 16);

/** The name a person knows a workstream by: its branch, else its folder. */
export const workstreamLabel = (w: Pick<FootprintInput, 'root' | 'branch'>) => w.branch ?? path.basename(w.root);

function draft(kind: SignalKind, severity: SignalSeverity, subjectKey: string, subject: SignalDraft['subject'], roots: string[], summary: string): SignalDraft {
  const workstreams = [...roots].sort();
  return { id: signalId(kind, subjectKey, workstreams), kind, severity, subject, workstreams, summary };
}

/** Every signal that holds for these footprints, sorted by severity then id. */
export function computeSignals(footprints: readonly FootprintInput[]): SignalDraft[] {
  const out: SignalDraft[] = [];
  const ordered = [...footprints].sort((a, b) => a.root.localeCompare(b.root));

  // ── collision ─────────────────────────────────────────────────────────
  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      const a = ordered[i];
      const b = ordered[j];
      const bFiles = new Map(b.files.map((f) => [f.path, f]));
      for (const fa of a.files) {
        const fb = bFiles.get(fa.path);
        if (!fb) continue;
        const pair = `\`${workstreamLabel(a)}\` and \`${workstreamLabel(b)}\``;
        const bSymbols = new Set((fb.symbols ?? []).map((s) => s.name));
        const shared = [...new Set((fa.symbols ?? []).map((s) => s.name))].filter((n) => bSymbols.has(n)).sort();
        if (shared.length > 0) {
          for (const symbol of shared) {
            out.push(draft('collision', 'high', `${fa.path}#${symbol}`, { file: fa.path, symbol }, [a.root, b.root],
              `${pair} both change ${fa.path} → ${symbol}`));
          }
        } else {
          out.push(draft('collision', 'medium', fa.path, { file: fa.path }, [a.root, b.root],
            `${pair} both change ${fa.path}`));
        }
      }
    }
  }

  // ── stale-base ────────────────────────────────────────────────────────
  for (const w of ordered) {
    if (w.main || w.mainSinceBase.length === 0) continue;
    const touched = new Set(w.files.map((f) => f.path));
    const files = [...new Set(w.mainSinceBase)].filter((p) => touched.has(p)).sort();
    if (files.length === 0) continue;
    const shown = files.length <= 3 ? files.join(', ') : `${files.slice(0, 3).join(', ')} and ${files.length - 3} more`;
    out.push(draft('stale-base', 'low', w.root, { files }, [w.root],
      `main changed ${shown} since \`${workstreamLabel(w)}\` branched, and \`${workstreamLabel(w)}\` changes ${files.length === 1 ? 'it' : 'them'} too`));
  }

  const rank = { high: 0, medium: 1, low: 2 } as const;
  return out.sort((x, y) => rank[x.severity] - rank[y.severity] || x.id.localeCompare(y.id));
}

/**
 * Fold what holds now into what was known. Pure.
 *
 *  - A draft seen before keeps its first-seen time and its state (a person
 *    who acknowledged it or marked it intended is not overruled by it firing
 *    again), with its summary and severity refreshed. One that had resolved
 *    and came back is open again.
 *  - A draft not seen before is open.
 *  - A known signal that no longer holds is resolved.
 *
 * Returns only what changed, so the caller writes and announces nothing
 * when nothing moved.
 */
export function reconcileSignals(previous: readonly AwarenessSignal[], drafts: readonly SignalDraft[], now: number): {
  upserts: AwarenessSignal[];
  resolved: string[];
} {
  const known = new Map(previous.map((s) => [s.id, s]));
  const upserts: AwarenessSignal[] = [];
  for (const d of drafts) {
    const was = known.get(d.id);
    if (!was) {
      upserts.push({ ...d, firstSeen: now, lastSeen: now, state: 'open' });
      continue;
    }
    const state = was.state === 'resolved' ? 'open' : was.state;
    const moved = state !== was.state || was.summary !== d.summary || was.severity !== d.severity
      || JSON.stringify(was.subject) !== JSON.stringify(d.subject);
    if (moved) upserts.push({ ...was, ...d, state, lastSeen: now });
  }
  const live = new Set(drafts.map((d) => d.id));
  const resolved = previous.filter((s) => s.state !== 'resolved' && !live.has(s.id)).map((s) => s.id);
  return { upserts, resolved };
}
