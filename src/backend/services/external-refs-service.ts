/**
 * Phase 17.R — External References service.
 *
 * CRUD operations on the `external_refs` table. Each ref links a plan
 * item to an external resource (GitHub issue/PR, Jira ticket, Figma
 * frame, Linear issue, or any URL).
 *
 * URL parsing infers the `kind` when the user pastes a URL — no need
 * to pick from a dropdown. The rich metadata fields (issue number,
 * state, labels) can be filled in later by an optional fetch step.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from './database';
import type { ExternalRef, ExternalRefKind } from '../../shared/types';

// ── URL-to-kind inference ───────────────────────────────────────────────

const KIND_PATTERNS: Array<{ pattern: RegExp; kind: ExternalRefKind }> = [
  { pattern: /github\.com\/[^/]+\/[^/]+\/issues\/\d+/i, kind: 'github_issue' },
  { pattern: /github\.com\/[^/]+\/[^/]+\/pull\/\d+/i, kind: 'github_pr' },
  { pattern: /github\.com\/[^/]+\/[^/]+\/commit\/[0-9a-f]+/i, kind: 'github_commit' },
  { pattern: /\.atlassian\.net\/browse\/[A-Z]+-\d+/i, kind: 'jira' },
  { pattern: /linear\.app\/[^/]+\/issue\//i, kind: 'linear' },
  { pattern: /figma\.com\/(file|design|proto)/i, kind: 'figma' },
  { pattern: /notion\.so\//i, kind: 'notion' },
  { pattern: /slack\.com\/archives\//i, kind: 'slack' },
];

export function inferKind(url: string): ExternalRefKind {
  for (const { pattern, kind } of KIND_PATTERNS) {
    if (pattern.test(url)) return kind;
  }
  return 'url';
}

/**
 * Extract a reasonable default title from a URL.
 */
function titleFromUrl(url: string, kind: ExternalRefKind): string {
  try {
    const u = new URL(url);
    switch (kind) {
      case 'github_issue': {
        const m = u.pathname.match(/\/([^/]+\/[^/]+)\/issues\/(\d+)/);
        return m ? `${m[1]}#${m[2]}` : u.hostname + u.pathname;
      }
      case 'github_pr': {
        const m = u.pathname.match(/\/([^/]+\/[^/]+)\/pull\/(\d+)/);
        return m ? `${m[1]}#${m[2]}` : u.hostname + u.pathname;
      }
      case 'github_commit': {
        const m = u.pathname.match(/\/([^/]+\/[^/]+)\/commit\/([0-9a-f]{7})/);
        return m ? `${m[1]}@${m[2]}` : u.hostname + u.pathname;
      }
      case 'jira': {
        const m = u.pathname.match(/\/browse\/([A-Z]+-\d+)/i);
        return m ? m[1] : u.hostname + u.pathname;
      }
      case 'linear': {
        const m = u.pathname.match(/\/issue\/([A-Z]+-\d+)/i);
        return m ? m[1] : u.hostname + u.pathname;
      }
      case 'figma':
        return 'Figma – ' + (u.pathname.split('/').pop() ?? '').replace(/-/g, ' ').slice(0, 60);
      case 'notion':
        return 'Notion – ' + (u.pathname.split('/').pop() ?? '').replace(/-/g, ' ').slice(0, 60);
      case 'slack':
        return 'Slack thread';
      default:
        return u.hostname + (u.pathname.length > 1 ? u.pathname.slice(0, 60) : '');
    }
  } catch {
    return url.slice(0, 80);
  }
}

// ── Row mapper ──────────────────────────────────────────────────────────

function rowToRef(row: unknown[]): ExternalRef {
  return {
    uid: row[0] as string,
    itemUid: row[1] as string,
    kind: row[2] as ExternalRefKind,
    url: row[3] as string,
    title: row[4] as string,
    metadata: row[5] ? JSON.parse(row[5] as string) : null,
    author: row[6] as string,
    authorType: row[7] as string,
    createdAt: row[8] as number,
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────────

export function getExternalRefs(itemUid: string): ExternalRef[] {
  const d = getDb();
  const result = d.exec(
    `SELECT uid, item_uid, kind, url, title, metadata, author, author_type, created_at
     FROM external_refs WHERE item_uid = ? ORDER BY created_at ASC`,
    [itemUid],
  );
  return (result[0]?.values ?? []).map(rowToRef);
}

export function getExternalRefsByPlan(planUid: string): ExternalRef[] {
  const d = getDb();
  const result = d.exec(
    `SELECT r.uid, r.item_uid, r.kind, r.url, r.title, r.metadata, r.author, r.author_type, r.created_at
     FROM external_refs r
     JOIN plan_items i ON i.uid = r.item_uid
     WHERE i.plan_uid = ?
     ORDER BY r.created_at ASC`,
    [planUid],
  );
  return (result[0]?.values ?? []).map(rowToRef);
}

export function createExternalRef(input: {
  itemUid: string;
  url: string;
  title?: string;
  kind?: ExternalRefKind;
  metadata?: Record<string, unknown> | null;
  author?: string;
  authorType?: string;
}): ExternalRef {
  const d = getDb();
  const uid = randomUUID();
  const kind = input.kind ?? inferKind(input.url);
  const title = input.title?.trim() || titleFromUrl(input.url, kind);
  const now = Date.now();

  d.run(
    `INSERT INTO external_refs (uid, item_uid, kind, url, title, metadata, author, author_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uid,
      input.itemUid,
      kind,
      input.url,
      title,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.author ?? 'human',
      input.authorType ?? 'human',
      now,
    ],
  );

  return {
    uid,
    itemUid: input.itemUid,
    kind,
    url: input.url,
    title,
    metadata: input.metadata ?? null,
    author: input.author ?? 'human',
    authorType: input.authorType ?? 'human',
    createdAt: now,
  };
}

export function updateExternalRef(
  uid: string,
  updates: { title?: string; metadata?: Record<string, unknown> | null },
): void {
  const d = getDb();
  const sets: string[] = [];
  const vals: unknown[] = [];

  if (updates.title !== undefined) {
    sets.push('title = ?');
    vals.push(updates.title);
  }
  if (updates.metadata !== undefined) {
    sets.push('metadata = ?');
    vals.push(updates.metadata ? JSON.stringify(updates.metadata) : null);
  }

  if (sets.length === 0) return;
  vals.push(uid);
  d.run(`UPDATE external_refs SET ${sets.join(', ')} WHERE uid = ?`, vals);
}

export function deleteExternalRef(uid: string): void {
  const d = getDb();
  d.run(`DELETE FROM external_refs WHERE uid = ?`, [uid]);
}
