/**
 * Signals from tasks' materials (Phase 32 A6.3, awareness spec §10.3). Pure,
 * beside `computeSignals`: the caller hands in each task's footprint (A6.2)
 * and each material's hash now, and gets back the signals that hold.
 *
 * A material is a file several tasks use, named by its project-relative path.
 * Every rule here needs two tasks: one task and its own file is Phase 31's
 * business (its criteria go stale), not an overlap. Per material, one signal,
 * naming every task concerned, the most serious that holds:
 *
 *  - **contract** — the material changed since tasks cited it, and another
 *    task uses it too. `high` when one of those citations was already signed
 *    off, else `medium`. The parts they cite are named; which part changed
 *    cannot be told without reading the file, and nothing is read back out of
 *    a material.
 *  - **version-split** — the tasks last read different versions of it.
 *    `medium`: their work disagrees about the facts.
 *  - **stale-base** — the material changed after two or more tasks read it,
 *    and none has read it since. `low`: worth knowing, nothing is wrong yet.
 *
 * And per file or per task:
 *
 *  - **collision** — two tasks record the same output file. `medium`.
 *  - **drift** — a task read a material that is not in its brief (another
 *    task's, and not on the plan's pages). `low`: reading is harmless, but
 *    the person may not have meant the tasks to share it.
 *
 * Workstreams are tasks, `task:<uid>`. Their titles go in `subject.labels`,
 * left out of the shape, so renaming a task does not reopen an answer.
 */

import { draft, type SignalDraft } from './awareness-signals';

