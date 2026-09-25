/**
 * Phase 31 §4.1–4.3 — acceptance criteria, evidence and sign-off.
 *
 * A criterion is a row with verbatim text, a kind (what evidence
 * satisfies it) and a policy (who may mark it met). Its state is DERIVED
 * from the latest submission and the latest decision — never stored, so
 * nothing can set it directly and it cannot drift from its history.
 *
 * Decisions are append-only (`criterion_signoffs`). A person's decision
 * takes a `HumanDecision`, which no MCP code can construct (see
 * human-decision.ts). An agent's submission on an `agent`-policy
 * criterion records an approval in the agent's own name, over the `mcp`
 * channel — it is never stamped as a person's.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from './database';
import { markDirty } from './persistence';
import { isHumanDecision, type HumanDecision } from './human-decision';
import { currentHashes } from './artefact-service';
import type {
  CriterionEvidence,
  CriterionKind,
  CriterionPolicy,
  CriterionSignoff,
  CriterionState,
  ItemCriterion,
  SignoffDecision,
} from '../../shared/types';

export const CRITERION_KINDS: readonly CriterionKind[] = ['manual', 'artefact', 'citation', 'code', 'test'];
export const CRITERION_POLICIES: readonly CriterionPolicy[] = ['agent', 'propose', 'human'];

/** The criterion a `requiresApproval` gate stands for (§4.1). */
export const GATE_CRITERION_TEXT = 'Reviewed and approved';

const STRICTNESS: Record<CriterionPolicy, number> = { agent: 0, propose: 1, human: 2 };

export class CriterionError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** Strictly increasing, so a submission and the decision after it never tie. */
let lastTick = 0;
function tick(): number {
  lastTick = Math.max(Date.now(), lastTick + 1);
  return lastTick;
}

// ── Policy rules ──────────────────────────────────────────────────────

/** What a person gets when they add a criterion without choosing. */
export function defaultPolicy(kind: CriterionKind): CriterionPolicy {
  if (kind === 'manual') return 'human';
  if (kind === 'code') return 'agent';
  return 'propose';
}

/**
 * A `manual` criterion is a judgement: nothing mechanical can satisfy it,
 * so only a person can. Every write path goes through this.
 */
function normalisePolicy(kind: CriterionKind, policy: CriterionPolicy): CriterionPolicy {
  return kind === 'manual' ? 'human' : policy;
}

function isKind(v: unknown): v is CriterionKind {
  return typeof v === 'string' && (CRITERION_KINDS as readonly string[]).includes(v);
}
function isPolicy(v: unknown): v is CriterionPolicy {
  return typeof v === 'string' && (CRITERION_POLICIES as readonly string[]).includes(v);
}

// ── Reading ───────────────────────────────────────────────────────────

const CRITERION_COLS =
  'uid, item_uid, sort_order, text, kind, policy, source, author, author_type, created_at, updated_at, text_updated_at';

type Row = unknown[];

function rows(sql: string, params: unknown[] = []): Row[] {
  return (getDb().exec(sql, params)[0]?.values ?? []) as Row[];
}

function toEvidence(r: Row): CriterionEvidence {
  let locator: unknown = null;
  if (typeof r[4] === 'string') {
    try { locator = JSON.parse(r[4]); } catch { locator = r[4]; }
  }
  return {
    uid: r[0] as string,
    submissionUid: r[2] as string,
    attachmentUid: (r[3] as string | null) ?? null,
    locator,
    note: (r[5] as string | null) ?? null,
    sha256AtSubmit: (r[6] as string | null) ?? null,
    submittedBy: r[7] as string,
    submittedByType: r[8] as string,
    submittedAt: r[9] as number,
  };
}

