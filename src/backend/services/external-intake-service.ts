import { randomUUID } from 'node:crypto';
import { getDb } from './database';
import { markDirty } from './persistence';
import { inferKind } from './external-refs-service';
import type { ExternalRefKind } from '../../shared/types';

/**
 * External intake — Phase 24.
 *
 * See [docs/PHASE-24-SDLC-INTAKE.md](../../../docs/PHASE-24-SDLC-INTAKE.md).
 *
 * ## The principle: we do not build integrations
 *
 * A BA writes an epic in Jira. A developer's agent already holds both
 * the Jira MCP server and ours. So the right move is not to write a Jira
 * client — it is to expose the contract an agent needs to do the
 * integration itself.
 *
 * Three reasons, and they compound:
 *
 *   1. **Credentials.** A Jira client means storing a Jira token on a
 *      developer workstation. Phase 19 exists precisely to avoid being
 *      that.
 *   2. **Agent-agnosticism.** A contract works unchanged for Jira,
 *      Linear, Azure DevOps, GitHub Projects, Shortcut and a wiki page.
 *      A client works for one, and then we owe five more.
 *   3. **The promise.** "No data leaves your machine, no extra account"
 *      is on the README. An outbound Jira sync breaks it.
 *
 * So: the agent fetches, we structure. The agent writes back, we say
 * what changed. No credential ever comes near this process, and nothing
 * here ever makes an outbound call.
 *
 * ## Ticket text is untrusted input
 *
 * It reaches us through an agent, from a system many people can write
 * to. It is data, never instruction: stored inert, never executed, never
 * interpreted as a command.
 */

/** Epic → story → task. Deeper than this is flattened. */
export const MAX_INTAKE_DEPTH = 3;

export interface ExternalRefInput {
  /** `PROJ-412`, `ENG-88`. */
  key?: string | null;
  url: string;
  title?: string;
  kind?: ExternalRefKind;
}

export interface IntakeNode {
  external?: ExternalRefInput | null;
  title: string;
  body?: string;
  /** Acceptance criteria as authored in the ticket. */
  acceptance?: string[];
  /** `object` (a page) or `action` (work). Defaults sensibly by depth. */
  kind?: 'object' | 'action';
  children?: IntakeNode[];
}

export interface PlanExternalRef {
  uid: string;
  planUid: string;
  kind: ExternalRefKind;
  url: string;
  title: string;
  externalKey: string | null;
  /**
   * Who attached this ticket.
   *
   * Written since the column existed and read back by no query, which
   * made the attribution unfalsifiable — the MCP handler was passing no
   * author at all and nothing anywhere could show it.
   */
  author: string;
  authorType: string;
  createdAt: number;
}

// ── Plan-level refs ──────────────────────────────────────────────────

export function getPlanExternalRefs(planUid: string): PlanExternalRef[] {
  try {
    const res = getDb().exec(
      `SELECT uid, plan_uid, kind, url, title, external_key, author, author_type, created_at
       FROM plan_external_refs WHERE plan_uid = ? ORDER BY created_at ASC`,
      [planUid],
    );
    return (res[0]?.values ?? []).map((r: unknown[]) => ({
      uid: r[0] as string,
      planUid: r[1] as string,
      kind: r[2] as ExternalRefKind,
      url: r[3] as string,
      title: r[4] as string,
      externalKey: (r[5] as string | null) ?? null,
      author: r[6] as string,
      authorType: r[7] as string,
      createdAt: r[8] as number,
    }));
  } catch {
    return [];
  }
}

/**
 * URL equality for idempotency, not for security.
 *
 * Trailing slash and case of the scheme/host are the differences a human
 * pasting the same ticket twice actually produces. Anything beyond that
 * — query order, default ports — is left alone deliberately: two URLs
 * that differ there may well be two different things, and collapsing
 * them would lose a ref rather than deduplicate one.
 */
function sameUrl(a: string, b: string): boolean {
  const norm = (u: string): string => {
    try {
      const p = new URL(u);
      return `${p.protocol.toLowerCase()}//${p.host.toLowerCase()}${p.pathname.replace(/\/+$/, '')}${p.search}`;
    } catch {
      return u.trim().replace(/\/+$/, '');
    }
  };
  return norm(a) === norm(b);
}

/**
 * The plan already carrying this external key, if any.
 *
 * `setPlanExternalRef` is idempotent on `(plan, key)`, which makes re-attaching
 * a ticket to the SAME plan safe — but nothing asked whether some OTHER plan
 * already represents that epic, so `create_plan_from_external` made a second
 * one every time, against a tool description promising the opposite.
 */
