/**
 * System documentation service — CDev Phase 3.4.
 *
 * Repo-wide knowledge layer. Each doc is a single markdown file at
 * `<project>/.codetrellis/docs/<slug>.md` with YAML frontmatter; the
 * DB serves as an index for list / search. The on-disk file is the
 * source of truth — pulling new docs in via git appears in the index
 * through the watcher.
 *
 * Freshness contract:
 *   - Every doc may stamp `capturedAgainstCommit` = current HEAD when
 *     the user / agent says "this doc accurately describes the code
 *     as of now". `verifySystemDoc` re-stamps to HEAD.
 *   - `getFreshness` compares the captured SHA to current HEAD:
 *       · same SHA → 'current'
 *       · HEAD moved but no referenced file diffs → 'moved' (yellow)
 *       · HEAD moved AND a referenced file diffs → 'stale' (red)
 *   - Docs without a captured SHA report 'current' — they've never
 *     been verified so we can't claim drift. The UI surfaces this
 *     state with a separate "unverified" affordance.
 */

// [codemod] hoisted lazy requires → static namespace imports for bundling
import * as _lazy____server from '../server';
import { writeFileWithin, resolveWithin, ConfinementError } from './confined-fs';

/**
 * Slugs become filenames, so they are constrained to what is safe as one.
 *
 * Phase 19, finding 8. `slug` is caller-supplied (`input.slug ?? slugify(title)`)
 * and was interpolated straight into `<project>/<docs-dir>/<slug>.md`, so
 * `../../evil` wrote outside the docs directory — and outside the project.
 *
 * No dots at all: a slug never legitimately contains one, and excluding them
 * removes `..` without having to reason about where it can appear.
 */
const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,127}$/i;

function assertSafeSlug(slug: unknown): string {
  if (typeof slug !== 'string' || !SAFE_SLUG.test(slug)) {
    throw new ConfinementError(
      `Invalid system-doc slug "${String(slug).slice(0, 64)}" — ` +
        'slugs may contain only letters, digits and hyphens.',
    );
  }
  return slug;
}
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import chokidar, { type FSWatcher } from 'chokidar';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { getDb } from './database';
import { markDirty } from './persistence';
import { stampSelfWrite, wasJustWrittenByUs } from './self-write-tracker';
import type { SystemDoc, SystemDocReferences, SystemDocFreshness, SystemDocFreshnessReport } from '../../shared/types';

// ---------- Public surface ----------

export interface CreateSystemDocInput {
  projectPath: string;
  title: string;
  body?: string;
  owner?: string | null;
  tags?: string[];
  references?: SystemDocReferences;
  author?: string;
  authorType?: string;
  /** Caller-supplied slug; defaults to slugify(title). UID suffix added on clash. */
  slug?: string;
}

export interface UpdateSystemDocInput {
  title?: string;
  body?: string;
  owner?: string | null;
  tags?: string[];
  references?: SystemDocReferences;
  author?: string;
  authorType?: string;
}

export interface SystemDocSummary {
  uid: string;
  slug: string;
  title: string;
  owner: string | null;
  tags: string[];
  updatedAt: number;
  lastVerifiedAt: number | null;
  capturedAgainstCommit: string | null;
}

const SYSTEM_DOCS_DIR_SEGMENT = '.codetrellis/docs';

/**
 * List every system doc for a project. Returns summaries (no body)
 * so the list view stays cheap on plans with many docs.
 */
export function listSystemDocs(projectPath: string): SystemDocSummary[] {
  const db = getDb();
  const result = db.exec(
    `SELECT uid, slug, title, owner, tags, updated_at, last_verified_at, captured_against_commit
       FROM system_docs WHERE project_path = ? ORDER BY updated_at DESC`,
    [normalisePath(projectPath)],
  );
  if (!result[0]) return [];
  return result[0].values.map((r: any[]) => ({
    uid: r[0] as string,
    slug: r[1] as string,
    title: r[2] as string,
    owner: (r[3] as string | null) ?? null,
    tags: safeParseJsonArray(r[4] as string | null),
    updatedAt: r[5] as number,
    lastVerifiedAt: (r[6] as number | null) ?? null,
    capturedAgainstCommit: (r[7] as string | null) ?? null,
  }));
}

