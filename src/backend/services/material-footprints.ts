/**
 * Material footprints (Phase 32 A6.2, awareness spec §10.2).
 *
 * A code workstream's footprint is the files it changed. A task's is the
 * files it works from and on: what its sessions read through `read_material`
 * (which file, which part, and the file's hash when they read it), the
 * outputs recorded on it, and the parts of materials its citations name. The
 * material signals (A6.3) compare footprints across tasks.
 *
 * Only what the tools already see is recorded: the read handler writes a row,
 * and nothing is read back out of the materials themselves.
 */

import { getDb } from './database';
import { markDirty } from './persistence';
import type { MaterialLocator } from './material-reader/read';
import type { MaterialTaskInput } from './material-signals';
import { taskWorkstreamId } from './task-workstreams';

function rowsOf<T>(sql: string, params: Array<string | number | null> = []): T[] {
  const res = getDb().exec(sql, params);
  if (!res.length) return [];
  const { columns, values } = res[0];
  return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i]])) as T);
}

/** A locator as stored and compared: its keys in one order, empty ones dropped. */
export function locatorKey(locator: MaterialLocator | null | undefined): string | null {
  if (!locator) return null;
  const keys = (['sheet', 'range', 'page', 'lines', 'text'] as const).filter((k) => locator[k] !== undefined && locator[k] !== '');
  if (!keys.length) return null;
  return JSON.stringify(Object.fromEntries(keys.map((k) => [k, locator[k]])));
}

/**
 * Store one read. The task it counts for is the session's brief task (A6.1),
 * or the material's own task when the session has none. The hash is the
 * attachment's as the read left it: resolving a material re-takes the hash of
 * a file whose size or mtime moved. Returns the task, or null when the
 * attachment is gone.
 */
export function recordMaterialRead(input: {
  attachmentUid: string;
  sessionId: string | null;
  locator?: MaterialLocator | null;
  at?: number;
}): string | null {
  const att = rowsOf<{ target_uid: string; value: string; sha256: string | null }>(
    'SELECT target_uid, value, sha256 FROM attachments WHERE uid = ?', [input.attachmentUid],
  )[0];
  if (!att) return null;
  const brief = input.sessionId
    ? rowsOf<{ brief_item_uid: string | null }>('SELECT brief_item_uid FROM agent_sessions WHERE session_id = ?', [input.sessionId])[0]?.brief_item_uid ?? null
    : null;
  const itemUid = brief ?? att.target_uid;
  getDb().run(
    'INSERT INTO material_reads (item_uid, session_id, attachment_uid, path, sha256, locator, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [itemUid, input.sessionId, input.attachmentUid, att.value, att.sha256, locatorKey(input.locator), input.at ?? Date.now()],
  );
  markDirty();
  return itemUid;
}

export interface MaterialReadRecord {
  sessionId: string | null;
  agent: string | null;
  attachmentUid: string;
  sha256: string | null;
  locator: MaterialLocator | null;
  at: number;
}

export interface FootprintMaterial {
  /** Project-relative, the material's identity across tasks. */
  path: string;
  /** The attachment last read, to pass to read_material. */
  attachmentUid: string;
  /** Every read, oldest first. */
  reads: MaterialReadRecord[];
  /** The hash the latest read saw. */
  lastSha256: string | null;
  /** The parts read, each once; empty when only the whole file was. */
  parts: MaterialLocator[];
}

export interface FootprintFile {
  attachmentUid: string;
  path: string;
  sha256: string | null;
}

export interface FootprintCitation extends FootprintFile {
  locator: MaterialLocator | null;
  criterionUid: string;
  /** The file's hash when it was last cited there. */
  sha256AtCite: string | null;
  /** A person approved the criterion at its latest decision. */
  signedOff: boolean;
}

export interface TaskFootprint {
  itemUid: string;
  read: FootprintMaterial[];
  outputs: FootprintFile[];
  cited: FootprintCitation[];
}

const parseLocator = (s: string | null): MaterialLocator | null => {
  if (!s) return null;
  try { return JSON.parse(s) as MaterialLocator; } catch { return null; }
};