function toSignoff(r: Row): CriterionSignoff {
  let evidenceHashes: Record<string, string | null> = {};
  if (typeof r[8] === 'string') {
    try { evidenceHashes = JSON.parse(r[8]) ?? {}; } catch { evidenceHashes = {}; }
  }
  return {
    uid: r[0] as string,
    criterionUid: r[1] as string,
    decision: r[2] as SignoffDecision,
    actor: r[3] as string,
    actorType: r[4] as string,
    channel: r[5] as CriterionSignoff['channel'],
    note: (r[6] as string | null) ?? null,
    createdAt: r[7] as number,
    evidenceHashes,
    anchor: typeof r[9] === 'string'
      ? { attachmentUid: r[9] as string, locator: parseJson(r[10]) }
      : null,
  };
}

function parseJson(v: unknown): unknown {
  if (typeof v !== 'string') return null;
  try { return JSON.parse(v); } catch { return null; }
}

function latestSubmissionOf(criterionUid: string): CriterionEvidence[] {
  const last = rows(
    `SELECT submission_uid FROM criterion_evidence WHERE criterion_uid = ?
     ORDER BY submitted_at DESC LIMIT 1`,
    [criterionUid],
  )[0];
  if (!last) return [];
  return rows(
    `SELECT uid, criterion_uid, submission_uid, attachment_uid, locator, note, sha256_at_submit,
            submitted_by, submitted_by_type, submitted_at
     FROM criterion_evidence WHERE submission_uid = ? ORDER BY rowid`,
    [last[0]],
  ).map(toEvidence);
}