export interface MaterialTaskInput {
  /** `task:<item uid>`. */
  id: string;
  title: string;
  /** Paths in its brief: its own recorded files and its plan's pages' materials. */
  brief: string[];
  /** Its latest read of each material, with the hash it saw and the task that holds the file. */
  reads: Array<{ path: string; sha256: string | null; owner: string; ownerTitle: string }>;
  /** Files it records as outputs. */
  outputs: string[];
  /** Parts of materials it cites, with the file's hash when cited and whether a person signed that criterion off. */
  cited: Array<{ path: string; part: string; sha256: string | null; signedOff: boolean }>;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const listed = (names: string[], max = 3) =>
  names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} and ${names.length - max} more`;

/** Every material signal that holds, before sorting with the code signals. */
export function computeMaterialSignals(tasks: readonly MaterialTaskInput[], current: Readonly<Record<string, string | null>>): SignalDraft[] {
  const out: SignalDraft[] = [];
  const ordered = [...tasks].sort((a, b) => a.id.localeCompare(b.id));
  const title = new Map<string, string>();
  for (const t of ordered) for (const r of t.reads) title.set(r.owner, r.ownerTitle);
  for (const t of ordered) title.set(t.id, t.title);
  const labelsOf = (ids: Iterable<string>) => Object.fromEntries([...ids].sort().map((id) => [id, title.get(id) ?? id]));
  const named = (ids: string[]) => listed(ids.map((id) => `“${title.get(id) ?? id}”`));
  const withoutLabels = (subject: SignalDraft['subject']) => {
    const { labels: _labels, ...rest } = subject;
    return rest;
  };
  const emit = (kind: SignalDraft['kind'], severity: SignalDraft['severity'], key: string, subject: SignalDraft['subject'], ids: string[], summary: string) =>
    out.push(draft(kind, severity, key, { ...subject, labels: labelsOf(ids) }, ids, summary, withoutLabels(subject)));

  const materials = new Set<string>();
  for (const t of ordered) {
    for (const r of t.reads) materials.add(r.path);
    for (const c of t.cited) materials.add(c.path);
  }

  for (const m of [...materials].sort()) {
    const now = current[m] ?? null;
    const readers = ordered.filter((t) => t.reads.some((r) => r.path === m));
    const lastHash = (t: MaterialTaskInput) => t.reads.find((r) => r.path === m)?.sha256 ?? null;

    // ── contract ──────────────────────────────────────────────────────
    // Cited against a version that is no longer there.
    const changedCites = now === null ? [] : ordered.flatMap((t) =>
      t.cited.filter((c) => c.path === m && c.sha256 !== null && c.sha256 !== now).map((c) => ({ task: t.id, ...c })));
    const citers = [...new Set(changedCites.map((c) => c.task))];
    const involved = [...new Set([...citers, ...readers.map((t) => t.id)])].sort();
    if (citers.length > 0 && involved.length >= 2) {
      const parts = [...new Set(changedCites.map((c) => c.part))].sort();
      const signedOff = [...new Set(changedCites.filter((c) => c.signedOff).map((c) => c.task))].sort();
      const cites = `${citers.length === 1 ? `${named(citers)} cites` : `${plural(citers.length, 'task')} cite`} ${listed(parts)}`;
      const signed = signedOff.length === 0 ? '' : `; ${signedOff.length === citers.length && citers.length > 1 ? 'all were' : signedOff.length === 1 && citers.length === 1 ? 'it was' : `${signedOff.length} ${signedOff.length === 1 ? 'was' : 'were'}`} already signed off`;
      const others = involved.filter((id) => !citers.includes(id));
      const alsoUses = others.length ? `. ${named(others)} ${others.length === 1 ? 'uses' : 'use'} it too` : '';
      emit('contract', signedOff.length ? 'high' : 'medium', `material:${m}`, { material: m, parts, citedBy: citers.sort(), ...(signedOff.length ? { signedOff } : {}) }, involved,
        `\`${m}\` changed. ${cites}${signed}${alsoUses}`);
      continue;
    }

    // ── version-split ─────────────────────────────────────────────────
    const hashes = new Set(readers.map(lastHash).filter((h): h is string => h !== null));
    if (readers.length >= 2 && hashes.size >= 2) {
      const ids = readers.map((t) => t.id);
      const readVersions = Object.fromEntries(readers.map((t) => [t.id, lastHash(t) === now ? 'current' : 'earlier'] as const));
      const onCurrent = readers.filter((t) => lastHash(t) === now).map((t) => t.id);
      const tail = onCurrent.length === 0
        ? `; ${readers.length === 2 ? 'neither' : 'none'} has the current one`
        : `; ${named(onCurrent)} ${onCurrent.length === 1 ? 'has' : 'have'} the current one`;
      emit('version-split', 'medium', `material:${m}`, { material: m, readVersions }, ids,
        `${named(ids)} read different versions of \`${m}\`${tail}`);
      continue;
    }

    // ── stale-base ────────────────────────────────────────────────────
    if (now !== null && readers.length >= 2 && readers.every((t) => lastHash(t) !== null && lastHash(t) !== now)) {
      const ids = readers.map((t) => t.id);
      emit('stale-base', 'low', `material:${m}`, { material: m }, ids,
        `\`${m}\` changed after ${named(ids)} read it, and ${ids.length === 2 ? 'neither' : 'none'} has read it since`);
    }
  }

  // ── collision ───────────────────────────────────────────────────────
  const writers = new Map<string, string[]>();
  for (const t of ordered) for (const o of new Set(t.outputs)) (writers.get(o) ?? writers.set(o, []).get(o)!).push(t.id);
  for (const [file, ids] of [...writers].sort(([a], [b]) => a.localeCompare(b))) {
    if (ids.length < 2) continue;
    emit('collision', 'medium', `output:${file}`, { material: file, file }, ids,
      `${named(ids)} ${ids.length === 2 ? 'both' : 'all'} record \`${file}\` as their output`);
  }

  // ── drift ───────────────────────────────────────────────────────────
  for (const t of ordered) {
    const brief = new Set(t.brief);
    const outside = t.reads.filter((r) => !brief.has(r.path) && r.owner !== t.id);
    if (outside.length === 0) continue;
    const files = [...new Set(outside.map((r) => r.path))].sort();
    const owners = [...new Set(outside.map((r) => r.owner))].filter((o) => o !== t.id).sort();
    const ids = [t.id, ...owners];
    emit('drift', 'low', `material-drift:${t.id}`, { material: files[0], files, by: t.id }, ids,
      `${named([t.id])} read ${listed(files.map((f) => `\`${f}\``))}, which ${files.length === 1 ? 'is' : 'are'} not in its brief (given to ${named(owners)})`);
  }

  return out;
}
