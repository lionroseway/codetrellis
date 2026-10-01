/**
 * Phase 32 C4.1 — recurring playbooks (shared-work doc C-4).
 *
 * A rule on a playbook lives in the committed `.codetrellis/config.json`.
 * Each run is a fresh plan from the playbook whose uid is derived from the
 * series, the rule and the period, so starting it twice, here or on two
 * machines, is one plan. Only the current period can be started: a period
 * that ended with no run is shown missed, never back-filled.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import type { RecurrenceInfo, RecurrenceRule, RecurringRun, RecurringSeries } from '../../shared/types/recurring';
import type { Plan, PlanItem } from '../../shared/types';
import {
  currentPeriod, dueAt, momentWords, nextPeriod, periodId, periodLabel, previousPeriod, seriesWords, sinceWords, type Period,
} from '../../shared/lib/recurrence';
import { getProjectConfig, updateProjectConfig } from './project-config-service';
import { parseRecurrenceRule } from './recurrence-rule';
import { getTemplate } from './plan-templates';
import { applyTemplate } from './plan-templates-service';
import { getPlan } from './plan-service';
import * as planItemService from './plan-item-service';
import { getNormalisedOriginUrl } from './git-identity';
import { normaliseRemote } from './plans-home';
import { getDb } from './database';
import { markDirty } from './persistence';

/** How many past periods a series shows. */
const SHOWN = 8;
/** How far back a run looks for the one before it. */
const LOOK_BACK = 52;

export class RecurringError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export function rulesOf(projectRoot: string): RecurrenceRule[] {
  return getProjectConfig(projectRoot).recurring ?? [];
}

function ruleOf(projectRoot: string, id: string): RecurrenceRule {
  const rule = rulesOf(projectRoot).find((r) => r.id === id);
  if (!rule) throw new RecurringError(`No recurring playbook "${id}" in this project`, 404);
  return rule;
}

/**
 * Set a rule: the person's (the caller checks). The playbook must exist here.
 * Editing a rule keeps when it was first set, so its history stays counted.
 */
export function setRule(projectRoot: string, raw: Record<string, unknown>, by: string, now = Date.now()): RecurrenceRule {
  const existing = rulesOf(projectRoot).find((r) => r.id === raw.id);
  const { rule, problems } = parseRecurrenceRule({ ...raw, since: existing?.since ?? new Date(now).toISOString(), by });
  if (!rule) throw new RecurringError(problems.join('; '), 400);
  if (!getTemplate(rule.playbook, projectRoot)) throw new RecurringError(`No playbook "${rule.playbook}" in this project`, 400);
  updateProjectConfig(projectRoot, { recurring: [...rulesOf(projectRoot).filter((r) => r.id !== rule.id), rule] });
  return rule;
}

export function removeRule(projectRoot: string, id: string): void {
  ruleOf(projectRoot, id);
  updateProjectConfig(projectRoot, { recurring: rulesOf(projectRoot).filter((r) => r.id !== id) });
}

/**
 * What names this series on every machine: the plans folder the committed
 * config names, else the repository's origin, else the folder's name. Never
 * this device's path, which differs between machines.
 */
function seriesKey(projectRoot: string): string {
  const folder = getProjectConfig(projectRoot).plans?.folder;
  if (folder?.kind === 'git') return `git:${normaliseRemote(folder.remote)}`;
  if (folder?.kind === 'synced') return `synced:${folder.provider}:${folder.place}`;
  const origin = getNormalisedOriginUrl(projectRoot);
  return origin ? `origin:${origin}` : `folder:${path.basename(path.resolve(projectRoot))}`;
}