function latestSignoffOf(criterionUid: string): CriterionSignoff | null {
  const r = rows(
    `SELECT uid, criterion_uid, decision, actor, actor_type, channel, note, created_at, evidence_hashes,
            anchor_attachment_uid, anchor_locator
     FROM criterion_signoffs WHERE criterion_uid = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    [criterionUid],
  )[0];
  return r ? toSignoff(r) : null;
}

/**
 * The whole rule for state, in one place.
 *
 * `since` is when the wording last changed: a submission or decision made
 * against different words is not one about these, so it no longer counts.
 */
export function deriveState(
  submission: CriterionEvidence[],
  signoff: CriterionSignoff | null,
  since: number | null = null,
  /**
   * Phase 31 §4.3 — a file the approval was taken on has changed (or
   * gone) since. The approval was of something else, so it is `stale`:
   * never silently still `met`.
   */
  evidenceChanged = false,
): CriterionState {
  if (since !== null) {
    if (signoff && signoff.createdAt < since) signoff = null;
    if (submission[0] && submission[0].submittedAt < since) submission = [];
  }
  const submittedAt = submission[0]?.submittedAt ?? null;
  if (signoff && (submittedAt === null || signoff.createdAt >= submittedAt)) {
    if (signoff.decision === 'approved') return evidenceChanged ? 'stale' : 'met';
    return 'sent_back';
  }
  if (submittedAt !== null) return 'submitted';
  return 'open';
}

function toCriterion(r: Row): ItemCriterion {
  const uid = r[0] as string;
  const latestSubmission = latestSubmissionOf(uid);
  const latestSignoff = latestSignoffOf(uid);
  return {
    uid,
    itemUid: r[1] as string,
    sortOrder: r[2] as number,
    text: r[3] as string,
    kind: r[4] as CriterionKind,
    policy: r[5] as CriterionPolicy,
    source: (r[6] as string | null) ?? null,
    author: r[7] as string,
    authorType: r[8] as string,
    createdAt: r[9] as number,
    updatedAt: r[10] as number,
    state: deriveState(
      latestSubmission, latestSignoff, (r[11] as number | null) ?? null,
      latestSignoff ? evidenceHasChanged(latestSignoff) : false,
    ),
    latestSubmission,
    latestSignoff,
  };
}

/**
 * Has any file this approval was taken on changed since? Compared against
 * the hash the attachment row holds now — which `refreshArtefactHashes`
 * brings up to date at read time and the artefact watcher keeps current.
 * A file that has gone has no hash, and that counts as changed.
 */
function evidenceHasChanged(signoff: CriterionSignoff): boolean {
  const recorded = signoff.evidenceHashes ?? {};
  const uids = Object.keys(recorded);
  if (uids.length === 0) return false;
  const now = currentHashes(uids);
  return uids.some((uid) => recorded[uid] !== now[uid]);
}

export function getCriterion(uid: string): ItemCriterion | null {
  const r = rows(`SELECT ${CRITERION_COLS} FROM item_criteria WHERE uid = ?`, [uid])[0];
  return r ? toCriterion(r) : null;
}

/** Every criterion on an item, in order. Reads the body section once. */
export function listCriteria(itemUid: string): ItemCriterion[] {
  ensureCriteria(itemUid);
  return rows(
    `SELECT ${CRITERION_COLS} FROM item_criteria WHERE item_uid = ? ORDER BY sort_order, created_at`,
    [itemUid],
  ).map(toCriterion);
}

/** One criterion a person has to look at, with where it lives. */
export interface AwaitingCriterion {
  criterion: ItemCriterion;
  itemTitle: string;
  planUid: string;
  planTitle: string;
}

/**
 * Phase 31 §12 — what is waiting on a person, across every plan: work an
 * agent submitted for a person to judge, and approvals whose files have
 * changed since. Newest first.
 *
 * Reads the hashes as stored. The artefact watcher keeps them current for
 * open projects; the phone refreshes an item's before it is decided on.
 */
export function listAwaitingPerson(limit = 100): AwaitingCriterion[] {
  const candidates = rows(
    `SELECT DISTINCT c.uid, i.title, p.uid, p.title
       FROM item_criteria c
       JOIN plan_items i ON i.uid = c.item_uid
       JOIN plans p ON p.uid = i.plan_uid
      WHERE EXISTS (SELECT 1 FROM criterion_evidence e WHERE e.criterion_uid = c.uid)`,
  );
  const out: Array<AwaitingCriterion & { at: number }> = [];
  for (const r of candidates) {
    const criterion = getCriterion(r[0] as string);
    if (!criterion || (criterion.state !== 'submitted' && criterion.state !== 'stale')) continue;
    const at = criterion.state === 'stale'
      ? criterion.latestSignoff?.createdAt ?? 0
      : criterion.latestSubmission[0]?.submittedAt ?? 0;
    out.push({
      criterion, itemTitle: r[1] as string, planUid: r[2] as string, planTitle: r[3] as string, at,
    });
  }
  return out
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
    .map(({ at: _at, ...rest }) => rest);
}

export function listSignoffs(criterionUid: string): CriterionSignoff[] {
  return rows(
    `SELECT uid, criterion_uid, decision, actor, actor_type, channel, note, created_at, evidence_hashes,
            anchor_attachment_uid, anchor_locator
     FROM criterion_signoffs WHERE criterion_uid = ? ORDER BY created_at, rowid`,
    [criterionUid],
  ).map(toSignoff);
}

/**
 * Human-policy criteria not yet met. `getNextItem` gates the next sibling
 * on these — the shape `requiresApproval` used to have as a boolean.
 */
export function unmetHumanCriteria(itemUid: string): ItemCriterion[] {
  return listCriteria(itemUid).filter((c) => c.policy === 'human' && c.state !== 'met');
}

// ── The body section, read once (§4.1 migration) ─────────────────────

/**
 * The `## Acceptance criteria` section of a body, one criterion per list
 * line. Both forms that exist are read: the `- [ ] text` checklist
 * intake writes, and the verbatim prose plan-migrate folded legacy phase
 * criteria into — which, having no list lines, becomes one criterion.
 */
export function parseAcceptanceSection(body: string): string[] {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{1,6}\s+acceptance criteria\s*$/i.test(l.trim()));
  if (start === -1) return [];
  const section: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line.trim())) break;
    section.push(line);
  }
  const listItem = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+?)\s*$/;
  const listed = section.map((l) => l.match(listItem)?.[1]).filter((t): t is string => !!t);
  if (listed.length > 0) return listed;
  const prose = section.join('\n').trim();
  return prose ? [prose] : [];
}

