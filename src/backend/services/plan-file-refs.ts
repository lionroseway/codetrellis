/**
 * Ticket refs in the plan's files (Phase 32 C2.5a, shared-work doc C-2 §2).
 *
 * `plan.yaml` carries the plan's tickets (`set_plan_external_ref`, an
 * intake) and each item's file carries the links attached to it, so the
 * lineage "JIRA-142 → this plan → PR #118" survives a pull: a teammate who
 * imports the plan sees its ticket. A ref is intent, like the item it
 * belongs to, and changes only when someone adds or edits one.
 *
 * A plan file is anyone's text, so what is read from one is cleaned
 * (`cleanRefs`): http(s) links only, keys and titles of bounded length, at
 * most MAX_REFS. Import adds a ref this machine lacks and updates the title
 * of one it has; it never removes one, so a file cannot take a ref away.
 */

import type { ExternalRefKind } from '../../shared/types';
import { getPlanExternalRefs, setPlanExternalRef, sameUrl } from './external-intake-service';
import { createExternalRef, getExternalRefs, inferKind, updateExternalRef } from './external-refs-service';

/** A ref as a plan file writes it. */
export interface FileRef { url: string; key?: string; kind?: string; title?: string }

const MAX_REFS = 50;
const KINDS: ReadonlySet<string> = new Set(['github_issue', 'github_pr', 'github_commit', 'jira', 'linear', 'figma', 'notion', 'slack', 'url']);
const KEY = /^[A-Za-z0-9][A-Za-z0-9_.#/-]{0,99}$/;
const IMPORTED = { author: 'file-import', authorType: 'system' } as const;

/** What a plan file's `refs` may hold, cleaned; anything else is dropped. Pure. */
export function cleanRefs(raw: unknown): Array<{ url: string; key: string | null; kind: ExternalRefKind; title: string | null }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ url: string; key: string | null; kind: ExternalRefKind; title: string | null }> = [];
  for (const r of raw.slice(0, MAX_REFS)) {
    if (!r || typeof r !== 'object') continue;
    const { url, key, kind, title } = r as Record<string, unknown>;
    if (typeof url !== 'string' || url.length > 2048) continue;
    let parsed: URL;
    try { parsed = new URL(url); } catch { continue; }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') continue;
    if (out.some((o) => sameUrl(o.url, url))) continue;
    out.push({
      url,
      key: typeof key === 'string' && KEY.test(key) ? key : null,
      kind: typeof kind === 'string' && KINDS.has(kind) ? (kind as ExternalRefKind) : inferKind(url),
      title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 200) : null,
    });
  }
  return out;
}

/** A title that only repeats the key or the link says nothing, and is left out. */
const fileRef = (r: { url: string; externalKey?: string | null; kind: string; title: string }): FileRef => ({
  url: r.url, ...(r.externalKey ? { key: r.externalKey } : {}), kind: r.kind,
  ...(r.title && r.title !== r.url && r.title !== r.externalKey ? { title: r.title } : {}),
});

/** The plan's tickets, for `plan.yaml`, oldest first; empty when it has none. */
export function refsForPlan(planUid: string): FileRef[] {
  try { return getPlanExternalRefs(planUid).map(fileRef); } catch { return []; }
}

/** The links attached to an item, for its file. */
export function refsForItem(itemUid: string): FileRef[] {
  try { return getExternalRefs(itemUid).map(fileRef); } catch { return []; }
}

/** Add the tickets a `plan.yaml` names that this machine lacks. */
export function importPlanRefs(planUid: string, raw: unknown): number {
  let n = 0;
  for (const r of cleanRefs(raw)) {
    setPlanExternalRef({ planUid, url: r.url, key: r.key, kind: r.kind, ...(r.title ? { title: r.title } : {}), ...IMPORTED });
    n++;
  }
  return n;
}

/** Add the links an item's file names that this machine lacks; a title is updated, nothing removed. */
export function importItemRefs(itemUid: string, raw: unknown): number {
  const have = getExternalRefs(itemUid);
  let n = 0;
  for (const r of cleanRefs(raw)) {
    const existing = have.find((h) => sameUrl(h.url, r.url));
    if (existing) {
      if (r.title && r.title !== existing.title) updateExternalRef(existing.uid, { title: r.title });
      continue;
    }
    createExternalRef({ itemUid, url: r.url, kind: r.kind, externalKey: r.key, ...(r.title ? { title: r.title } : {}), ...IMPORTED });
    n++;
  }
  return n;
}