/** What a task works from and on. Empty lists when it has none of each. */
export function taskFootprint(itemUid: string): TaskFootprint {
  const reads = rowsOf<{ session_id: string | null; agent_type: string | null; attachment_uid: string; path: string; sha256: string | null; locator: string | null; at: number }>(
    `SELECT r.session_id, s.agent_type, r.attachment_uid, r.path, r.sha256, r.locator, r.at
       FROM material_reads r LEFT JOIN agent_sessions s ON s.session_id = r.session_id
      WHERE r.item_uid = ? ORDER BY r.at, r.rowid`,
    [itemUid],
  );
  const byPath = new Map<string, FootprintMaterial>();
  for (const r of reads) {
    const m = byPath.get(r.path) ?? byPath.set(r.path, { path: r.path, attachmentUid: r.attachment_uid, reads: [], lastSha256: null, parts: [] }).get(r.path)!;
    const locator = parseLocator(r.locator);
    m.reads.push({ sessionId: r.session_id, agent: r.agent_type, attachmentUid: r.attachment_uid, sha256: r.sha256, locator, at: Number(r.at) });
    m.attachmentUid = r.attachment_uid;
    m.lastSha256 = r.sha256;
    if (r.locator && !m.parts.some((p) => locatorKey(p) === r.locator)) m.parts.push(locator!);
  }

  const outputs = rowsOf<{ uid: string; value: string; sha256: string | null }>(
    `SELECT uid, value, sha256 FROM attachments WHERE target_type = 'item' AND target_uid = ? AND role = 'output' ORDER BY created_at`,
    [itemUid],
  ).map((r) => ({ attachmentUid: r.uid, path: r.value, sha256: r.sha256 }));

  // Each part once, as it was cited last: a fresh citation is against the file as it is now.
  const cited = new Map<string, FootprintCitation>();
  for (const r of rowsOf<{ criterion_uid: string; attachment_uid: string; value: string; sha256: string | null; locator: string | null; at_cite: string | null; decision: string | null }>(
    `SELECT e.criterion_uid, e.attachment_uid, a.value, a.sha256, e.locator, e.sha256_at_submit AS at_cite,
            (SELECT s.decision FROM criterion_signoffs s WHERE s.criterion_uid = e.criterion_uid ORDER BY s.created_at DESC, s.rowid DESC LIMIT 1) AS decision
       FROM criterion_evidence e
       JOIN item_criteria c ON c.uid = e.criterion_uid
       JOIN attachments a ON a.uid = e.attachment_uid
      WHERE c.item_uid = ? AND e.attachment_uid IS NOT NULL
      ORDER BY e.submitted_at, e.rowid`,
    [itemUid],
  )) {
    const locator = parseLocator(r.locator);
    const key = `${r.value}\n${locatorKey(locator) ?? ''}`;
    cited.delete(key);
    cited.set(key, {
      attachmentUid: r.attachment_uid, path: r.value, sha256: r.sha256, locator, criterionUid: r.criterion_uid,
      sha256AtCite: r.at_cite, signedOff: r.decision === 'approved',
    });
  }

  return { itemUid, read: [...byPath.values()], outputs, cited: [...cited.values()] };
}

/** A locator in words, as a person would say it: "Summary!B2:F9", "page 3", "lines 40–80". */
export function partWords(l: MaterialLocator | null): string {
  if (!l) return 'the whole file';
  if (l.sheet || l.range) return l.sheet && l.range ? `${l.sheet}!${l.range}` : (l.sheet ?? l.range)!;
  if (l.page !== undefined) return /[-–]/.test(String(l.page)) ? `pages ${String(l.page).replace('-', '–')}` : `page ${l.page}`;
  if (l.lines !== undefined) return /[-–]/.test(String(l.lines)) ? `lines ${String(l.lines).replace('-', '–')}` : `line ${l.lines}`;
  if (l.text) return `where it says “${l.text.length > 40 ? `${l.text.slice(0, 40)}…` : l.text}”`;
  return 'the whole file';
}

/**
 * What `get_brief` shows of the footprint: the materials this task has read,
 * the parts, by whom, and the hash each saw. Kept small: a line per material.
 */
