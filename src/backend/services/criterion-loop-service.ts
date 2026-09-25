/**
 * Phase 31 §8 — the loops: checking is something you run, not a moment.
 *
 *  - `checkCriterion`   the agent's loop (§8.1): what would a submission
 *                       say? Run before claiming, as often as it takes.
 *  - `submitChecked`    the same checks, refusing evidence that fails one.
 *                       The only submission path an agent has.
 *  - `getWorklist`      the agent's input after a person has looked (§8.2):
 *                       everything owed, in the order to work it.
 *  - `runCheckRun`      the whole plan, recorded (§8.3), with what moved
 *                       since the last run.
 *
 * Nothing here approves anything. A check can refuse a submission and a
 * run can report a criterion stale or failing; only a person — or a policy
 * a person set — moves a criterion to `met` (criteria-service).
 *
 * Layered over criteria-service rather than inside it: the `code` check
 * needs the plan review, and the review reads criteria.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDb } from './database';
import { markDirty } from './persistence';
import * as criteria from './criteria-service';
import {
  getArtefact,
  listArtefacts,
  projectRootForItem,
  refreshArtefactHashes,
  currentHashes,
} from './artefact-service';
import { runChecks, type CheckContext, type EvidenceFact } from './criterion-checks';
import { getItem, listAllItems } from './plan-item-service';
import { reviewPlan } from './plan-review-service';
import { resolveWithin } from './confined-fs';
import { formatReference } from '../../shared/lib/references';
import { postCriterionNotice } from './sensor-bridge-service';
import type {
  CheckRun,
  CheckRunOutcome,
  CheckRunTrigger,
  CriterionCheck,
  ItemCriterion,
  PlanItem,
  WorklistEntry,
} from '../../shared/types';

type Row = unknown[];
const rows = (sql: string, params: unknown[] = []): Row[] =>
  (getDb().exec(sql, params)[0]?.values ?? []) as Row[];

export interface OfferedEvidence {
  attachmentUid: string;
  locator?: unknown;
}

// ── Facts the checks need ─────────────────────────────────────────────

function rootOf(itemUid: string): string | null {
  try {
    return projectRootForItem(itemUid);
  } catch {
    return null;
  }
}

/** The item's first move to in_progress, else when it was created. */
function itemStartedAt(item: PlanItem): number {
  const started = rows(
    `SELECT MIN(created_at) FROM plan_events
     WHERE item_uid = ? AND event_type = 'status_changed' AND after_state LIKE '%in_progress%'`,
    [item.uid],
  )[0]?.[0];
  if (typeof started === 'number') return started;
  const created = typeof item.createdAt === 'number' ? item.createdAt : Date.parse(String(item.createdAt));
  return Number.isFinite(created) ? created : 0;
}

/** Attachments on the item read through `read_material` since `since`. */
function materialsReadSince(itemUid: string, since: number): Set<string> {
  const read = new Set<string>();
  for (const r of rows(
    `SELECT after_state FROM plan_events WHERE item_uid = ? AND event_type = 'material_read' AND created_at >= ?`,
    [itemUid, since],
  )) {
    try {
      const uid = (JSON.parse(String(r[0])) as { attachmentUid?: unknown }).attachmentUid;
      if (typeof uid === 'string') read.add(uid);
    } catch { /* a malformed row names nothing */ }
  }
  return read;
}

/** The newest mtime among the item's target files that exist. */
function lastTargetChangeAt(item: PlanItem, root: string | null): number | null {
  if (!root) return null;
  let newest: number | null = null;
  for (const spec of item.fileSpecs ?? []) {
    if (!spec?.path) continue;
    const rel = item.scopePath && !path.isAbsolute(spec.path) ? path.join(item.scopePath, spec.path) : spec.path;
    try {
      const st = fs.lstatSync(resolveWithin(root, rel, 'target'));
      if (st.isFile()) newest = Math.max(newest ?? 0, Math.round(st.mtimeMs));
    } catch { /* a target that does not exist yet has no change time */ }
  }
  return newest;
}

/** One review per plan per run: a `code` criterion reads its item's verdict. */
type CodeVerdicts = Map<string, NonNullable<CheckContext['code']>>;

function codeVerdicts(planUid: string): CodeVerdicts | { unavailable: string } {
  const projectPath = rows(`SELECT project_path FROM plans WHERE uid = ?`, [planUid])[0]?.[0];
  if (typeof projectPath !== 'string' || !projectPath) return { unavailable: 'the plan has no project' };
  try {
    const r = reviewPlan({ planUid, projectPath });
    if (!r.ok) return { unavailable: r.error };
    return new Map(r.review.items.map((i) => [i.uid, { verdict: i.verdict, missing: i.missing }]));
  } catch (err) {
    return { unavailable: (err as Error).message };
  }
}