/**
 * Search docs by case-insensitive substring match across title +
 * body. Returns summaries (same shape as `listSystemDocs`). Scoped
 * to a project.
 */
export function searchSystemDocs(projectPath: string, query: string): SystemDocSummary[] {
  if (!query.trim()) return listSystemDocs(projectPath);
  const db = getDb();
  const like = `%${query.toLowerCase()}%`;
  const result = db.exec(
    `SELECT uid, slug, title, owner, tags, updated_at, last_verified_at, captured_against_commit
       FROM system_docs
       WHERE project_path = ?
         AND (LOWER(title) LIKE ? OR LOWER(body) LIKE ?)
       ORDER BY updated_at DESC`,
    [normalisePath(projectPath), like, like],
  );
  if (!result[0]) return [];
  return result[0].values.map((r: any[]) => ({
    uid: r[0] as string,
    slug: r[1] as string,
    title: r[2] as string,
    owner: (r[3] as string | null) ?? null,
    tags: safeParseJsonArray(r[4] as string | null),
    updatedAt: r[5] as number,
    lastVerifiedAt: (r[6] as number | null) ?? null,
    capturedAgainstCommit: (r[7] as string | null) ?? null,
  }));
}

/** Fetch a doc by uid. Returns null when not found. */
export function getSystemDoc(uid: string): SystemDoc | null {
  const db = getDb();
  const result = db.exec(`SELECT ${ALL_COLUMNS} FROM system_docs WHERE uid = ?`, [uid]);
  if (!result[0]?.values[0]) return null;
  return rowToDoc(result[0].values[0] as any[]);
}

/** Fetch by (projectPath, slug). Helpful for resolving inline links. */
export function getSystemDocBySlug(projectPath: string, slug: string): SystemDoc | null {
  const db = getDb();
  const result = db.exec(
    `SELECT ${ALL_COLUMNS} FROM system_docs WHERE project_path = ? AND slug = ?`,
    [normalisePath(projectPath), slug],
  );
  if (!result[0]?.values[0]) return null;
  return rowToDoc(result[0].values[0] as any[]);
}

/**
 * Create a doc in the DB AND write the corresponding markdown file
 * with YAML frontmatter to disk. The on-disk file is the source of
 * truth; we just persist an index entry for listing / search.
 */
