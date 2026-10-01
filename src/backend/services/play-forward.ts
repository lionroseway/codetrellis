/**
 * Phase 32 B9.1 — play-forward: every active plan's planned changes at once,
 * and where they will meet (observability spec §6.3 and §7, JOURNEYS G3).
 *
 * The planned-state projection (`projection-service.ts`) answers for one
 * plan. This answers for every plan the stack shows (not completed or
 * archived), from their unfinished tasks only: a done task's change is the
 * code now, not the future. Each planned change says which plan and task
 * plans it, so two plans planning to change one file is visible before
 * anyone writes a line: "◇ planned overlap: JIRA-142 and JIRA-150 both plan
 * to change src/billing/invoice.ts".
 *
 * It projects the materials tasks say they rely on as well as the code they
 * plan to change: two plans about to work from one spreadsheet overlap too,
 * in words (a material is not on the code graph).
 *
 * How serious, by §7's rules: the same file or material is mild; the same
 * function, or one plan deleting or moving what another plans to change, is
 * serious. An overlap whose tasks already wait on one another (B6.1) is
 * sequenced: they will not meet at once.
 *
 * Computed on read from the plans as they are, so it is never out of date.
 */
import { createHash } from 'node:crypto';
import type { PlanItem, ProjectionData } from '../../shared/types';
import type { ForwardBy, ForwardFile, PlannedOverlap, PlannedOverlapDecision, PlayForward } from '../../shared/types/play-forward';
import { isSettled } from './plan-dependencies';
import { buildStack } from './stack-service';
import { listAllItems } from './plan-item-service';
import { getDb } from './database';
import { resolveWithin } from './confined-fs';
import fs from 'node:fs';
import path from 'node:path';

export interface ForwardPlan { uid: string; label: string; items: PlanItem[] }

