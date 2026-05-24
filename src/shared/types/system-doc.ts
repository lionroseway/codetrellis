/**
 * System documentation — CDev Phase 3.4.
 *
 * A repo-wide knowledge layer. Each doc is a single markdown file at
 * `<project>/.codetrellis/docs/<topic>.md` with YAML frontmatter that
 * captures structured metadata (title, owner, references back into
 * the codebase, the git SHA the doc was last verified against).
 *
 * Unlike plan-scoped specs (which describe *upcoming work*), system
 * docs describe *the system as it currently is*. They sit in
 * `.codetrellis/docs/` so they round-trip through git and can be read
 * directly on GitHub by non-engineering stakeholders without
 * installing CodeTrellis.
 *
 * The DB is an index: list / search are served from SQL, the
 * canonical body lives on disk. Freshness signals come from
 * comparing `capturedAgainstCommit` to the current HEAD plus the
 * list of files in `references.files`.
 */

/**
 * Cross-references from a doc to specific points in the codebase /
 * plan tree. Used by the freshness sensor and the in-app inline link
 * rendering. All fields optional — a doc may reference any subset.
 */
export interface SystemDocReferences {
  /** Project-relative file paths the doc describes. */
  files?: string[];
  /** Fully-qualified symbol names (`module::Class.method`). */
  symbols?: string[];
  /** Plan item UIDs the doc points at (for "this object is here" links). */
  items?: string[];
  /** Plan UIDs whose work materially shaped the doc. */
  plans?: string[];
  /** Free-form URLs (Figma, RFCs, runbooks elsewhere). */
  urls?: string[];
}

export interface SystemDoc {
  /** Stable UUID — survives renames; lives in the frontmatter. */
  uid: string;
  /** Absolute path of the project this doc belongs to. */
  projectPath: string;
  /**
   * Filesystem slug used for the on-disk filename
   * (`.codetrellis/docs/<slug>.md`). Updated on title change with a
   * UID-suffix fallback to avoid clashes.
   */
  slug: string;
  title: string;
  /**
   * Markdown body — the canonical content. The on-disk file is the
   * source of truth; the DB is just a search index.
   */
  body: string;
  /**
   * Free-form ownership label — typically a team name ("payments")
   * or a person ("Alex"). Optional.
   */
  owner: string | null;
  /** Tags help with grouping / filtering in the UI. */
  tags: string[];
  references: SystemDocReferences;
  /**
   * git SHA at which this doc was last verified against the code.
   * Drives the freshness badge — when HEAD has moved past this SHA
   * and any `references.files` actually changed in the diff, the
   * badge goes red.
   */
  capturedAgainstCommit: string | null;
  /** Epoch ms — when the captured commit was stamped. */
  lastVerifiedAt: number | null;
  author: string;
  authorType: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Freshness verdict computed by `verifySystemDoc`. Three buckets:
 *   - 'current' — captured against the live HEAD (or unstamped doc
 *     that's never been verified).
 *   - 'moved'  — HEAD has moved past the captured SHA, but no
 *     referenced file actually changed.
 *   - 'stale'  — HEAD has moved AND at least one referenced file
 *     has been touched since the captured commit.
 */
export type SystemDocFreshness = 'current' | 'moved' | 'stale';

export interface SystemDocFreshnessReport {
  uid: string;
  status: SystemDocFreshness;
  /** Current HEAD SHA at verification time. */
  currentCommit: string | null;
  /** The SHA the doc was captured against. */
  capturedCommit: string | null;
  /**
   * Files (from `references.files`) that have a diff between
   * captured and current. Empty when status !== 'stale'.
   */
  changedReferencedFiles: string[];
}
