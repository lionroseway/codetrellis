import { randomUUID } from 'node:crypto';
import { getDb } from './database';
import { markDirty } from './persistence';
import type { PlanDocument, PlanDocumentVersion } from '../../shared/types';

export interface CreatePlanDocInput {
  planUid: string;
  docType: string;
  title: string;
  body: string;
  author: string;
  authorType?: string;
}

export interface UpdatePlanDocInput {
  title?: string;
  body?: string;
  docType?: string;
  changeSummary?: string;
  author?: string;
}

export function createPlanDocument(input: CreatePlanDocInput): PlanDocument {
  const db = getDb();
  const uid = randomUUID();
  const now = Date.now();
  const authorType = input.authorType ?? 'human';

  db.run(
    `INSERT INTO plan_documents (uid, plan_uid, doc_type, title, body, version, author, author_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    [uid, input.planUid, input.docType, input.title, input.body, input.author, authorType, now, now]
  );

  db.run(
    `INSERT INTO plan_document_versions (doc_uid, version, body, change_summary, author, created_at)
     VALUES (?, 1, ?, 'Created', ?, ?)`,
    [uid, input.body, input.author, now]
  );

  markDirty();

  return {
    uid,
    planUid: input.planUid,
    docType: input.docType,
    title: input.title,
    body: input.body,
    version: 1,
    author: input.author,
    authorType,
    createdAt: now,
    updatedAt: now,
  };
}

export function getPlanDocument(docUid: string): PlanDocument | null {
  const result = getDb().exec(
    `SELECT uid, plan_uid, doc_type, title, body, version, author, author_type, created_at, updated_at
     FROM plan_documents WHERE uid = ?`,
    [docUid]
  );
  if (!result[0]?.values[0]) return null;
  return rowToDoc(result[0].values[0]);
}

/**
 * Get the most recently updated doc of a given type for a plan. Most plans
 * will have one doc per type; if not, the freshest wins.
 */
export function getPlanDocumentByType(planUid: string, docType: string): PlanDocument | null {
  const result = getDb().exec(
    `SELECT uid, plan_uid, doc_type, title, body, version, author, author_type, created_at, updated_at
     FROM plan_documents WHERE plan_uid = ? AND doc_type = ?
     ORDER BY updated_at DESC LIMIT 1`,
    [planUid, docType]
  );
  if (!result[0]?.values[0]) return null;
  return rowToDoc(result[0].values[0]);
}

export function listPlanDocuments(planUid: string): PlanDocument[] {
  const result = getDb().exec(
    `SELECT uid, plan_uid, doc_type, title, body, version, author, author_type, created_at, updated_at
     FROM plan_documents WHERE plan_uid = ?
     ORDER BY doc_type, updated_at DESC`,
    [planUid]
  );
  if (!result[0]) return [];
  return result[0].values.map(rowToDoc);
}

/**
 * Lightweight index for agents — title, type, length, no body content.
 * Saves tokens when an agent is just browsing what's available.
 */
export function listPlanDocumentSummaries(planUid: string): Array<{
  uid: string;
  docType: string;
  title: string;
  version: number;
  bodyLength: number;
  updatedAt: number;
}> {
  const result = getDb().exec(
    `SELECT uid, doc_type, title, version, length(body), updated_at
     FROM plan_documents WHERE plan_uid = ?
     ORDER BY doc_type, updated_at DESC`,
    [planUid]
  );
  if (!result[0]) return [];
  return result[0].values.map((r: any[]) => ({
    uid: r[0] as string,
    docType: r[1] as string,
    title: r[2] as string,
    version: r[3] as number,
    bodyLength: (r[4] as number) || 0,
    updatedAt: r[5] as number,
  }));
}

export function updatePlanDocument(docUid: string, updates: UpdatePlanDocInput): PlanDocument | null {
  const db = getDb();
  const existing = getPlanDocument(docUid);
  if (!existing) return null;

  const now = Date.now();
  const sets: string[] = ['updated_at = ?'];
  const params: any[] = [now];
  const bodyChanged = updates.body !== undefined && updates.body !== existing.body;

  if (updates.title !== undefined) { sets.push('title = ?'); params.push(updates.title); }
  if (updates.docType !== undefined) { sets.push('doc_type = ?'); params.push(updates.docType); }
  if (bodyChanged) {
    sets.push('body = ?');
    params.push(updates.body);
    sets.push('version = version + 1');
  }

  params.push(docUid);
  db.run(`UPDATE plan_documents SET ${sets.join(', ')} WHERE uid = ?`, params);

  if (bodyChanged) {
    const author = updates.author ?? existing.author;
    db.run(
      `INSERT INTO plan_document_versions (doc_uid, version, body, change_summary, author, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [docUid, existing.version + 1, updates.body, updates.changeSummary ?? 'Updated', author, now]
    );
  }

  markDirty();
  return getPlanDocument(docUid);
}

export function deletePlanDocument(docUid: string): void {
  const db = getDb();
  db.run(`DELETE FROM plan_document_versions WHERE doc_uid = ?`, [docUid]);
  db.run(`DELETE FROM plan_documents WHERE uid = ?`, [docUid]);
  markDirty();
}

/**
 * Substring search across title and body. Returns matches with a short
 * excerpt around the first match so an agent can decide whether to fetch
 * the full body.
 */
export function searchPlanDocuments(planUid: string, query: string): Array<{
  doc: PlanDocument;
  excerpt: string;
}> {
  if (!query.trim()) return [];
  const result = getDb().exec(
    `SELECT uid, plan_uid, doc_type, title, body, version, author, author_type, created_at, updated_at
     FROM plan_documents
     WHERE plan_uid = ? AND (title LIKE ? OR body LIKE ?)
     ORDER BY updated_at DESC LIMIT 25`,
    [planUid, `%${query}%`, `%${query}%`]
  );
  if (!result[0]) return [];
  return result[0].values.map((r: any[]) => {
    const doc = rowToDoc(r);
    return { doc, excerpt: makeExcerpt(doc.body, query) };
  });
}

export function getPlanDocumentVersions(docUid: string): PlanDocumentVersion[] {
  const result = getDb().exec(
    `SELECT id, doc_uid, version, body, change_summary, author, created_at
     FROM plan_document_versions WHERE doc_uid = ?
     ORDER BY version DESC`,
    [docUid]
  );
  if (!result[0]) return [];
  return result[0].values.map((r: any[]) => ({
    id: r[0] as number,
    docUid: r[1] as string,
    version: r[2] as number,
    body: r[3] as string,
    changeSummary: (r[4] as string | null) ?? null,
    author: r[5] as string,
    createdAt: r[6] as number,
  }));
}

function rowToDoc(r: any[]): PlanDocument {
  return {
    uid: r[0] as string,
    planUid: r[1] as string,
    docType: r[2] as string,
    title: r[3] as string,
    body: r[4] as string,
    version: r[5] as number,
    author: r[6] as string,
    authorType: r[7] as string,
    createdAt: r[8] as number,
    updatedAt: r[9] as number,
  };
}

function makeExcerpt(body: string, query: string, radius = 80): string {
  if (!body) return '';
  const idx = body.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return body.slice(0, radius * 2) + (body.length > radius * 2 ? '…' : '');
  const start = Math.max(0, idx - radius);
  const end = Math.min(body.length, idx + query.length + radius);
  return (start > 0 ? '…' : '') + body.slice(start, end) + (end < body.length ? '…' : '');
}