export function createSystemDoc(input: CreateSystemDocInput): SystemDoc {
  const projectPath = normalisePath(input.projectPath);
  const uid = randomUUID();
  const now = Date.now();
  const author = input.author ?? 'human';
  const authorType = input.authorType ?? 'human';
  const body = input.body ?? '';
  const tags = input.tags ?? [];
  const references = input.references ?? {};
  const owner = input.owner ?? null;

  // Slug: caller-supplied wins, else slugify the title. Append a
  // short uid suffix only when there's a clash so the filename stays
  // human-readable in the common case.
  let slug = assertSafeSlug((input.slug ?? slugify(input.title)) || 'doc');
  if (getSystemDocBySlug(projectPath, slug)) {
    slug = `${slug}-${uid.split('-')[0]}`;
  }

  const db = getDb();
  db.run(
    `INSERT INTO system_docs (uid, project_path, slug, title, body, owner, tags, "references",
                              captured_against_commit, last_verified_at,
                              author, author_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
    [uid, projectPath, slug, input.title, body, owner,
     JSON.stringify(tags), JSON.stringify(references),
     author, authorType, now, now],
  );

  const doc: SystemDoc = {
    uid, projectPath, slug, title: input.title, body, owner, tags, references,
    capturedAgainstCommit: null, lastVerifiedAt: null,
    author, authorType, createdAt: now, updatedAt: now,
  };

  writeDocFile(doc);

  markDirty();
  return doc;
}

/**
 * Update a doc by uid. The on-disk file is rewritten to match. If
 * the title changed, the filename is renamed to match the new slug.
 * Bumps `updated_at` but does NOT touch `capturedAgainstCommit` —
 * editing the body invalidates the freshness stamp; the user / agent
 * calls `verifySystemDoc` to re-stamp.
 */
export function updateSystemDoc(uid: string, updates: UpdateSystemDocInput): SystemDoc | null {
  const existing = getSystemDoc(uid);
  if (!existing) return null;

  const now = Date.now();
  const title = updates.title ?? existing.title;
  const body = updates.body ?? existing.body;
  const owner = updates.owner !== undefined ? updates.owner : existing.owner;
  const tags = updates.tags ?? existing.tags;
  const references = updates.references ?? existing.references;
  const author = updates.author ?? existing.author;
  const authorType = updates.authorType ?? existing.authorType;

  // Re-slug only on title change. Preserves the user's filename
  // when they fix a typo in the body.
  let slug = existing.slug;
  if (updates.title && updates.title !== existing.title) {
    const candidate = slugify(updates.title) || 'doc';
    if (candidate !== slug) {
      const clash = getSystemDocBySlug(existing.projectPath, candidate);
      slug = clash && clash.uid !== uid ? `${candidate}-${uid.split('-')[0]}` : candidate;
    }
  }

  const db = getDb();
  db.run(
    `UPDATE system_docs SET slug = ?, title = ?, body = ?, owner = ?, tags = ?, "references" = ?,
                            author = ?, author_type = ?, updated_at = ?
     WHERE uid = ?`,
    [slug, title, body, owner, JSON.stringify(tags), JSON.stringify(references),
     author, authorType, now, uid],
  );

  // Filename change — remove the old file before writing the new one.
  if (slug !== existing.slug) {
    const oldPath = path.join(existing.projectPath, SYSTEM_DOCS_DIR_SEGMENT, `${existing.slug}.md`);
    try { if (fs.existsSync(oldPath)) { stampSelfWrite(oldPath); fs.unlinkSync(oldPath); } } catch { /* best-effort */ }
  }

  const updated: SystemDoc = {
    ...existing,
    slug, title, body, owner, tags, references, author, authorType,
    updatedAt: now,
  };

  writeDocFile(updated);
  markDirty();
  return updated;
}

/**
 * Delete a doc and its on-disk file. No-op when the uid is unknown.
 * Returns true iff a DB row was removed.
 */
export function deleteSystemDoc(uid: string): boolean {
  const existing = getSystemDoc(uid);
  if (!existing) return false;
  const db = getDb();
  db.run(`DELETE FROM system_docs WHERE uid = ?`, [uid]);

  const filePath = path.join(existing.projectPath, SYSTEM_DOCS_DIR_SEGMENT, `${existing.slug}.md`);
  try {
    if (fs.existsSync(filePath)) {
      stampSelfWrite(filePath);
      fs.unlinkSync(filePath);
    }
  } catch { /* best-effort */ }

  markDirty();
  return true;
}

/**
 * Re-stamp a doc as "verified against the current HEAD". Reads git
 * HEAD via execFileSync (no shell). Returns the updated doc, or
 * null when the project isn't a git repo (in which case we can't
 * stamp anything meaningful).
 */
export function verifySystemDoc(uid: string): SystemDoc | null {
  const existing = getSystemDoc(uid);
  if (!existing) return null;
  const head = gitHeadSha(existing.projectPath);
  if (!head) {
    // Not a git repo — nothing to stamp against. Return existing
    // unchanged so the caller can surface a "not in git" affordance.
    return existing;
  }

  const now = Date.now();
  const db = getDb();
  db.run(
    `UPDATE system_docs SET captured_against_commit = ?, last_verified_at = ?, updated_at = ?
     WHERE uid = ?`,
    [head, now, now, uid],
  );

  const updated: SystemDoc = {
    ...existing,
    capturedAgainstCommit: head,
    lastVerifiedAt: now,
    updatedAt: now,
  };

  // Re-write the file so the frontmatter reflects the new stamp.
  writeDocFile(updated);
  markDirty();
  return updated;
}

/**
 * Compute the freshness verdict for a doc by comparing its captured
 * commit to current HEAD and (when they differ) listing the
 * referenced files that actually diff. Pure read — does not mutate.
 *
 * Returns null when the doc doesn't exist.
 */
export function getFreshness(uid: string): SystemDocFreshnessReport | null {
  const doc = getSystemDoc(uid);
  if (!doc) return null;

  const currentCommit = gitHeadSha(doc.projectPath);
  const capturedCommit = doc.capturedAgainstCommit;

  // Unstamped → we can't claim drift. Surface as 'current' so the
  // UI shows green; a separate "unverified" affordance is the
  // frontend's job.
  if (!capturedCommit) {
    return {
      uid,
      status: 'current',
      currentCommit,
      capturedCommit: null,
      changedReferencedFiles: [],
    };
  }
  if (!currentCommit || currentCommit === capturedCommit) {
    return {
      uid,
      status: 'current',
      currentCommit,
      capturedCommit,
      changedReferencedFiles: [],
    };
  }

  // HEAD has moved. Are any referenced files in the diff?
  const refFiles = doc.references.files ?? [];
  if (refFiles.length === 0) {
    return {
      uid,
      status: 'moved',
      currentCommit,
      capturedCommit,
      changedReferencedFiles: [],
    };
  }
  const changed = gitChangedFiles(doc.projectPath, capturedCommit, currentCommit);
  const changedSet = new Set(changed);
  const intersect = refFiles.filter((f) => changedSet.has(normaliseRelPath(f)));

  const status: SystemDocFreshness = intersect.length > 0 ? 'stale' : 'moved';
  return {
    uid,
    status,
    currentCommit,
    capturedCommit,
    changedReferencedFiles: intersect,
  };
}

/**
 * Find system docs for a project whose `references.files` array
 * contains a given relative path. Used by the doc sensor (Phase 4.3)
 * to check freshness when a referenced file changes.
 *
 * Uses a JSON string LIKE match — not 100% precise (a path that's a
 * substring of another could false-match), but fast and sufficient for
 * the sensor's needs.
 */
export function findDocsByReferencedFile(projectPath: string, relativePath: string): Array<{ uid: string; slug: string; title: string; plans: string[] }> {
  const db = getDb();
  const normalised = normalisePath(projectPath);
  // JSON-encode the path so we match the escaped form inside the array.
  const jsonPath = JSON.stringify(relativePath);
  // Strip the outer quotes for the LIKE pattern: we want to match
  // "references" JSON containing the path string.
  const likePattern = `%${jsonPath}%`;
  const result = db.exec(
    `SELECT uid, slug, title, "references"
       FROM system_docs
       WHERE project_path = ? AND "references" LIKE ?`,
    [normalised, likePattern],
  );
  if (!result[0]) return [];
  return result[0].values.map((r: any[]) => {
    const refs = safeParseJsonObject(r[3] as string | null) as SystemDocReferences;
    return {
      uid: r[0] as string,
      slug: r[1] as string,
      title: r[2] as string,
      plans: refs.plans ?? [],
    };
  });
}

/**
 * Check freshness for all docs in a project. Returns reports for docs
 * that are 'stale'. Used by the git-hook REST endpoint (Phase 4.3).
 */
export function checkAllDocsFreshness(projectPath: string): SystemDocFreshnessReport[] {
  const docs = listSystemDocs(projectPath);
  const stale: SystemDocFreshnessReport[] = [];
  for (const doc of docs) {
    const report = getFreshness(doc.uid);
    if (report && report.status === 'stale') {
      stale.push(report);
    }
  }
  return stale;
}

/**
 * Boot-time: scan `.codetrellis/docs/` for any .md files and
 * upsert them into the index. Lets the user `git pull` new docs
 * and have them appear without manual import.
 */
export function indexProjectDocs(projectPath: string): { imported: number; skipped: number; errors: string[] } {
  const dir = path.join(normalisePath(projectPath), SYSTEM_DOCS_DIR_SEGMENT);
  if (!fs.existsSync(dir)) return { imported: 0, skipped: 0, errors: [] };

  const result = { imported: 0, skipped: 0, errors: [] as string[] };
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.md')) continue;
    const fullPath = path.join(dir, entry);
    try {
      const ok = importDocFile(fullPath, projectPath);
      if (ok) result.imported++;
      else result.skipped++;
    } catch (err) {
      result.errors.push(`${entry}: ${err instanceof Error ? err.message : err}`);
    }
  }
  return result;
}

// ---------- File watcher ----------

const watchersByProject = new Map<string, FSWatcher>();

/**
 * Watch `<projectRoot>/.codetrellis/docs/` for external edits.
 * When a user / teammate edits / adds / removes a doc on disk, the
 * index is updated and a `system-doc-changed` event is broadcast.
 */
export function startSystemDocsWatcher(projectRoot: string): void {
  const key = normalisePath(projectRoot);
  if (watchersByProject.has(key)) return;

  const dir = path.join(key, SYSTEM_DOCS_DIR_SEGMENT);
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* best-effort */ }

  const watcher = chokidar.watch(dir, {
    ignoreInitial: true,
    persistent: true,
    depth: 0,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  });

  watcher.on('all', (event, filePath) => {
    if (!filePath || !filePath.endsWith('.md')) return;
    if (event !== 'add' && event !== 'change' && event !== 'unlink') return;
    if (wasJustWrittenByUs(filePath)) return;

    try {
      if (event === 'unlink') {
        // Locate by slug (filename) + project path and drop from DB.
        const slug = path.basename(filePath, '.md');
        const existing = getSystemDocBySlug(key, slug);
        if (existing) {
          getDb().run(`DELETE FROM system_docs WHERE uid = ?`, [existing.uid]);
          markDirty();
          tryBroadcast('system-doc-removed', { uid: existing.uid, slug, projectPath: key });
        }
        return;
      }
      const ok = importDocFile(filePath, key);
      if (ok) {
        tryBroadcast('system-doc-changed', { filePath, projectPath: key, event });
      }
    } catch (err) {
      console.warn('[SystemDocs] Watcher handler failed:', err);
    }
  });

  watcher.on('error', (err) => {
    console.warn('[SystemDocs] Watcher error:', err);
  });

  watchersByProject.set(key, watcher);
}

export async function stopSystemDocsWatcher(projectRoot: string): Promise<void> {
  const key = normalisePath(projectRoot);
  const watcher = watchersByProject.get(key);
  if (!watcher) return;
  watchersByProject.delete(key);
  try { await watcher.close(); } catch { /* ignore */ }
}

// ---------- internals ----------

const ALL_COLUMNS = `uid, project_path, slug, title, body, owner, tags, "references",
        captured_against_commit, last_verified_at,
        author, author_type, created_at, updated_at`;

function rowToDoc(r: any[]): SystemDoc {
  return {
    uid: r[0] as string,
    projectPath: r[1] as string,
    slug: r[2] as string,
    title: r[3] as string,
    body: r[4] as string,
    owner: (r[5] as string | null) ?? null,
    tags: safeParseJsonArray(r[6] as string | null),
    references: safeParseJsonObject(r[7] as string | null),
    capturedAgainstCommit: (r[8] as string | null) ?? null,
    lastVerifiedAt: (r[9] as number | null) ?? null,
    author: r[10] as string,
    authorType: r[11] as string,
    createdAt: r[12] as number,
    updatedAt: r[13] as number,
  };
}

function writeDocFile(doc: SystemDoc): void {
  const dir = path.join(doc.projectPath, SYSTEM_DOCS_DIR_SEGMENT);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${doc.slug}.md`);
  const frontmatter = {
    uid: doc.uid,
    title: doc.title,
    owner: doc.owner ?? null,
    tags: doc.tags,
    references: doc.references,
    capturedAgainstCommit: doc.capturedAgainstCommit ?? null,
    lastVerifiedAt: doc.lastVerifiedAt ? new Date(doc.lastVerifiedAt).toISOString() : null,
    author: doc.author,
    authorType: doc.authorType,
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
  };
  const out = `---\n${stringifyYaml(frontmatter)}---\n\n${doc.body}`;
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, out, 'utf-8');
  fs.renameSync(tmp, filePath);
  stampSelfWrite(filePath);
}