function evidenceFacts(criterion: ItemCriterion, offered?: OfferedEvidence[]): EvidenceFact[] {
  const list = offered
    ? offered.map((e) => ({ attachmentUid: e.attachmentUid, locator: e.locator ?? null }))
    : criterion.latestSubmission.map((e) => ({ attachmentUid: e.attachmentUid, locator: e.locator }));
  return list.map((e) => {
    const artefact = e.attachmentUid ? getArtefact(e.attachmentUid) : null;
    return {
      attachmentUid: e.attachmentUid,
      locator: e.locator,
      // Evidence from another item is a claim about somewhere else.
      artefact: artefact && artefact.itemUid === criterion.itemUid ? artefact : null,
    };
  });
}

function check(
  criterion: ItemCriterion,
  item: PlanItem,
  offered: OfferedEvidence[] | undefined,
  verdicts: () => CodeVerdicts | { unavailable: string },
): CriterionCheck {
  const root = rootOf(item.uid);
  let code: CheckContext['code'];
  if (criterion.kind === 'code') {
    const v = verdicts();
    code = 'unavailable' in v && typeof v.unavailable === 'string'
      ? { unavailable: v.unavailable }
      : (v as CodeVerdicts).get(item.uid) ?? { unavailable: 'the item is not in the plan review' };
  }
  const startedAt = itemStartedAt(item);
  return runChecks({
    criterion: { uid: criterion.uid, itemUid: criterion.itemUid, kind: criterion.kind },
    root,
    itemStartedAt: startedAt,
    lastTargetChangeAt: lastTargetChangeAt(item, root),
    evidence: evidenceFacts(criterion, offered),
    itemArtefacts: listArtefacts(item.uid),
    materialsRead: criterion.kind === 'citation' ? materialsReadSince(item.uid, startedAt) : undefined,
    code,
  });
}

function once<T>(fn: () => T): () => T {
  let done = false;
  let value: T;
  return () => {
    if (!done) { value = fn(); done = true; }
    return value;
  };
}

function requireCriterion(uid: string): { criterion: ItemCriterion; item: PlanItem } {
  const criterion = criteria.getCriterion(uid);
  if (!criterion) throw new criteria.CriterionError('Criterion not found', 404);
  const item = getItem(criterion.itemUid);
  if (!item) throw new criteria.CriterionError('Item not found', 404);
  return { criterion, item };
}

// ── §8.1 The agent's loop ─────────────────────────────────────────────

/**
 * Run a criterion's mechanical checks — on evidence the agent is about to
 * offer, or, without any, on its latest submission and the item's files.
 * Reads only; says what failed in words.
 */
export async function checkCriterion(uid: string, offered?: OfferedEvidence[]): Promise<CriterionCheck> {
  const { criterion: before, item } = requireCriterion(uid);
  await refreshArtefactHashes(before.itemUid).catch(() => []);
  const criterion = criteria.getCriterion(uid)!;
  return check(criterion, item, offered, once(() => codeVerdicts(item.planUid)));
}

/**
 * `submit_criterion`: the same checks, and a refusal that lists every
 * failure. What reaches a person has already passed them (§8.1).
 */
export async function submitChecked(
  uid: string,
  input: { evidence?: OfferedEvidence[]; note?: string | null },
  actor: { author: string; authorType: string },
): Promise<{ criterion: ItemCriterion; check: CriterionCheck }> {
  const result = await checkCriterion(uid, input.evidence ?? []);
  if (!result.ok) {
    const failures = result.findings.filter((f) => f.status === 'fail').map((f) => `- ${f.message}`);
    throw new criteria.CriterionError(
      `Not submitted — fix these and check again (check_criterion), then submit:\n${failures.join('\n')}`,
      422,
    );
  }
  const criterion = criteria.submitCriterion(uid, input, actor);
  // §12 — waiting on a person now, so tell them, wherever they are. An
  // agent-policy criterion was approved by the submission itself.
  if (criterion.state === 'submitted') {
    const item = getItem(criterion.itemUid);
    if (item) {
      postCriterionNotice({
        planUid: item.planUid,
        itemUid: item.uid,
        criterionUid: criterion.uid,
        reason: 'submitted',
        message: `${actor.author} submitted "${criterion.text}" on ${item.title} — approve it or send it back.`,
      });
    }
  }
  return { criterion, check: result };
}