export function readSoFar(itemUid: string): Array<{ path: string; attachment_uid: string; reads: number; parts: string[]; by: string[]; sha256: string | null; last_read_at: string }> {
  return taskFootprint(itemUid).read.map((m) => ({
    path: m.path,
    attachment_uid: m.attachmentUid,
    reads: m.reads.length,
    parts: [...new Set(m.reads.map((r) => partWords(r.locator)))],
    by: [...new Set(m.reads.map((r) => r.agent ?? 'an agent'))],
    sha256: m.lastSha256,
    last_read_at: new Date(m.reads[m.reads.length - 1].at).toISOString(),
  }));
}

/**
 * What the material signals (A6.3) are computed from, for one project: every
 * task that has read, recorded an output or cited a material, and each
 * material's hash now. The project is matched as plans store it, with or
 * without a trailing separator.
 */
export function materialInputsOf(projectRoot: string): { tasks: MaterialTaskInput[]; current: Record<string, string | null> } {
  const trimmed = projectRoot.replace(/[\\/]+$/, '');
  const inProject = `SELECT i.uid FROM plan_items i JOIN plans p ON p.uid = i.plan_uid WHERE p.project_path = ? OR p.project_path = ?`;
  const uids = rowsOf<{ uid: string }>(
    `SELECT DISTINCT uid FROM (
       SELECT item_uid AS uid FROM material_reads
       UNION SELECT target_uid FROM attachments WHERE role = 'output'
       UNION SELECT c.item_uid FROM criterion_evidence e JOIN item_criteria c ON c.uid = e.criterion_uid WHERE e.attachment_uid IS NOT NULL
     ) WHERE uid IN (${inProject}) ORDER BY uid`,
    [projectRoot, trimmed],
  ).map((r) => r.uid);

  const titleOf = (uid: string) => rowsOf<{ title: string }>('SELECT title FROM plan_items WHERE uid = ?', [uid])[0]?.title ?? uid;
  const ownerOf = (attachmentUid: string) => rowsOf<{ target_uid: string }>('SELECT target_uid FROM attachments WHERE uid = ?', [attachmentUid])[0]?.target_uid ?? null;

  const tasks: MaterialTaskInput[] = uids.map((uid) => {
    const f = taskFootprint(uid);
    const brief = rowsOf<{ value: string }>(
      `SELECT a.value FROM attachments a WHERE a.target_uid = ? AND a.role IS NOT NULL
       UNION SELECT a.value FROM attachments a JOIN plan_items pg ON pg.uid = a.target_uid
        WHERE a.role = 'material' AND pg.kind = 'object' AND pg.plan_uid = (SELECT plan_uid FROM plan_items WHERE uid = ?)`,
      [uid, uid],
    ).map((r) => r.value);
    return {
      id: taskWorkstreamId(uid),
      title: titleOf(uid),
      brief,
      reads: f.read.map((m) => {
        const owner = ownerOf(m.attachmentUid) ?? uid;
        return { path: m.path, sha256: m.lastSha256, owner: taskWorkstreamId(owner), ownerTitle: titleOf(owner) };
      }),
      outputs: f.outputs.map((o) => o.path),
      cited: f.cited.map((c) => ({ path: c.path, part: partWords(c.locator), sha256: c.sha256AtCite, signedOff: c.signedOff })),
    };
  });

  // Each material's hash now: of the attachment of it whose file was seen most recently.
  const current: Record<string, string | null> = {};
  const paths = new Set(tasks.flatMap((t) => [...t.reads.map((r) => r.path), ...t.cited.map((c) => c.path)]));
  for (const p of paths) {
    current[p] = rowsOf<{ sha256: string | null }>(
      `SELECT a.sha256 FROM attachments a WHERE a.value = ? AND a.role IS NOT NULL AND a.target_uid IN (${inProject})
        ORDER BY COALESCE(a.mtime, 0) DESC, a.created_at DESC LIMIT 1`,
      [p, projectRoot, trimmed],
    )[0]?.sha256 ?? null;
  }
  return { tasks, current };
}