export function findPlanByExternalKey(key: string): string | null {
  if (!key) return null;
  try {
    const res = getDb().exec(
      `SELECT plan_uid FROM plan_external_refs WHERE external_key = ? ORDER BY created_at ASC LIMIT 1`,
      [key],
    );
    return (res[0]?.values?.[0]?.[0] as string | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * Attach a ticket to a plan. Idempotent on `(plan, key)` so re-importing
 * an epic updates rather than duplicating.
 */
export function setPlanExternalRef(input: {
  planUid: string;
  url: string;
  key?: string | null;
  title?: string;
  kind?: ExternalRefKind;
  author?: string;
  authorType?: string;
}): PlanExternalRef {
  const db = getDb();
  const kind = input.kind ?? inferKind(input.url);
  const key = input.key ?? keyFromUrl(input.url, kind);
  const title = input.title?.trim() || key || input.url;
  const now = Date.now();

  // Idempotent on the key where there is one, and on the URL where
  // there is not.
  //
  // `keyFromUrl` recognises Jira, Linear and GitHub. The service claims
  // to accept "Azure DevOps, GitHub Projects, Shortcut and a wiki page"
  // too, and for all of those the key is null — so this lookup used to
  // be skipped entirely and every call INSERTed. The unique index does
  // not catch it either: SQLite treats NULLs as distinct, so three
  // identical calls left three rows. `set_plan_external_ref` advertises
  // "Idempotent on the ticket key, so calling it twice updates rather
  // than duplicating", and for most of the trackers the docstring names
  // that was false.
  const refs = getPlanExternalRefs(input.planUid);
  const existing = key
    ? refs.find((r) => r.externalKey === key)
    : refs.find((r) => r.externalKey === null && sameUrl(r.url, input.url));

  if (existing) {
    db.run(`UPDATE plan_external_refs SET url = ?, title = ?, kind = ? WHERE uid = ?`, [
      input.url,
      title,
      kind,
      existing.uid,
    ]);
    markDirty();
    return { ...existing, url: input.url, title, kind };
  }

  const uid = randomUUID();
  const author = input.author ?? 'human';
  const authorType = input.authorType ?? 'human';
  db.run(
    `INSERT INTO plan_external_refs (uid, plan_uid, kind, url, title, external_key, author, author_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid, input.planUid, kind, input.url, title, key, author, authorType, now],
  );
  markDirty();
  return {
    uid, planUid: input.planUid, kind, url: input.url, title,
    externalKey: key, author, authorType, createdAt: now,
  };
}

/**
 * Pull a ticket key out of a URL. The same patterns
 * `external-refs-service` already recognises, reduced to just the key.
 */
export function keyFromUrl(url: string, kind?: ExternalRefKind): string | null {
  const k = kind ?? inferKind(url);
  const patterns: Partial<Record<ExternalRefKind, RegExp>> = {
    jira: /\/browse\/([A-Z][A-Z0-9_]+-\d+)/i,
    linear: /\/issue\/([A-Z][A-Z0-9_]+-\d+)/i,
    github_issue: /github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/i,
    github_pr: /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/i,
  };
  const re = patterns[k];
  if (!re) return null;
  const m = re.exec(url);
  if (!m) return null;
  return m.length > 2 ? `${m[1]}#${m[2]}` : m[1].toUpperCase();
}

// ── Acceptance criteria ──────────────────────────────────────────────

/**
 * Render acceptance criteria as a markdown checklist appended to an
 * item's body.
 *
 * Items have no dedicated acceptance field — the model puts acceptance
 * in a spec doc or in the body — so rather than add a field, the
 * criteria land where the body renderer already shows checkboxes and
 * where `plan-changes-service` can read them. Prose from the ticket
 * stays prose; it is simply reachable.
 */
export function acceptanceSection(criteria: string[]): string {
  const clean = criteria.map((c) => c.trim()).filter(Boolean);
  if (clean.length === 0) return '';
  return ['', '## Acceptance criteria', ...clean.map((c) => `- [ ] ${c}`), ''].join('\n');
}

// ── Sync state ───────────────────────────────────────────────────────

export interface SyncStateEntry {
  itemUid: string;
  title: string;
  status: string | null;
  externalKey: string;
  url: string;
  updatedAt: number;
  /** What a Jira-style workflow would probably do with this status. */
  suggestedTransition: string | null;
}

export interface SyncState {
  planUid: string;
  lastSyncedAt: number | null;
  changed: SyncStateEntry[];
  /** Plan-level ticket, when the plan came from an epic. */
  planRefs: PlanExternalRef[];
}

/**
 * The status a ticket probably wants, given the item's status.
 *
 * Advisory only, and named so. Every tracker has its own workflow; the
 * agent holds the Jira MCP and knows the real transition names. Guessing
 * them here would be inventing a workflow we cannot see.
 */
function suggestTransition(status: string | null): string | null {
  switch (status) {
    case 'in_progress':
      return 'In Progress';
    case 'done':
      return 'Done';
    case 'blocked':
      return 'Blocked';
    case 'pending':
    case 'assigned':
      return 'To Do';
    default:
      return null;
  }
}

export function getSyncState(planUid: string): SyncState {
  const db = getDb();

  let lastSyncedAt: number | null = null;
  try {
    const res = db.exec(`SELECT last_synced_at FROM external_sync_state WHERE plan_uid = ?`, [planUid]);
    const row = res[0]?.values[0];
    if (row) lastSyncedAt = row[0] as number;
  } catch {
    /* table may not exist yet on a very old db */
  }

  const changed: SyncStateEntry[] = [];
  try {
    // Items that carry a ticket key AND have moved since the watermark.
    // A null watermark means "never synced", so everything with a key
    // counts as changed — which is the correct first run.
    const res = db.exec(
      `SELECT i.uid, i.title, i.status, i.updated_at, r.external_key, r.url
       FROM plan_items i
       JOIN external_refs r ON r.item_uid = i.uid
       WHERE i.plan_uid = ?
         AND r.external_key IS NOT NULL
         AND (? IS NULL OR i.updated_at > ?)
       ORDER BY i.updated_at ASC`,
      [planUid, lastSyncedAt, lastSyncedAt],
    );
    for (const row of res[0]?.values ?? []) {
      const status = (row[2] as string | null) ?? null;
      changed.push({
        itemUid: row[0] as string,
        title: row[1] as string,
        status,
        updatedAt: row[3] as number,
        externalKey: row[4] as string,
        url: row[5] as string,
        suggestedTransition: suggestTransition(status),
      });
    }
  } catch {
    /* no items, or an old schema */
  }

  return { planUid, lastSyncedAt, changed, planRefs: getPlanExternalRefs(planUid) };
}

/**
 * Record that an agent has written these changes back.
 *
 * Deliberately separate from `getSyncState`: reading must not advance
 * the watermark, because an agent that read the list and then failed to
 * write would otherwise silently lose those transitions forever.
 */
export function markSynced(planUid: string, syncedBy?: string, note?: string): { lastSyncedAt: number } {
  const now = Date.now();
  getDb().run(
    `INSERT INTO external_sync_state (plan_uid, last_synced_at, synced_by, note)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(plan_uid) DO UPDATE SET
       last_synced_at = excluded.last_synced_at,
       synced_by = excluded.synced_by,
       note = excluded.note`,
    [planUid, now, syncedBy ?? null, note ?? null],
  );
  markDirty();
  return { lastSyncedAt: now };
}

// ── Intake tree ──────────────────────────────────────────────────────

export interface FlatIntakeNode {
  node: IntakeNode;
  depth: number;
  parentIndex: number | null;
}

/**
 * Flatten an intake tree, capping depth.
 *
 * Ticket hierarchies can be pathological — an epic under an initiative
 * under a theme, or a cycle created by a misconfigured link type. Beyond
 * the cap, children are attached to the deepest allowed ancestor rather
 * than dropped: losing a story because someone nested it oddly would be
 * worse than showing it one level up.
 */
export function flattenIntake(
  roots: IntakeNode[],
  maxDepth: number = MAX_INTAKE_DEPTH,
): FlatIntakeNode[] {
  const out: FlatIntakeNode[] = [];

  const walk = (node: IntakeNode, depth: number, parentIndex: number | null): void => {
    const index = out.length;
    out.push({ node, depth, parentIndex });

    const canNest = depth + 1 <= maxDepth - 1;
    // Past the cap a child becomes a SIBLING of the node that would have
    // held it — same depth, same parent — rather than being dropped or
    // nested further. Losing a story because someone filed it under an
    // extra layer would be worse than showing it one level up.
    const childDepth = canNest ? depth + 1 : depth;
    const childParent = canNest ? index : parentIndex;

    for (const child of node.children ?? []) {
      walk(child, childDepth, childParent);
    }
  };

  for (const root of roots) walk(root, 0, null);
  return out;
}

/** Body text for an intake node — ticket body plus acceptance criteria. */
export function intakeBody(node: IntakeNode): string {
  const body = (node.body ?? '').trim();
  const acceptance = acceptanceSection(node.acceptance ?? []);
  return [body, acceptance].filter(Boolean).join('\n');
}

/**
 * Default kind by depth: the top of an intake is context (a page), and
 * its leaves are work. An explicit `kind` always wins.
 */
export function intakeKind(node: IntakeNode, depth: number): 'object' | 'action' {
  if (node.kind) return node.kind;
  return depth === 0 && (node.children?.length ?? 0) > 0 ? 'object' : 'action';
}