// ── §8.2 The worklist ─────────────────────────────────────────────────

function pathOf(attachmentUid: string | null): string | null {
  return attachmentUid ? getArtefact(attachmentUid)?.path ?? null : null;
}

/** For a stale criterion: the files its approval was taken on that have changed. */
function changedEvidenceFiles(c: ItemCriterion): string[] {
  const recorded = c.latestSignoff?.evidenceHashes ?? {};
  const uids = Object.keys(recorded);
  const now = currentHashes(uids);
  return uids.filter((u) => recorded[u] !== now[u]).map((u) => pathOf(u) ?? u);
}

function refOf(item: PlanItem): string {
  return formatReference(item.kind === 'object' ? 'page' : 'task', item.uid);
}

const REASON_ORDER: Record<WorklistEntry['reason'], number> = { sent_back: 0, stale: 1, failing: 2, open: 3 };

export interface Worklist {
  planUid: string;
  entries: WorklistEntry[];
  /** Submitted and waiting on a person — not the agent's to do. */
  waitingForPerson: number;
  met: number;
  total: number;
}

/**
 * Everything the agent owes on a plan, in the order to work it: sent back
 * (with the person's note, where it points, and a reference), gone stale,
 * failing its checks, not yet started.
 */
export async function getWorklist(planUid: string): Promise<Worklist> {
  const items = listAllItems(planUid);
  const verdicts = once(() => codeVerdicts(planUid));
  const entries: Array<WorklistEntry & { order: number }> = [];
  let waitingForPerson = 0;
  let met = 0;
  let total = 0;

  for (const [itemIndex, item] of items.entries()) {
    await refreshArtefactHashes(item.uid).catch(() => []);
    for (const c of criteria.listCriteria(item.uid)) {
      total++;
      const base = {
        criterionUid: c.uid, itemUid: item.uid, itemTitle: item.title, itemRef: refOf(item),
        text: c.text, kind: c.kind, policy: c.policy,
      };
      const anchors = c.latestSubmission
        .filter((e) => e.attachmentUid || e.locator)
        .map((e) => ({ attachmentUid: e.attachmentUid, path: pathOf(e.attachmentUid), locator: e.locator }));
      const order = itemIndex * 10_000 + c.sortOrder;

      if (c.state === 'met') { met++; continue; }
      if (c.state === 'sent_back') {
        // The place the person sent it back FROM comes first: it is what
        // the note is about.
        const at = c.latestSignoff?.anchor;
        const pointed = at ? [{ attachmentUid: at.attachmentUid, path: pathOf(at.attachmentUid), locator: at.locator }] : [];
        entries.push({
          ...base, reason: 'sent_back', note: c.latestSignoff?.note ?? null,
          anchors: [...pointed, ...anchors], details: [], order,
        });
      } else if (c.state === 'stale') {
        const files = changedEvidenceFiles(c);
        entries.push({
          ...base, reason: 'stale', note: null, anchors,
          details: files.map((f) => `${f} changed after it was approved`), order,
        });
      } else if (c.state === 'submitted') {
        // Waiting on a person — unless the evidence no longer holds, in
        // which case the person would be judging something broken.
        const result = check(c, item, undefined, verdicts);
        if (result.ok) { waitingForPerson++; continue; }
        entries.push({
          ...base, reason: 'failing', note: null, anchors,
          details: result.findings.filter((f) => f.status === 'fail').map((f) => f.message), order,
        });
      } else {
        entries.push({ ...base, reason: 'open', note: null, anchors: [], details: [], order });
      }
    }
  }

  entries.sort((a, b) => REASON_ORDER[a.reason] - REASON_ORDER[b.reason] || a.order - b.order);
  return {
    planUid,
    entries: entries.map(({ order: _order, ...e }) => e),
    waitingForPerson,
    met,
    total,
  };
}

// ── §8.3 The check run ────────────────────────────────────────────────

const when = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