function itemRow(itemUid: string): { body: string; requiresApproval: boolean } | null {
  const r = rows(`SELECT body, requires_approval FROM plan_items WHERE uid = ?`, [itemUid])[0];
  return r ? { body: (r[0] as string) ?? '', requiresApproval: !!(r[1] as number) } : null;
}

function nextSortOrder(itemUid: string): number {
  const r = rows(`SELECT MAX(sort_order) FROM item_criteria WHERE item_uid = ?`, [itemUid])[0];
  return typeof r?.[0] === 'number' ? (r[0] as number) + 1 : 0;
}

function insertCriterion(input: {
  itemUid: string;
  text: string;
  kind: CriterionKind;
  policy: CriterionPolicy;
  source: string | null;
  author: string;
  authorType: string;
  uid?: string;
  sortOrder?: number;
  createdAt?: number;
}): string {
  const uid = input.uid ?? randomUUID();
  const now = tick();
  getDb().run(
    `INSERT INTO item_criteria (${CRITERION_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      uid, input.itemUid, input.sortOrder ?? nextSortOrder(input.itemUid), input.text,
      input.kind, normalisePolicy(input.kind, input.policy), input.source,
      input.author, input.authorType, input.createdAt ?? now, now,
    ],
  );
  return uid;
}

/**
 * Bring an item's criteria up to date with what it already says:
 *  - once, read its `## Acceptance criteria` section into rows (manual,
 *    `propose`). The body is left alone — rewriting prose a person wrote
 *    is not ours to do.
 *  - every time, keep the `requiresApproval` shorthand in step: set, it
 *    stands for one manual/human "Reviewed and approved" criterion;
 *    cleared, that criterion goes. Its decisions stay in the sign-off log.
 */
export function ensureCriteria(itemUid: string): void {
  const item = itemRow(itemUid);
  if (!item) return;
  const db = getDb();
  let changed = false;

  const migrated = rows(`SELECT 1 FROM item_criteria_migrated WHERE item_uid = ?`, [itemUid]).length > 0;
  if (!migrated) {
    for (const text of parseAcceptanceSection(item.body)) {
      insertCriterion({
        itemUid, text, kind: 'manual', policy: 'propose', source: 'migrated',
        author: 'migration', authorType: 'system',
      });
    }
    db.run(`INSERT OR IGNORE INTO item_criteria_migrated (item_uid, migrated_at) VALUES (?, ?)`, [itemUid, Date.now()]);
    changed = true;
  }

  const gate = rows(`SELECT uid FROM item_criteria WHERE item_uid = ? AND source = 'gate'`, [itemUid])[0];
  if (item.requiresApproval && !gate) {
    insertCriterion({
      itemUid, text: GATE_CRITERION_TEXT, kind: 'manual', policy: 'human', source: 'gate',
      author: 'gate', authorType: 'system',
    });
    changed = true;
  } else if (!item.requiresApproval && gate) {
    db.run(`DELETE FROM item_criteria WHERE uid = ?`, [gate[0]]);
    changed = true;
  }

  if (changed) markDirty();
}

// ── Writing ───────────────────────────────────────────────────────────

/**
 * A person adds a criterion. They choose the policy; without one, the
 * kind's default applies.
 */
export function addCriterionAsHuman(
  itemUid: string,
  input: { text: string; kind?: unknown; policy?: unknown },
  decision: HumanDecision,
): ItemCriterion {
  assertHuman(decision);
  requireItem(itemUid);
  const kind = parseKind(input.kind);
  const policy = input.policy === undefined ? defaultPolicy(kind) : parsePolicy(input.policy);
  const uid = insertCriterion({
    itemUid, text: requireText(input.text), kind, policy, source: null,
    author: decision.actor, authorType: 'human',
  });
  markDirty();
  return getCriterion(uid)!;
}

/**
 * An agent adds a criterion. It starts at `propose` whatever the kind
 * (a `manual` one is `human`): intake arrives through an agent, so it
 * must be able to add — but not to decide how strictly its own work is
 * judged.
 */
export function addCriterionAsAgent(
  itemUid: string,
  input: { text: string; kind?: unknown },
  actor: { author: string; authorType: string },
): ItemCriterion {
  requireItem(itemUid);
  const kind = parseKind(input.kind);
  const uid = insertCriterion({
    itemUid, text: requireText(input.text), kind, policy: 'propose', source: null,
    author: actor.author, authorType: actor.authorType,
  });
  markDirty();
  return getCriterion(uid)!;
}

/** Wording, policy, order — a person's edits. Policy is UI-only (§4.3). */
export function updateCriterion(
  uid: string,
  changes: { text?: unknown; policy?: unknown; sortOrder?: unknown },
  decision: HumanDecision,
): ItemCriterion {
  assertHuman(decision);
  const before = getCriterion(uid);
  if (!before) throw new CriterionError('Criterion not found', 404);
  const sets: string[] = [];
  const params: unknown[] = [];
  const now = tick();
  if (changes.text !== undefined) {
    const text = requireText(changes.text);
    if (text !== before.text) {
      sets.push('text = ?', 'text_updated_at = ?'); params.push(text, now);
    }
  }
  if (changes.policy !== undefined) {
    sets.push('policy = ?');
    params.push(normalisePolicy(before.kind, parsePolicy(changes.policy)));
  }
  if (changes.sortOrder !== undefined) {
    if (typeof changes.sortOrder !== 'number' || !Number.isInteger(changes.sortOrder)) {
      throw new CriterionError('sortOrder must be an integer');
    }
    sets.push('sort_order = ?'); params.push(changes.sortOrder);
  }
  if (sets.length === 0) return before;
  sets.push('updated_at = ?'); params.push(now);
  getDb().run(`UPDATE item_criteria SET ${sets.join(', ')} WHERE uid = ?`, [...params, uid]);
  markDirty();
  return getCriterion(uid)!;
}

export function deleteCriterion(uid: string, decision: HumanDecision): boolean {
  assertHuman(decision);
  if (!getCriterion(uid)) return false;
  getDb().run(`DELETE FROM item_criteria WHERE uid = ?`, [uid]);
  markDirty();
  return true;
}

/**
 * An agent offers evidence (§4.3). Each piece names an attachment on the
 * SAME item — evidence from somewhere else is a claim about somewhere
 * else. On an `agent`-policy criterion the submission is also its
 * approval, recorded in the agent's name; otherwise it waits for a person.
 */
export function submitCriterion(
  criterionUid: string,
  input: { evidence?: Array<{ attachmentUid: string; locator?: unknown }>; note?: string | null },
  actor: { author: string; authorType: string },
): ItemCriterion {
  const criterion = getCriterion(criterionUid);
  if (!criterion) throw new CriterionError('Criterion not found', 404);
  const evidence = input.evidence ?? [];
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim() : null;
  if (evidence.length === 0 && !note) {
    throw new CriterionError('A submission needs evidence, a note, or both — say what shows this is met.');
  }
  for (const e of evidence) {
    const owner = rows(
      `SELECT target_type, target_uid FROM attachments WHERE uid = ?`,
      [e.attachmentUid],
    )[0];
    if (!owner) throw new CriterionError(`Attachment ${e.attachmentUid} not found`, 404);
    if (owner[1] !== criterion.itemUid) {
      throw new CriterionError(`Attachment ${e.attachmentUid} belongs to another item; evidence must be attached to this one`);
    }
  }

  const db = getDb();
  const submissionUid = randomUUID();
  const at = tick();
  const pieces = evidence.length > 0 ? evidence : [null];
  for (const e of pieces) {
    db.run(
      `INSERT INTO criterion_evidence
         (uid, criterion_uid, submission_uid, attachment_uid, locator, note, sha256_at_submit,
          submitted_by, submitted_by_type, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(), criterionUid, submissionUid, e?.attachmentUid ?? null,
        e?.locator === undefined || e?.locator === null ? null : JSON.stringify(e.locator),
        note, e ? currentHashes([e.attachmentUid])[e.attachmentUid] : null,
        actor.author, actor.authorType, at,
      ],
    );
  }

  if (criterion.policy === 'agent') {
    appendSignoff(criterionUid, 'approved', actor.author, actor.authorType, 'mcp', note);
  }
  markDirty();
  return getCriterion(criterionUid)!;
}

/**
 * A person approves or sends back (§4.3). Sending back needs a note: it is
 * what the agent reads next, and "no" alone tells it nothing.
 */
export function decideCriterion(
  criterionUid: string,
  input: { decision: unknown; note?: unknown; anchor?: unknown },
  decision: HumanDecision,
): ItemCriterion {
  assertHuman(decision);
  const criterion = getCriterion(criterionUid);
  if (!criterion) throw new CriterionError('Criterion not found', 404);
  if (input.decision !== 'approved' && input.decision !== 'sent_back') {
    throw new CriterionError('decision must be approved or sent_back');
  }
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim() : null;
  if (input.decision === 'sent_back' && !note) {
    throw new CriterionError('Say what is wrong — a send-back note is what the agent reads next.');
  }
  const anchor = input.decision === 'sent_back' ? parseAnchor(input.anchor, criterion.itemUid) : null;
  appendSignoff(criterionUid, input.decision, decision.actor, 'human', decision.channel, note, anchor);
  markDirty();
  return getCriterion(criterionUid)!;
}

/**
 * Where a send-back points (§8.2): an attachment on the SAME item, and a
 * small locator object. A note about a file on some other item is a note
 * about somewhere else.
 */
function parseAnchor(raw: unknown, itemUid: string): { attachmentUid: string; locator: unknown } | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new CriterionError('anchor must be {attachmentUid, locator}');
  const a = raw as Record<string, unknown>;
  if (typeof a.attachmentUid !== 'string') throw new CriterionError('anchor.attachmentUid is required');
  const owner = rows(`SELECT target_uid FROM attachments WHERE uid = ?`, [a.attachmentUid])[0];
  if (!owner) throw new CriterionError('The anchored file is not an attachment', 404);
  if (owner[0] !== itemUid) throw new CriterionError('The anchored file belongs to another item');
  const locator = a.locator ?? null;
  if (locator !== null && (typeof locator !== 'object' || Array.isArray(locator) || JSON.stringify(locator).length > 2000)) {
    throw new CriterionError('anchor.locator must be a small object such as {"lines": "4-6"}');
  }
  return { attachmentUid: a.attachmentUid, locator };
}

function appendSignoff(
  criterionUid: string,
  decision: SignoffDecision,
  actor: string,
  actorType: string,
  channel: CriterionSignoff['channel'],
  note: string | null,
  anchor: { attachmentUid: string; locator: unknown } | null = null,
): void {
  // An approval records the hash of every file it was taken on, so a later
  // edit to any of them shows as `stale` rather than silently still `met`.
  let evidenceHashes: Record<string, string | null> = {};
  if (decision === 'approved') {
    const uids = latestSubmissionOf(criterionUid)
      .map((e) => e.attachmentUid)
      .filter((u): u is string => !!u);
    evidenceHashes = currentHashes(uids);
  }
  getDb().run(
    `INSERT INTO criterion_signoffs
       (uid, criterion_uid, decision, actor, actor_type, channel, note, evidence_hashes, created_at,
        anchor_attachment_uid, anchor_locator)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(), criterionUid, decision, actor, actorType, channel, note, JSON.stringify(evidenceHashes), tick(),
      anchor?.attachmentUid ?? null, anchor ? JSON.stringify(anchor.locator) : null,
    ],
  );
}

// ── Plan files (export / import) ──────────────────────────────────────

export interface CriterionManifest {
  uid: string;
  text: string;
  kind: CriterionKind;
  policy: CriterionPolicy;
  sortOrder: number;
  author: string;
  authorType: string;
  createdAt: string;
}

/**
 * What rides to git: the criteria themselves. Never the decisions — a
 * sign-off read from a file is whatever the file says, and a committed
 * file must not be able to say a person approved something.
 */
export function criteriaForExport(itemUid: string): CriterionManifest[] {
  return listCriteria(itemUid)
    .filter((c) => c.source !== 'gate') // the gate is `requiresApproval`, which is exported itself
    .map((c) => ({
      uid: c.uid,
      text: c.text,
      kind: c.kind,
      policy: c.policy,
      sortOrder: c.sortOrder,
      author: c.author,
      authorType: c.authorType,
      createdAt: new Date(c.createdAt).toISOString(),
    }));
}

/**
 * Criteria read back from a plan file. A plan file is untrusted input
 * (§4.2): it can add criteria and reword them, but it can never make one
 * less strict than it already is here, and a new one can be `agent` only
 * when it is `code` — the kind a machine checks.
 */
export function importCriteria(itemUid: string, raw: unknown): number {
  if (!Array.isArray(raw)) return 0;
  const db = getDb();
  let n = 0;
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const c = entry as Record<string, unknown>;
    if (typeof c.uid !== 'string' || typeof c.text !== 'string' || !c.text.trim()) continue;
    const kind: CriterionKind = isKind(c.kind) ? c.kind : 'manual';
    let policy: CriterionPolicy = isPolicy(c.policy) ? c.policy : defaultPolicy(kind);
    const existing = getCriterion(c.uid);
    if (existing) {
      if (existing.itemUid !== itemUid) continue; // a file never moves a criterion to another item
      if (STRICTNESS[policy] < STRICTNESS[existing.policy]) policy = existing.policy;
      const now = tick();
      const reworded = c.text.trim() !== existing.text;
      db.run(
        `UPDATE item_criteria SET text = ?, policy = ?, sort_order = ?, updated_at = ?,
           text_updated_at = CASE WHEN ? THEN ? ELSE text_updated_at END
         WHERE uid = ?`,
        [
          c.text.trim(), normalisePolicy(existing.kind, policy),
          typeof c.sortOrder === 'number' ? c.sortOrder : existing.sortOrder, now,
          reworded ? 1 : 0, now, c.uid,
        ],
      );
    } else {
      if (policy === 'agent' && kind !== 'code') policy = 'propose';
      insertCriterion({
        uid: c.uid, itemUid, text: c.text.trim(), kind, policy, source: 'import',
        author: typeof c.author === 'string' ? c.author : 'file-import',
        authorType: 'file-import',
        sortOrder: typeof c.sortOrder === 'number' ? c.sortOrder : undefined,
        createdAt: typeof c.createdAt === 'string' ? Date.parse(c.createdAt) || undefined : undefined,
      });
    }
    n++;
  }
  // The file now carries the criteria; its body section must not be read
  // into a second copy of them.
  db.run(`INSERT OR IGNORE INTO item_criteria_migrated (item_uid, migrated_at) VALUES (?, ?)`, [itemUid, Date.now()]);
  markDirty();
  return n;
}

// ── helpers ───────────────────────────────────────────────────────────

function assertHuman(decision: HumanDecision): void {
  if (!isHumanDecision(decision)) {
    throw new CriterionError('Only a person can do this, from CodeTrellis or a paired phone.', 403);
  }
}

function requireItem(itemUid: string): void {
  if (!itemRow(itemUid)) throw new CriterionError('Item not found', 404);
}

function requireText(text: unknown): string {
  if (typeof text !== 'string' || !text.trim()) throw new CriterionError('text is required');
  return text.trim();
}

function parseKind(kind: unknown): CriterionKind {
  if (kind === undefined) return 'manual';
  if (!isKind(kind)) throw new CriterionError(`kind must be one of: ${CRITERION_KINDS.join(', ')}`);
  return kind;
}

function parsePolicy(policy: unknown): CriterionPolicy {
  if (!isPolicy(policy)) throw new CriterionError(`policy must be one of: ${CRITERION_POLICIES.join(', ')}`);
  return policy;
}