type Verb = 'create' | 'modify' | 'delete' | 'move';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "A", "A and B", "A, B and C". */
function list(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const idOf = (kind: string, subject: string, plans: string[]) =>
  createHash('sha256').update(`${kind}\0${subject}\0${[...plans].sort().join('\0')}`).digest('hex').slice(0, 16);

/**
 * Whether the overlap's tasks already wait on one another across every pair
 * of its plans, and in words which waits on which when there are two.
 */
function sequencing(plans: PlannedOverlap['plans'], itemOf: (uid: string) => PlanItem | undefined): { sequenced: boolean; words: string | null } {
  const waits = (a: PlannedOverlap['plans'][number], b: PlannedOverlap['plans'][number]) =>
    a.tasks.some((t) => (itemOf(t.uid)?.dependencies ?? []).some((d) => b.tasks.some((o) => o.uid === d)));
  let all = true;
  let words: string | null = null;
  for (let i = 0; i < plans.length; i++) {
    for (let j = i + 1; j < plans.length; j++) {
      const ab = waits(plans[i], plans[j]);
      const ba = waits(plans[j], plans[i]);
      if (!ab && !ba) all = false;
      else if (plans.length === 2) words = ab ? `${plans[i].label} waits on ${plans[j].label}` : `${plans[j].label} waits on ${plans[i].label}`;
    }
  }
  return { sequenced: all, words: all ? (words ?? 'each waits on another') : null };
}

/**
 * Every plan's planned changes and where they meet. Pure: the caller passes
 * the plans with their items, the files that exist now, and each item's
 * declared materials.
 */
export function playForwardOf(
  project: string,
  plans: readonly ForwardPlan[],
  existingFiles: ReadonlySet<string>,
  materialsOf: (itemUids: readonly string[]) => Map<string, string[]>,
): PlayForward {
  const items = new Map<string, PlanItem>();
  for (const p of plans) for (const i of p.items) items.set(i.uid, i);
  const itemOf = (uid: string) => items.get(uid);

  const files = new Map<string, ForwardFile>();
  const touch = (path: string, by: ForwardBy, change: Verb) => {
    const f = files.get(path) ?? { path, change: 'modify' as ForwardFile['change'], by: [] };
    if (!f.by.some((b) => b.taskUid === by.taskUid && b.change === change)) f.by.push({ ...by, change });
    files.set(path, f);
  };
  const newEdges = new Map<string, ProjectionData['newEdges'][number]>();
  const removedEdges = new Map<string, ProjectionData['removedEdges'][number]>();
  /** symbol key → plan uid → tasks naming it */
  const symbols = new Map<string, { name: string; file: string | null; by: Map<string, ForwardBy[]> }>();
  const summary: PlayForward['plans'] = [];

  for (const plan of plans) {
    const ahead = plan.items.filter((i) => i.kind === 'action' && !isSettled(i));
    summary.push({ uid: plan.uid, label: plan.label, ahead: ahead.length });
    for (const item of ahead) {
      const by: ForwardBy = { planUid: plan.uid, planLabel: plan.label, taskUid: item.uid, taskTitle: item.title };
      for (const spec of item.fileSpecs ?? []) {
        if (spec.isDir || !spec.path) continue;
        if (spec.action === 'move') {
          touch(spec.path, by, 'move');
          if (spec.moveTo) touch(spec.moveTo, by, 'create');
        } else {
          touch(spec.path, by, spec.action ?? 'modify');
        }
      }
      for (const s of item.symbolSpecs ?? []) {
        if (!s.name) continue;
        const key = s.filePath ? `${s.filePath}#${s.name}` : s.name;
        const entry = symbols.get(key) ?? { name: s.name, file: s.filePath ?? null, by: new Map() };
        entry.by.set(plan.uid, [...(entry.by.get(plan.uid) ?? []), by]);
        symbols.set(key, entry);
        if (s.filePath) touch(s.filePath, by, 'modify');
      }
      for (const c of item.newConnections ?? []) newEdges.set(`${c.from}\0${c.to}`, { from: c.from, to: c.to, taskUid: item.uid });
      for (const c of item.removedConnections ?? []) removedEdges.set(`${c.from}\0${c.to}`, { from: c.from, to: c.to, taskUid: item.uid });
    }
  }

  // What each file will be: removed when any plan deletes or moves it away,
  // new when it is created (or "changed" but not there yet), else changed.
  const projection: ProjectionData = { ghostFiles: [], modifiedFiles: [], removedFiles: [], newEdges: [...newEdges.values()], removedEdges: [...removedEdges.values()] };
  for (const f of files.values()) {
    const first = f.by[0];
    if (f.by.some((b) => b.change === 'delete' || b.change === 'move')) {
      f.change = 'delete';
      projection.removedFiles.push({ path: f.path, taskUid: first.taskUid });
    } else if (f.by.some((b) => b.change === 'create') || !existingFiles.has(f.path)) {
      f.change = 'create';
      projection.ghostFiles.push({ path: f.path, taskUid: first.taskUid, taskDescription: first.taskTitle });
    } else {
      projection.modifiedFiles.push({ path: f.path, taskUid: first.taskUid });
    }
  }

  const overlaps: PlannedOverlap[] = [];
  const plansOf = (by: Array<ForwardBy & { change?: string | null }>): PlannedOverlap['plans'] => {
    const out = new Map<string, PlannedOverlap['plans'][number]>();
    for (const b of by) {
      const p = out.get(b.planUid) ?? { uid: b.planUid, label: b.planLabel, tasks: [] };
      if (!p.tasks.some((t) => t.uid === b.taskUid)) p.tasks.push({ uid: b.taskUid, title: b.taskTitle, change: b.change ?? null });
      out.set(b.planUid, p);
    }
    return [...out.values()];
  };
  const finish = (o: Omit<PlannedOverlap, 'id' | 'sequenced' | 'words' | 'decisions' | 'left'>, words: string): PlannedOverlap => {
    const seq = sequencing(o.plans, itemOf);
    return {
      ...o,
      id: idOf(o.kind, o.subject, o.plans.map((p) => p.uid)),
      decisions: [],
      left: false,
      sequenced: seq.sequenced,
      words: `◇ planned overlap: ${words}${seq.words ? ` · sequenced: ${seq.words}` : ''}`,
    };
  };
  const both = (n: number) => (n === 2 ? 'both' : 'all');

  // A function two plans name is the serious form of the file it lives in.
  const symbolFiles = new Set<string>();
  for (const [key, s] of symbols) {
    if (s.by.size < 2) continue;
    const plansHere = plansOf([...s.by.values()].flat());
    const where = s.file ? ` in ${s.file}` : '';
    if (s.file) symbolFiles.add(`${s.file}\0${plansHere.map((p) => p.uid).sort().join('\0')}`);
    overlaps.push(finish(
      { kind: 'symbol', subject: key, file: s.file, plans: plansHere, serious: true },
      `${list(plansHere.map((p) => p.label))} ${both(plansHere.length)} plan to change ${s.name}${where}`,
    ));
  }
  for (const f of files.values()) {
    const plansHere = plansOf(f.by);
    if (plansHere.length < 2) continue;
    if (symbolFiles.has(`${f.path}\0${plansHere.map((p) => p.uid).sort().join('\0')}`)) continue;
    const removers = plansHere.filter((p) => p.tasks.some((t) => t.change === 'delete' || t.change === 'move'));
    const others = plansHere.filter((p) => !removers.includes(p));
    let words: string;
    let serious = false;
    if (removers.length && others.length) {
      serious = true;
      const verb = removers[0].tasks.some((t) => t.change === 'delete') ? 'delete' : 'move';
      words = `${list(removers.map((p) => p.label))} ${removers.length === 1 ? 'plans' : 'plan'} to ${verb} ${f.path}, which ${list(others.map((p) => p.label))} ${others.length === 1 ? 'plans' : 'plan'} to change`;
    } else {
      words = `${list(plansHere.map((p) => p.label))} ${both(plansHere.length)} plan to ${f.change === 'create' ? 'create' : 'change'} ${f.path}`;
    }
    overlaps.push(finish({ kind: 'file', subject: f.path, file: f.path, plans: plansHere, serious }, words));
  }

  // Materials the plans' briefs list: their unfinished tasks', and their pages'.
  const briefItems = plans.flatMap((p) =>
    p.items.some((i) => i.kind === 'action' && !isSettled(i))
      ? p.items.filter((i) => i.kind === 'object' || (i.kind === 'action' && !isSettled(i))).map((i) => i.uid)
      : []);
  const declared = materialsOf(briefItems);
  const material = new Map<string, Array<ForwardBy & { change: null }>>();
  const planOfItem = new Map<string, ForwardPlan>();
  for (const p of plans) for (const i of p.items) planOfItem.set(i.uid, p);
  const inBrief = new Set(briefItems);
  for (const [itemUid, paths] of declared) {
    if (!inBrief.has(itemUid)) continue;
    const plan = planOfItem.get(itemUid);
    const item = itemOf(itemUid);
    if (!plan || !item) continue;
    for (const path of paths) {
      material.set(path, [...(material.get(path) ?? []), { planUid: plan.uid, planLabel: plan.label, taskUid: item.uid, taskTitle: item.title, change: null }]);
    }
  }
  for (const [path, by] of material) {
    const plansHere = plansOf(by);
    if (plansHere.length < 2) continue;
    overlaps.push(finish(
      { kind: 'material', subject: path, file: null, plans: plansHere, serious: false },
      `${list(plansHere.map((p) => p.label))} ${both(plansHere.length)} rely on ${path}`,
    ));
  }
  // Serious first, then open before sequenced, then by subject.
  overlaps.sort((a, b) => Number(b.serious) - Number(a.serious) || Number(a.sequenced) - Number(b.sequenced) || a.subject.localeCompare(b.subject));

  const fileList = [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
  const n = (c: ForwardFile['change']) => fileList.filter((f) => f.change === c).length;
  const open = overlaps.filter((o) => !o.sequenced).length;
  const parts = [
    n('modify') ? `${plural(n('modify'), 'file')} to change` : null,
    n('create') ? `${n('create')} to create` : null,
    n('delete') ? `${n('delete')} to remove` : null,
  ].filter(Boolean);
  const words = plans.length === 0
    ? 'No active plans: nothing is planned.'
    : fileList.length === 0 && overlaps.length === 0
      ? `Planned by ${plural(plans.length, 'active plan')} · none of their tasks name a file or a material yet`
      : [
        `Planned by ${plural(plans.length, 'active plan')}`,
        parts.length ? parts.join(', ') : null,
        overlaps.length ? `${plural(overlaps.length, 'planned overlap')}${open < overlaps.length ? ` (${overlaps.length - open} sequenced)` : ''}` : 'no planned overlaps',
      ].filter(Boolean).join(' · ');

  return { project, plans: summary, files: fileList, projection, overlaps, words };
}

/** What people did about each planned overlap in the project (B9.3a), oldest first. */
export function decisionsFor(projectRoot: string): Map<string, PlannedOverlapDecision[]> {
  const out = new Map<string, PlannedOverlapDecision[]>();
  for (const r of getDb().exec(
    'SELECT overlap_id, action, words, by_name, by_type, at FROM planned_overlap_decisions WHERE project_root = ? ORDER BY at, id',
    [projectRoot],
  )[0]?.values ?? []) {
    const id = String(r[0]);
    out.set(id, [...(out.get(id) ?? []), { action: r[1] as PlannedOverlapDecision['action'], words: String(r[2]), by: String(r[3]), byType: String(r[4]), at: Number(r[5]) }]);
  }
  return out;
}

/** Each item's declared materials (`attachments` with role `material`), project-relative. */
function materialsFromDb(itemUids: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!itemUids.length) return out;
  const res = getDb().exec(
    `SELECT target_uid, value FROM attachments WHERE role = 'material' AND target_uid IN (${itemUids.map(() => '?').join(',')})`,
    [...itemUids],
  );
  for (const [uid, value] of res[0]?.values ?? []) out.set(String(uid), [...new Set([...(out.get(String(uid)) ?? []), String(value)])]);
  return out;
}

/**
 * Which of these planned paths exist now, read from the project's folder:
 * the server's graph is the last project scanned, which may be another
 * (HD1). Each is confined to the project; one that is not is not there.
 */
function existingOf(projectPath: string, paths: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const rel of paths) {
    try {
      if (fs.lstatSync(resolveWithin(projectPath, path.join(projectPath, rel), 'planned file')).isFile()) out.add(rel);
    } catch { /* not there, or not inside the project */ }
  }
  return out;
}

/** Every active plan in `projectPath` played forward: the plans the stack shows, by its labels. */
export function buildPlayForward(projectPath: string): PlayForward {
  const stack = buildStack(projectPath);
  const plans: ForwardPlan[] = stack.plans.map((p) => ({ uid: p.uid, label: p.label, items: listAllItems(p.uid) }));
  const planned = plans.flatMap((p) => p.items.flatMap((i) => [
    ...(i.fileSpecs ?? []).flatMap((f) => [f.path, f.moveTo]),
    ...(i.symbolSpecs ?? []).map((s) => s.filePath),
  ])).filter((x): x is string => !!x);
  const forward = playForwardOf(projectPath, plans, existingOf(projectPath, new Set(planned)), materialsFromDb);
  const decided = decisionsFor(projectPath);
  for (const o of forward.overlaps) {
    o.decisions = decided.get(o.id) ?? [];
    o.left = o.decisions[o.decisions.length - 1]?.action === 'leave';
  }
  return forward;
}