function toRun(r: Row): CheckRun {
  const parse = <T>(v: unknown, fallback: T): T => {
    try { return typeof v === 'string' ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
  };
  return {
    uid: r[0] as string,
    planUid: r[1] as string,
    trigger: r[2] as CheckRunTrigger,
    by: r[3] as string,
    byType: r[4] as string,
    outcomes: parse<CheckRunOutcome[]>(r[5], []),
    sinceLast: parse<string[]>(r[6], []),
    startedAt: r[7] as number,
    finishedAt: r[8] as number,
  };
}

const RUN_COLS = 'uid, plan_uid, trigger, by_actor, by_type, outcomes, since_last, started_at, finished_at';

export function listCheckRuns(planUid: string, limit = 10): CheckRun[] {
  return rows(
    `SELECT ${RUN_COLS} FROM check_runs WHERE plan_uid = ? ORDER BY started_at DESC, rowid DESC LIMIT ?`,
    [planUid, limit],
  ).map(toRun);
}

/** What moved since the previous run, in words (§8.3). */
export function describeSinceLast(outcomes: CheckRunOutcome[], previousRuns: CheckRun[]): string[] {
  const previous = previousRuns[0];
  if (!previous) return ['First check run on this plan.'];
  // Each criterion's latest recorded outcome, across recent runs: a run
  // narrowed to one item (a material changed) must not make every other
  // criterion read as new on the next full run.
  const before = new Map<string, CheckRunOutcome>();
  for (const run of previousRuns) {
    for (const o of run.outcomes) if (!before.has(o.criterionUid)) before.set(o.criterionUid, o);
  }
  const since = `since ${when(previous.startedAt)}`;
  const lines: string[] = [];

  const wentStale = outcomes.filter((o) => o.state === 'stale' && before.get(o.criterionUid) && before.get(o.criterionUid)!.state !== 'stale');
  if (wentStale.length) {
    const files = [...new Set(wentStale.flatMap((o) => o.changedFiles))];
    lines.push(`${wentStale.length} went stale ${since}${files.length ? ` — ${files.join(', ')} changed` : ''}.`);
  }
  const nowFailing = outcomes.filter((o) => !o.ok && before.get(o.criterionUid)?.ok);
  if (nowFailing.length) {
    lines.push(`${nowFailing.length} now fail${nowFailing.length === 1 ? 's' : ''} ${nowFailing.length === 1 ? 'its' : 'their'} checks: ${nowFailing.map((o) => `"${o.text}"`).join(', ')}.`);
  }
  const fixed = outcomes.filter((o) => o.ok && before.get(o.criterionUid) && !before.get(o.criterionUid)!.ok);
  if (fixed.length) lines.push(`${fixed.length} pass${fixed.length === 1 ? 'es' : ''} again.`);
  const newlyMet = outcomes.filter((o) => o.state === 'met' && before.get(o.criterionUid) && before.get(o.criterionUid)!.state !== 'met');
  if (newlyMet.length) lines.push(`${newlyMet.length} met ${since}.`);
  const added = outcomes.filter((o) => !before.has(o.criterionUid));
  if (added.length) lines.push(`${added.length} new since the last run.`);
  if (lines.length === 0) lines.push(`Nothing changed ${since}.`);
  return lines;
}

/**
 * Re-hash every file, re-run every criterion's checks and record it.
 * `itemUids` narrows it to the items a changed material touches. Never
 * approves anything: the recorded states are what the sign-offs already
 * say, with files that moved since read as stale.
 */
export async function runCheckRun(input: {
  planUid: string;
  trigger: CheckRunTrigger;
  by: string;
  byType: string;
  itemUids?: string[];
}): Promise<CheckRun> {
  const startedAt = Date.now();
  const scope = input.itemUids ? new Set(input.itemUids) : null;
  const items = listAllItems(input.planUid).filter((i) => !scope || scope.has(i.uid));
  const verdicts = once(() => codeVerdicts(input.planUid));
  const outcomes: CheckRunOutcome[] = [];

  for (const item of items) {
    await refreshArtefactHashes(item.uid).catch(() => []);
    for (const c of criteria.listCriteria(item.uid)) {
      const result = check(c, item, undefined, verdicts);
      outcomes.push({
        criterionUid: c.uid,
        itemUid: item.uid,
        text: c.text,
        state: c.state,
        ok: result.ok,
        failures: result.findings.filter((f) => f.status === 'fail').map((f) => f.message),
        changedFiles: c.state === 'stale' ? changedEvidenceFiles(c) : [],
      });
    }
  }

  const sinceLast = describeSinceLast(outcomes, listCheckRuns(input.planUid, 20));
  const uid = randomUUID();
  const finishedAt = Math.max(Date.now(), startedAt);
  getDb().run(
    `INSERT INTO check_runs (uid, plan_uid, trigger, by_actor, by_type, scope, outcomes, since_last, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uid, input.planUid, input.trigger, input.by, input.byType,
      scope ? JSON.stringify([...scope]) : null,
      JSON.stringify(outcomes), JSON.stringify(sinceLast), startedAt, finishedAt,
    ],
  );
  markDirty();
  return { uid, planUid: input.planUid, trigger: input.trigger, by: input.by, byType: input.byType, startedAt, finishedAt, outcomes, sinceLast };
}
