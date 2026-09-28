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
 *  - **contract** (A2.3) — one workstream changes an exported symbol's
 *    signature, or removes it, and files another workstream changes import
 *    that name. `high`: it will break a build. When they only import the
 *    module as a namespace it is `medium`: they possibly use it. A body-only
 *    edit has no signature change, so it raises nothing.
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
  /**
   * This workstream's changes to what other files import, each with the
   * files that import it in the opened project's graph (A2.3). Looked up by
   * the caller, since that needs the database; empty when there are none.
   */
  contracts?: ContractChange[];
  /** Files its agents declared they are about to change, each with the symbols named (A2.4). */
  intended?: Array<{ path: string; symbols: string[] }>;
}

/** An exported symbol whose shape changed, or which went, and who imports it. */
export interface ContractChange {
  /** The changed file, relative, and the symbol as the footprint names it (`Session.renew`). */
  file: string;
  symbol: string;
  change: 'signature' | 'removed';
  signature?: { before: string; after: string };
  /** Relative paths of the files importing it; `possibly` for a namespace import. */
  importers: Array<{ path: string; possibly: boolean }>;
}

/** The name another file imports a symbol by: a member is imported with its type. */
export const importableName = (symbol: string) => symbol.split(/[.#]/)[0];

/**
 * A footprint's contract changes, before importers are looked up: exported
 * symbols whose signature changed, or that were removed. Pure.
 */
export function contractCandidates(files: readonly ChangedFile[]): Array<Omit<ContractChange, 'importers'>> {
  const out: Array<Omit<ContractChange, 'importers'>> = [];
  for (const f of files) {
    for (const s of f.symbols ?? []) {
      if (!s.exported) continue;
      if (s.change === 'modified' && s.signature) out.push({ file: f.path, symbol: s.name, change: 'signature', signature: s.signature });
      else if (s.change === 'removed') out.push({ file: f.status === 'renamed' && f.from ? f.from : f.path, symbol: s.name, change: 'removed' });
    }
  }
  return out;
}

/** A signal as computed, before it has a history. */
export type SignalDraft = Pick<AwarenessSignal, 'id' | 'kind' | 'severity' | 'subject' | 'workstreams' | 'summary'>;

const signalId = (kind: SignalKind, subject: string, workstreams: string[]) =>
  createHash('sha1').update(`${kind}\0${subject}\0${workstreams.join('\0')}`).digest('hex').slice(0, 16);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The name a person knows a workstream by: its branch, else its folder. */
export const workstreamLabel = (w: Pick<FootprintInput, 'root' | 'branch'>) => w.branch ?? path.basename(w.root);

function draft(kind: SignalKind, severity: SignalSeverity, subjectKey: string, subject: SignalDraft['subject'], roots: string[], summary: string): SignalDraft {
  const workstreams = [...roots].sort();
  return { id: signalId(kind, subjectKey, workstreams), kind, severity, subject, workstreams, summary };
}

/** What one workstream touches in a file: what it changed, and what it declared. */
interface Touch {
  /** It changed the file (not only declared it). */
  file: boolean;
  changed: Set<string>;
  declared: Set<string>;
}

function touches(w: FootprintInput): Map<string, Touch> {
  const out = new Map<string, Touch>();
  for (const f of w.files) out.set(f.path, { file: true, changed: new Set((f.symbols ?? []).map((s) => s.name)), declared: new Set() });
  for (const d of w.intended ?? []) {
    const t = out.get(d.path) ?? { file: false, changed: new Set<string>(), declared: new Set<string>() };
    for (const s of d.symbols) t.declared.add(s);
    out.set(d.path, t);
  }
  return out;
}

/** Every signal that holds for these footprints, sorted by severity then id. */
export function computeSignals(footprints: readonly FootprintInput[]): SignalDraft[] {
  const out: SignalDraft[] = [];
  const ordered = [...footprints].sort((a, b) => a.root.localeCompare(b.root));

  // ── collision ─────────────────────────────────────────────────────────
  // What each side changed, and what it declared it is about to change
  // (A2.4). A declared overlap has the same id as the edit it foretells, so
  // when the edit lands the signal is updated, not raised again, and a
  // person's answer to it stands.
  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      const a = ordered[i];
      const b = ordered[j];
      const sa = touches(a);
      const sb = touches(b);
      for (const [file, ta] of sa) {
        const tb = sb.get(file);
        if (!tb) continue;
        const shared = [...new Set([...ta.changed, ...ta.declared])].filter((n) => tb.changed.has(n) || tb.declared.has(n)).sort();
        const onlyDeclared = (t: Touch, symbol?: string) => (symbol ? !t.changed.has(symbol) : !t.file);
        const said = (symbol?: string) => [onlyDeclared(ta, symbol) ? a.root : null, onlyDeclared(tb, symbol) ? b.root : null]
          .filter((r): r is string => r !== null);
        const words = (subject: string, symbol?: string) => {
          const [da, db] = [onlyDeclared(ta, symbol), onlyDeclared(tb, symbol)];
          const [la, lb] = [`\`${workstreamLabel(a)}\``, `\`${workstreamLabel(b)}\``];
          if (!da && !db) return `${la} and ${lb} both change ${subject}`;
          if (da && db) return `${la} and ${lb} both mean to change ${subject} (declared; nothing changed yet)`;
          return da ? `${la} means to change ${subject} (declared), and ${lb} changes it` : `${lb} means to change ${subject} (declared), and ${la} changes it`;
        };
        if (shared.length > 0) {
          for (const symbol of shared) {
            const intended = said(symbol);
            out.push(draft('collision', 'high', `${file}#${symbol}`, { file, symbol, ...(intended.length ? { intended } : {}) }, [a.root, b.root],
              words(`${file} → ${symbol}`, symbol)));
          }
        } else {
          const intended = said();
          out.push(draft('collision', 'medium', file, { file, ...(intended.length ? { intended } : {}) }, [a.root, b.root], words(file)));
        }
      }
    }
  }

  // ── contract ──────────────────────────────────────────────────────────
  for (const a of ordered) {
    for (const c of a.contracts ?? []) {
      for (const b of ordered) {
        if (b === a) continue;
        const theirs = new Set(b.files.filter((f) => f.status !== 'deleted').map((f) => f.path));
        const hits = c.importers.filter((i) => theirs.has(i.path) && i.path !== c.file);
        if (hits.length === 0) continue;
        const possibly = hits.every((i) => i.possibly);
        const importers = hits.map((i) => i.path).sort();
        const what = c.change === 'removed'
          ? `removed ${c.symbol} from ${c.file}`
          : `changed ${c.symbol} in ${c.file}: ${c.signature!.before} → ${c.signature!.after}`;
        const uses = possibly
          ? `may use it in ${plural(importers.length, 'file')} (it imports the module as a whole)`
          : `imports it in ${plural(importers.length, 'file')}`;
        out.push(draft('contract', possibly ? 'medium' : 'high', `${a.root}>${c.file}#${c.symbol}`, {
          file: c.file, symbol: c.symbol, by: a.root, change: c.change,
          ...(c.signature ? { signature: c.signature } : {}),
          importers, ...(possibly ? { possibly: true } : {}),
        }, [a.root, b.root], `\`${workstreamLabel(a)}\` ${what}. \`${workstreamLabel(b)}\` ${uses}`));
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