/**
 * Read a `.md` file with YAML frontmatter and upsert it into the
 * index. Returns true when the row was inserted / updated, false
 * when the file was missing required frontmatter and was skipped.
 */
function importDocFile(filePath: string, projectPath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const raw = fs.readFileSync(filePath, 'utf-8');
  const { meta, body, hasFrontmatter, parseError } = parseFrontMatter(raw);

  // CDev Phase 3 tester finding #2 — a file with frontmatter
  // delimiters but a malformed YAML block (broken syntax, unclosed
  // brackets, etc.) used to be silently treated as "no frontmatter"
  // and auto-stamped. That destroyed the user's intended title /
  // tags / references on the next watcher write-back. Skip the file
  // with a warning instead; the user fixes the YAML and the watcher
  // imports cleanly on the next change.
  if (hasFrontmatter && parseError) {
    console.warn(
      `[SystemDocs] Skipping ${filePath} — malformed YAML frontmatter (${parseError}). ` +
      'Fix the syntax and save again; no changes were applied to the index.',
    );
    return false;
  }

  // Frontmatter MUST carry a uid + title — without those, we can't
  // safely upsert (renames + edits would lose the row's identity).
  // Files that lack a uid are auto-stamped on read: we mint one,
  // rewrite the file, and treat it as a brand-new doc.
  let uid = typeof meta.uid === 'string' ? meta.uid : null;
  const title = typeof meta.title === 'string' && meta.title.trim()
    ? meta.title.trim()
    : path.basename(filePath, '.md').replace(/[-_]+/g, ' ');

  const projPath = normalisePath(projectPath);
  const slug = path.basename(filePath, '.md');
  const now = Date.now();

  const stamped = !!uid;
  if (!uid) uid = randomUUID();

  const owner = typeof meta.owner === 'string' ? meta.owner : null;
  const tags = Array.isArray(meta.tags) ? meta.tags.filter((t: unknown): t is string => typeof t === 'string') : [];
  const references = isReferencesObject(meta.references) ? sanitiseReferences(meta.references) : {};
  const capturedAgainstCommit = typeof meta.capturedAgainstCommit === 'string' ? meta.capturedAgainstCommit : null;
  const lastVerifiedAt = parseEpoch(meta.lastVerifiedAt);
  const author = typeof meta.author === 'string' ? meta.author : 'human';
  const authorType = typeof meta.authorType === 'string' ? meta.authorType : 'human';
  const createdAt = parseEpoch(meta.createdAt) ?? now;

  const db = getDb();
  const exists = db.exec(`SELECT uid FROM system_docs WHERE uid = ?`, [uid]);
  if (exists[0]?.values[0]) {
    db.run(
      `UPDATE system_docs SET project_path = ?, slug = ?, title = ?, body = ?, owner = ?,
                              tags = ?, "references" = ?, captured_against_commit = ?,
                              last_verified_at = ?, author = ?, author_type = ?, updated_at = ?
       WHERE uid = ?`,
      [projPath, slug, title, body, owner, JSON.stringify(tags), JSON.stringify(references),
       capturedAgainstCommit, lastVerifiedAt, author, authorType, now, uid],
    );
  } else {
    db.run(
      `INSERT INTO system_docs (uid, project_path, slug, title, body, owner, tags, "references",
                                captured_against_commit, last_verified_at,
                                author, author_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uid, projPath, slug, title, body, owner, JSON.stringify(tags), JSON.stringify(references),
       capturedAgainstCommit, lastVerifiedAt, author, authorType, createdAt, now],
    );
  }

  // If we minted a uid for an unstamped file, rewrite it with the
  // frontmatter so the next read is stable. We rewrite even when
  // the user provided no uid because the missing fields default
  // back to sensible values that should round-trip.
  if (!stamped) {
    const doc: SystemDoc = {
      uid, projectPath: projPath, slug, title, body, owner, tags, references,
      capturedAgainstCommit, lastVerifiedAt, author, authorType,
      createdAt, updatedAt: now,
    };
    writeDocFile(doc);
  }

  markDirty();
  return true;
}

function parseFrontMatter(source: string): {
  meta: any;
  body: string;
  /** True iff the file starts with a `---` frontmatter delimiter. */
  hasFrontmatter: boolean;
  /** Set to the YAML error message when the frontmatter block is
   *  present but its YAML doesn't parse. Callers should treat this
   *  as "skip + warn" rather than silently coercing to no-frontmatter. */
  parseError: string | null;
} {
  if (!source.startsWith('---')) {
    return { meta: {}, body: source, hasFrontmatter: false, parseError: null };
  }
  const end = source.indexOf('\n---', 3);
  if (end < 0) {
    // Frontmatter opened but never closed — treat as a parse error so
    // we don't accidentally interpret the entire file body as YAML.
    return { meta: {}, body: source, hasFrontmatter: true, parseError: 'missing closing ---' };
  }
  const yamlBlock = source.slice(3, end).replace(/^\n/, '');
  const body = source.slice(end + 4).replace(/^\n+/, '');
  let meta: any = {};
  let parseError: string | null = null;
  try {
    meta = parseYaml(yamlBlock) ?? {};
  } catch (err) {
    parseError = err instanceof Error ? err.message : String(err);
    meta = {};
  }
  return { meta, body, hasFrontmatter: true, parseError };
}

function isReferencesObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function sanitiseReferences(r: Record<string, unknown>): SystemDocReferences {
  const out: SystemDocReferences = {};
  const stringArray = (v: unknown): string[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    const arr = v.filter((x): x is string => typeof x === 'string');
    return arr.length ? arr : undefined;
  };
  const files = stringArray(r.files); if (files) out.files = files;
  const symbols = stringArray(r.symbols); if (symbols) out.symbols = symbols;
  const items = stringArray(r.items); if (items) out.items = items;
  const plans = stringArray(r.plans); if (plans) out.plans = plans;
  const urls = stringArray(r.urls); if (urls) out.urls = urls;
  return out;
}

function parseEpoch(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function safeParseJsonArray(s: string | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

function safeParseJsonObject(s: string | null): SystemDocReferences {
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return isReferencesObject(v) ? sanitiseReferences(v) : {};
  } catch { return {}; }
}

function normalisePath(p: string): string {
  return path.resolve(p).replace(/[/\\]+$/, '');
}

function normaliseRelPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function gitHeadSha(projectPath: string): string | null {
  try {
    if (!fs.existsSync(path.join(projectPath, '.git'))) return null;
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch { return null; }
}

function gitChangedFiles(projectPath: string, fromSha: string, toSha: string): string[] {
  try {
    const out = execFileSync('git', ['diff', '--name-only', `${fromSha}..${toSha}`], {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\n').map((s) => s.trim()).filter(Boolean).map(normaliseRelPath);
  } catch { return []; }
}

function tryBroadcast(type: string, payload: Record<string, unknown>): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { broadcast } = _lazy____server;
    broadcast(type, payload);
  } catch { /* server not yet imported (test isolation) */ }
}