/** A run's uid, from the series, the rule and the period: UUID-shaped, the same on every machine. */
export function runUid(projectRoot: string, ruleId: string, period: string): string {
  const h = crypto.createHash('sha256').update(`codetrellis-recurring\0${seriesKey(projectRoot)}\0${ruleId}\0${period}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const SETTLED = new Set(['done', 'skipped']);

function runState(plan: Plan): 'done' | 'in_progress' {
  return plan.status === 'completed' || plan.status === 'archived' ? 'done' : 'in_progress';
}

function runWords(label: string, state: RecurringRun['state'], rule: RecurrenceRule, due: number): string {
  switch (state) {
    case 'done': return `${label} ✓ done`;
    case 'in_progress': return `${label} ◐ in progress`;
    case 'missed': return `${label} ✗ missed`;
    case 'due': return `${label} due ${sinceWords(rule, due)}`;
    case 'next': return `${label} next, ${momentWords(rule.timeZone, due)}`;
  }
}

/** One series: the counted periods up to now, oldest first, then the next one. */
export function seriesOf(projectRoot: string, rule: RecurrenceRule, now = Date.now()): RecurringSeries {
  const since = Date.parse(rule.since);
  const current = currentPeriod(rule, now);
  const past: Period[] = [];
  for (let p = current, i = 0; i < SHOWN && dueAt(rule, p) >= since; p = previousPeriod(p), i++) past.unshift(p);
  const runs: RecurringRun[] = past.map((p) => {
    const period = periodId(p);
    const at = dueAt(rule, p);
    const plan = getPlan(runUid(projectRoot, rule.id, period));
    const state: RecurringRun['state'] = plan ? runState(plan) : p === current ? 'due' : 'missed';
    const label = periodLabel(p);
    return { period, label, dueAt: at, state, planUid: plan?.uid ?? null, words: runWords(label, state, rule, at) };
  });
  const next = nextPeriod(current);
  const nextAt = dueAt(rule, next);
  runs.push({ period: periodId(next), label: periodLabel(next), dueAt: nextAt, state: 'next', planUid: null, words: runWords(periodLabel(next), 'next', rule, nextAt) });
  const open = runs.find((r) => r.state === 'due');
  return {
    rule,
    words: seriesWords(rule),
    runs,
    due: open
      ? { period: open.period, label: open.label, since: open.dueAt, words: `${rule.title} is due ${sinceWords(rule, open.dueAt)}`, dismissed: isDismissed(projectRoot, rule.id, open.period) }
      : null,
  };
}

export function seriesFor(projectRoot: string, now = Date.now()): RecurringSeries[] {
  return rulesOf(projectRoot).map((r) => seriesOf(projectRoot, r, now));
}

/** What a run knows about its series, as started here. */
export function runInfo(planUid: string): RecurrenceInfo | null {
  const row = getDb().exec('SELECT rule_id, period, label, previous_uid, carried_json, started_by, started_at FROM recurring_runs WHERE plan_uid = ?', [planUid])[0]?.values[0];
  if (!row) return null;
  let carried: RecurrenceInfo['carried'] = [];
  try { carried = JSON.parse(String(row[4])) as RecurrenceInfo['carried']; } catch { /* kept empty */ }
  return {
    rule: String(row[0]), period: String(row[1]), label: String(row[2]), previous: row[3] === null ? null : String(row[3]), carried,
    startedBy: String(row[5]), startedAt: Number(row[6]),
  };
}

function isDismissed(projectRoot: string, ruleId: string, period: string): boolean {
  return (getDb().exec('SELECT 1 FROM recurring_dismissed WHERE project_root = ? AND rule_id = ? AND period = ?', [projectRoot, ruleId, period])[0]?.values.length ?? 0) > 0;
}

/**
 * "Not this time" (C4.2a): the person leaves the due run unstarted. It is not
 * asked about again on this device, and reads missed once its period ends.
 */
export function dismissDue(projectRoot: string, ruleId: string, by: string, now = Date.now()): { period: string; label: string } {
  const s = seriesOf(projectRoot, ruleOf(projectRoot, ruleId), now);
  if (!s.due) throw new RecurringError(`${s.rule.title} has no run due now`, 409);
  getDb().run('INSERT OR REPLACE INTO recurring_dismissed (project_root, rule_id, period, by_name, at) VALUES (?, ?, ?, ?, ?)', [projectRoot, ruleId, s.due.period, by, now]);
  markDirty();
  return { period: s.due.period, label: s.due.label };
}

export interface StartedRun { plan: Plan; created: boolean; info: RecurrenceInfo }

/**
 * Start the current period's run. Idempotent: a run that exists (started
 * here, or arrived from a teammate) is returned, never made twice. A period
 * not yet due, or one that has passed, cannot be started.
 */
export function startRun(projectRoot: string, ruleId: string, by: { author: string; authorType: string }, now = Date.now()): StartedRun {
  const rule = ruleOf(projectRoot, ruleId);
  const p = currentPeriod(rule, now);
  if (dueAt(rule, p) < Date.parse(rule.since)) {
    throw new RecurringError(`${rule.title} is not due yet: the first run is ${momentWords(rule.timeZone, dueAt(rule, nextPeriod(p)))}`, 409);
  }
  const period = periodId(p);
  const label = periodLabel(p);
  const uid = runUid(projectRoot, rule.id, period);
  const existing = getPlan(uid);
  if (existing) {
    return { plan: existing, created: false, info: runInfo(uid) ?? { rule: rule.id, period, label, previous: null, carried: [] } };
  }

  // The run before it: the latest earlier period that has one.
  let previous: { uid: string; label: string } | null = null;
  for (let q = previousPeriod(p), i = 0; i < LOOK_BACK; q = previousPeriod(q), i++) {
    const u = runUid(projectRoot, rule.id, periodId(q));
    if (getPlan(u)) { previous = { uid: u, label: periodLabel(q) }; break; }
  }

  const applied = applyTemplate({
    templateId: rule.playbook,
    projectPath: projectRoot,
    title: `${rule.title} — ${label}`,
    author: by.author,
    authorType: by.authorType,
    uid,
  });

  // The rule's skills on each of the run's tasks, beside what the playbook names.
  const actions = (): PlanItem[] => planItemService.listAllItems(uid).filter((i) => i.kind === 'action');
  if (rule.skills.length > 0) {
    for (const item of actions()) {
      const have = new Set((item.skills ?? []).map((s) => s.name));
      const add = rule.skills.filter((s) => !have.has(s.name));
      if (add.length > 0) planItemService.updateItem(item.uid, { skills: [...(item.skills ?? []), ...add], author: by.author, authorType: by.authorType });
    }
  }

  // The previous run's open tasks, when the rule says so; one the playbook brings again is not carried twice.
  const carried: RecurrenceInfo['carried'] = [];
  if (rule.carryOver && previous) {
    const titles = new Set(actions().map((i) => i.title.trim().toLowerCase()));
    for (const item of planItemService.listAllItems(previous.uid)) {
      if (item.kind !== 'action' || SETTLED.has(item.status ?? '') || titles.has(item.title.trim().toLowerCase())) continue;
      const copy = planItemService.createItem({
        planUid: uid,
        kind: 'action',
        title: item.title,
        body: item.body,
        fileSpecs: item.fileSpecs,
        skills: item.skills,
        author: by.author,
        authorType: by.authorType,
      });
      carried.push({ itemUid: copy.uid, from: previous.label });
    }
  }

  getDb().run(
    'INSERT OR REPLACE INTO recurring_runs (plan_uid, project_root, rule_id, period, label, previous_uid, carried_json, started_at, started_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [uid, projectRoot, rule.id, period, label, previous?.uid ?? null, JSON.stringify(carried), now, by.author],
  );
  markDirty();
  return { plan: getPlan(uid) ?? applied.plan, created: true, info: { rule: rule.id, period, label, previous: previous?.uid ?? null, carried, startedBy: by.author, startedAt: now } };
}
