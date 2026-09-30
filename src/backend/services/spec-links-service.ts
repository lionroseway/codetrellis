/**
 * Phase 32 B7.1 — what a task relies on, and who relies on a page.
 *
 * A task (an Action) names the spec pages it relies on, each whole or one
 * section of it, a markdown heading addressed by its slug
 * (`shared/lib/spec-sections.ts`). Asked the other way, a page lists every
 * task relying on it, in any plan of its project: that is who a change to
 * it affects (B7.2). A link to a section counts for that section; a link to
 * the whole page counts for every section.
 *
 * A heading renamed or removed after the link was made leaves the link in
 * place and says so (`sectionMissing`); nothing is dropped silently.
 */
import { getDb } from './database';
import { markDirty } from './persistence';
import { getItem } from './plan-item-service';
import { findSection } from '../../shared/lib/spec-sections';
import type { PlanItem } from '../../shared/types';

export interface SpecRef {
  /** The page's uid. */
  page: string;
  /** A heading's slug on that page; omitted or '' for the whole page. */
  section?: string;
}

export interface RelianceOut {
  pageUid: string;
  pageTitle: string;
  planUid: string;
  planTitle: string;
  /** '' for the whole page. */
  section: string;
  /** The heading's text, when the section is still on the page. */
  sectionTitle: string | null;
  /** The heading this link names is no longer on the page. */
  sectionMissing: boolean;
}

export interface RelianceIn {
  itemUid: string;
  title: string;
  status: string | null;
  assignee: string | null;
  planUid: string;
  planTitle: string;
  /** '' when the task relies on the whole page. */
  section: string;
  /** The heading's text when that section is still on the page. */
  sectionTitle: string | null;
}

const rows = (sql: string, params: unknown[] = []): unknown[][] => getDb().exec(sql, params)[0]?.values ?? [];

const planTitle = (planUid: string): string =>
  (rows('SELECT title FROM plans WHERE uid = ?', [planUid])[0]?.[0] as string | undefined) ?? '';

const planProject = (planUid: string): string | null =>
  (rows('SELECT project_path FROM plans WHERE uid = ?', [planUid])[0]?.[0] as string | undefined) ?? null;

/** Why a list of references cannot be kept, in a sentence; null when it can. */
export function specRefProblem(itemUid: string | null, refs: SpecRef[], lookup: (uid: string) => PlanItem | null = getItem): string | null {
  for (const ref of refs) {
    const page = lookup(ref.page);
    if (!page) return `No page ${ref.page}: a task can only rely on a page that exists.`;
    if (page.kind !== 'object') return `"${page.title}" is a task, not a page: a task relies on pages (dependencies are for tasks).`;
    if (itemUid && page.uid === itemUid) return 'An item cannot rely on itself.';
    const section = ref.section ?? '';
    if (section && !findSection(page.body ?? '', section)) {
      return `"${page.title}" has no heading "${section}". Sections are addressed by their heading's slug, such as "fields" for "## Fields".`;
    }
  }
  return null;
}

/** Replace what a task relies on. Checked by `specRefProblem` first. */
export function setReliesOn(itemUid: string, refs: SpecRef[], by: { author: string; authorType: string }): void {
  const db = getDb();
  const now = Date.now();
  db.run('DELETE FROM spec_links WHERE item_uid = ?', [itemUid]);
  const seen = new Set<string>();
  for (const ref of refs) {
    const key = `${ref.page}\0${ref.section ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    db.run(
      'INSERT INTO spec_links (item_uid, page_uid, section, author, author_type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [itemUid, ref.page, ref.section ?? '', by.author, by.authorType, now],
    );
  }
  markDirty();
}

/** The pages (and sections) a task relies on. A page deleted since is left out. */
export function reliesOn(itemUid: string): RelianceOut[] {
  return rows('SELECT page_uid, section FROM spec_links WHERE item_uid = ? ORDER BY created_at, page_uid, section', [itemUid])
    .flatMap((r) => {
      const page = getItem(r[0] as string);
      if (!page) return [];
      const section = r[1] as string;
      const heading = section ? findSection(page.body ?? '', section) : undefined;
      return [{
        pageUid: page.uid,
        pageTitle: page.title,
        planUid: page.planUid,
        planTitle: planTitle(page.planUid),
        section,
        sectionTitle: heading?.title ?? null,
        sectionMissing: !!section && !heading,
      }];
    });
}

/**
 * Every task relying on a page, or on one section of it, in any plan of the
 * page's project. A task relying on the whole page counts for every section.
 */
export function reliedOnBy(pageUid: string, section?: string): RelianceIn[] {
  const page = getItem(pageUid);
  if (!page) return [];
  const project = planProject(page.planUid);
  const params: unknown[] = [pageUid];
  let where = 'l.page_uid = ?';
  if (section) { where += " AND (l.section = '' OR l.section = ?)"; params.push(section); }
  if (project) { where += ' AND p.project_path = ?'; params.push(project); }
  return rows(
    `SELECT i.uid, i.title, i.status, i.assignee, i.plan_uid, p.title, l.section
     FROM spec_links l JOIN plan_items i ON i.uid = l.item_uid JOIN plans p ON p.uid = i.plan_uid
     WHERE ${where} ORDER BY p.title, i.sort_order, i.title`,
    params,
  ).map((r) => ({
    itemUid: r[0] as string,
    title: r[1] as string,
    status: (r[2] as string | null) ?? null,
    assignee: (r[3] as string | null) ?? null,
    planUid: r[4] as string,
    planTitle: r[5] as string,
    section: r[6] as string,
    sectionTitle: r[6] ? findSection(page.body ?? '', r[6] as string)?.title ?? null : null,
  }));
}

/** "Relied on by 3 tasks in 2 plans". */
export function reliedOnWords(rel: RelianceIn[]): string | null {
  if (rel.length === 0) return null;
  const tasks = new Set(rel.map((r) => r.itemUid)).size;
  const plans = new Set(rel.map((r) => r.planUid)).size;
  return `Relied on by ${tasks} ${tasks === 1 ? 'task' : 'tasks'} in ${plans} ${plans === 1 ? 'plan' : 'plans'}`;
}
