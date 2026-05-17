export type PlanStatus = 'draft' | 'review' | 'approved' | 'in_progress' | 'completed' | 'archived';
export type TaskStatus = 'pending' | 'assigned' | 'in_progress' | 'done' | 'blocked' | 'skipped';
export type PhaseStatus = 'pending' | 'in_progress' | 'done' | 'blocked';
export type CommentType = 'comment' | 'suggestion' | 'approval' | 'concern' | 'status_update';
/**
 * Phase 14 §A first-class task-comment kinds. Sit alongside the
 * legacy `CommentType` (`commentType` field) so plans rendered with the
 * old taxonomy keep working — new task chatter prefers `kind`.
 */
export type CommentKind = 'note' | 'blocker' | 'progress' | 'question';
export type CommentSource = 'agent' | 'human';
export type DeviationSeverity = 'info' | 'warning' | 'error';
export type DeviationResolution = 'pending' | 'accepted' | 'reverted' | 'ignored';

export interface Plan {
  uid: string;
  title: string;
  description: string;
  status: PlanStatus;
  author: string;
  authorType: 'human' | string; // agent type for non-human
  projectPath: string;
  createdAt: number;
  updatedAt: number;
  taskCount?: number;
  completedTaskCount?: number;
  /**
   * Phase 15 §15.D — git context for the plan. Captures the user's
   * intent ("we're working off `main` and landing on `feat/auth`")
   * without yet executing any git commands. The Trellis runner /
   * agent integration uses these to scope diffs and decide where to
   * commit.
   *
   *   - `baseRef`           — what we diff against (branch name or
   *                           commit SHA). Usually `main` / `master`.
   *   - `targetBranch`      — where the work lands. May equal
   *                           `baseRef` for "edit in place" plans.
   *   - `targetWorktree`    — optional absolute path of a parallel
   *                           worktree (for multi-agent plans).
   *   - `autoCreateBranch`  — if true and `targetBranch` doesn't
   *                           exist, create it from `baseRef` on
   *                           first agent claim.
   */
  baseRef?: string | null;
  targetBranch?: string | null;
  targetWorktree?: string | null;
  autoCreateBranch?: boolean;
}

export interface SymbolSpec {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'method' | 'enum';
  action: 'add' | 'modify' | 'remove' | 'move';
  /** Project-relative path of the file the symbol lives in. */
  filePath?: string;
  description?: string;
  signature?: string;    // e.g. "signToken(payload: JwtPayload, secret: string): string"
  moveTo?: string;       // target file if action is 'move'
}

/**
 * Phase 14 §A — explicit CRUD intent for a file the task touches.
 * Mirrors the `SymbolSpec` shape so the renderer / drift detector can
 * treat them uniformly.
 *
 * Paths are interpreted relative to the parent `Task.scopePath` if set,
 * otherwise relative to the project root.
 */
export type FileSpecAction = 'create' | 'modify' | 'delete' | 'move';

export interface FileSpec {
  path: string;
  action: FileSpecAction;
  /** For `action === 'move'` — destination path. */
  moveTo?: string;
  /** Marker so the UI can render directories distinctly from files. */
  isDir?: boolean;
  /** Optional human-readable note (why / how this file changes). */
  description?: string;
  /**
   * Phase 15 §M2 — per-file granular edits. Each edit can pin to a
   * `lineRange` or a `symbol`, with a free-form `instruction` that
   * tells the agent what to do at that point. Optional structured
   * `intent` carries CRUD verb when there's clear intent.
   *
   * Empty array (or absent) = "agent decides what to change in this
   * file" — same as today's behaviour with just `path` + `action` +
   * `description`.
   */
  edits?: FileEdit[];
}

/**
 * Phase 15 §M2 — granular intent within a file. An Action's
 * `fileSpecs[].edits[]` carries per-file precision: line ranges,
 * specific symbols, or free-form instructions. Drift attribution
 * walks these to determine "this edit landed; this one didn't."
 */
export interface FileEdit {
  /** Either lineRange OR symbol pins the edit; both null = "anywhere in this file". */
  lineRange?: { start: number; end: number };
  /** AST symbol name (e.g. "validate", "User#login"). Resolved via the symbols table. */
  symbol?: string;
  /** Free-form natural language instruction. */
  instruction: string;
  /** Optional structured CRUD verb when the edit has clear intent. */
  intent?: 'add' | 'modify' | 'remove' | 'replace';
}

/**
 * Phase 14 §A — rich attachments rail. URLs, image refs (paths
 * relative to `<project>/.codetrellis/attachments/<task-uid>/`),
 * inline code blocks, transcripts, or pointers to other files in the
 * project.
 */
export type AttachmentKind = 'url' | 'image' | 'video' | 'file_ref' | 'code_block' | 'transcript';

export interface TaskAttachment {
  uid: string;
  taskUid: string;
  kind: AttachmentKind;
  /**
   * What the attachment carries:
   *   - `url`         → absolute or canonical URL
   *   - `image`       → path relative to the project root (stored under
   *                     `.codetrellis/attachments/<task-uid>/`)
   *   - `file_ref`    → path relative to the project root
   *   - `code_block`  → raw snippet (markdown fence handled by renderer)
   *   - `transcript`  → markdown body of a chat / call transcript
   */
  value: string;
  /** Optional short label shown in the UI rail. */
  label?: string;
  /** MIME hint — useful for image kind. */
  contentType?: string;
  author: string;
  authorType: string;
  createdAt: number;
}

export interface Task {
  uid: string;
  planUid: string;
  sortOrder: number;
  description: string;
  status: TaskStatus;
  assignee: string | null;
  assigneeType: string | null;
  assigneeModel: string | null;
  affectedFiles: string[];
  affectedSymbols: string[];
  newConnections: Array<{ from: string; to: string }>;
  removedConnections: Array<{ from: string; to: string }>;
  dependencies: string[];
  fileSpec?: string;             // Markdown description of what the file should do
  symbolSpecs?: SymbolSpec[];    // Detailed symbol-level changes
  phaseUid: string | null;       // Optional phase grouping (Phase 12 §A)
  /**
   * Phase 14 §A — task-as-context. A task is now "todo + context blob"
   * rather than just a thin todo row.
   */
  parentTaskUid: string | null;       // Subtask parent (one level for v1)
  /** Markdown body — design notes, rationale, agent-readable detail. */
  body?: string;
  /** Markdown ready to paste at an agent — copy-as-prompt fodder. */
  prompt?: string;
  /**
   * Optional folder this task is rooted at (e.g. `src/auth/`). Relative
   * paths in `fileSpecs` resolve from here. Empty / null = project root.
   */
  scopePath?: string | null;
  /** Real CRUD intent on file ops. `affectedFiles` becomes derived view. */
  fileSpecs?: FileSpec[];
  /** URL / image / file-ref / snippet rail. Hydrated by the service layer. */
  attachments?: TaskAttachment[];
  /** 0–100, free-form `update_task_progress` reports. */
  progressPercent?: number | null;
  /** Free-form blocker reason when `status === 'blocked'`. */
  blockedReason?: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * A first-class phase within a plan — matches the swf
 * `01-PHASE-1-FOUNDATION.md / 02-PHASE-2-…` pattern but is DB-backed
 * so agents can claim tasks by phase, the UI can group by phase, and
 * each phase can carry its own scope, prereqs, git checkpoint, and
 * acceptance criteria. Plans without phases keep working unchanged
 * (every task simply has `phaseUid: null`).
 */
export interface PlanPhase {
  uid: string;
  planUid: string;
  phaseNumber: number;
  title: string;
  scope: string;                 // markdown
  prerequisites: string;         // markdown
  gitCheckpoint: string | null;  // commit hash, tag, or label
  acceptanceCriteria: string;    // markdown — ideally a checklist
  status: PhaseStatus;
  createdAt: number;
  updatedAt: number;
}

export interface PlanVersion {
  id: number;
  planUid: string;
  version: number;
  snapshot: string; // JSON blob of full plan + tasks state
  changeSummary: string | null;
  author: string;
  createdAt: number;
}

export interface Comment {
  uid: string;
  /**
   * Phase 15 §C extends this to include `'item'` for the unified
   * `plan_items` surface and `'plan_doc'` for legacy spec-doc
   * comments that pre-date Phase 14. New comments authored against
   * the V2 surface always use `'item'`; the migrator retargets old
   * `'task'` comments to `'item'` (uids preserved).
   */
  targetType: 'plan' | 'task' | 'plan_doc' | 'item';
  targetUid: string;
  parentUid: string | null;
  author: string;
  authorType: 'human' | string;
  body: string;
  commentType: CommentType;
  /**
   * Phase 14 §A first-class kind for task chatter. Sits alongside
   * `commentType` (legacy taxonomy). New tooling reads `kind`; the old
   * `commentType` is preserved so existing UI keeps rendering.
   */
  kind?: CommentKind;
  /** `'agent'` or `'human'`. Inferred when not set explicitly. */
  source?: CommentSource;
  /**
   * Free-form metadata bag. Today: `progressPercent` for `kind: 'progress'`.
   * Future: latency, attachment uids, etc.
   */
  metadata?: Record<string, unknown>;
  createdAt: number;
  replies?: Comment[];
}

export interface AgentSessionInfo {
  sessionId: string;
  agentType: string;
  model: string | null;
  activePlanUid: string | null;
  connectedAt: number;
  lastSeen: number;
  status: 'active' | 'inactive';
  /** Phase 17.N — declared agent capabilities for skill matching. */
  capabilities?: AgentCapability[];
}

// =============================================================================
// Phase 17.N-Q — Skill bindings, Claim restrictions, Execution config
// =============================================================================

/**
 * 17.N — A named capability an agent declares on registration.
 * Used for matching against item skill requirements.
 */
export interface AgentCapability {
  name: string;
  source: 'mcp' | 'skill' | 'lang' | 'plugin';
}

/**
 * 17.N — A required skill on a plan item. When `required` is true,
 * only agents with a matching capability can claim the item.
 */
export interface Skill {
  name: string;
  source: 'mcp' | 'skill' | 'lang' | 'plugin';
  required: boolean;
}

/** Override mode for cascadeable properties (17.P). */
export type CascadeMode = 'inherit' | 'replace' | 'none';

/**
 * 17.O — Controls who can claim/work on a plan item.
 */
export interface ClaimPolicy {
  mode: 'any' | 'agent-only' | 'human-only' | 'assigned' | 'match-skills';
  /** If mode='assigned', the specific agent session or human identity. */
  assignTo?: string | null;
  assignToType?: 'agent' | 'human';
  /** Restrict to specific agent types (e.g. 'claude-code', 'cursor'). */
  allowedAgentTypes?: string[];
  /** Restrict to specific models (e.g. 'claude-opus-4'). */
  allowedModels?: string[];
}

/**
 * 17.Q — Per-item execution configuration. Cascades down the tree
 * so parents can set defaults for all children.
 */
export interface ExecutionConfig {
  model?: string | null;
  reasoningEffort?: 'low' | 'medium' | 'high' | null;
  systemPrompt?: string | null;
  allowedTools?: string[] | null;
  deniedTools?: string[] | null;
  maxTokens?: number | null;
  temperature?: number | null;
}

// =============================================================================
// Phase 17.F — Constraints & Guardrails
// =============================================================================

/**
 * 17.F — Guardrail constraints that limit what an agent may do when
 * working on an item (or any descendant, via cascade). Enforced at
 * claim-time and optionally at runtime by the MCP server.
 */
export interface ItemConstraints {
  /** Glob patterns the agent must NOT modify (e.g. "src/auth/**"). */
  excludePaths?: string[];
  /** Glob patterns the agent must NOT modify — symbols. */
  excludeSymbols?: string[];
  /** If true, agent may NOT change function/method signatures in this scope. */
  lockInterfaces?: boolean;
  /** If true, agent must include tests for any new/changed code. */
  requireTests?: boolean;
  /** If true, agent must run the project's lint/format before completing. */
  requireLint?: boolean;
  /** Max files the agent may touch in a single claim (prevents runaway changes). */
  maxFilesTouched?: number | null;
  /** Max lines changed across all files. */
  maxLinesChanged?: number | null;
  /** Free-form instructions the agent must follow (shown in handoff prompt). */
  customRules?: string[];
}

/**
 * A single granular change a plan promises to make. Aggregated from
 * task fields (`affectedFiles`, `symbolSpecs`, `newConnections`,
 * `removedConnections`) into one CRUD-style feed so the UI can show
 * "what's left" / "what's done" / "what drifted" per change instead
 * of per task. Computed on demand by the backend — never stored.
 */
export type ChangeOperation = 'add' | 'modify' | 'remove' | 'move';
export type ChangeKind = 'file' | 'symbol' | 'connection';
export type ChangeDriftStatus =
  | 'planned'        // not yet detected in the live state
  | 'in_progress'    // task is in_progress / assigned
  | 'satisfied'      // change is reflected in the current state
  | 'missing'        // task is done but the change isn't visible
  | 'unexpected';    // change exists in the live state but no task claims it

export interface ProposedChange {
  /** Deterministic id: `${taskUid}:${kind}:${target}:${operation}`. */
  id: string;
  taskUid: string;
  taskDescription: string;
  taskStatus: TaskStatus;
  phaseUid: string | null;
  operation: ChangeOperation;
  kind: ChangeKind;
  /** Human-readable target identifier — file path, "Class#method", "from → to". */
  target: string;
  /** Optional structured detail (signature, moveTo, etc.). */
  detail?: string;
  driftStatus: ChangeDriftStatus;
}

export interface Deviation {
  id: number;
  planUid: string;
  deviationType: string;
  severity: DeviationSeverity;
  description: string;
  resolution: DeviationResolution;
  detectedAt: number;
  resolvedAt: number | null;
}

/**
 * Canonical doc-type taxonomy for the plan spec room. Agents can also pass
 * any string (treated as 'custom') so the taxonomy stays extensible — the
 * canonical types just get nicer chips in the UI.
 *
 * Phase 14 §A loosens this list with human-friendly types
 * (`requirements`, `design`, `ux_journey`, `bug_report`, `transcript`,
 * `note`) so templates and humans aren't shoehorned into
 * `acceptance_criteria` etc.
 */
export type PlanDocType =
  | 'executive_summary'
  | 'architecture'
  | 'patterns'
  | 'examples'
  | 'research'
  | 'testing'
  | 'security'
  | 'ux_ui'
  | 'constraints'
  | 'acceptance_criteria'
  | 'rollout'
  | 'requirements'
  | 'design'
  | 'ux_journey'
  | 'bug_report'
  | 'transcript'
  | 'note'
  | 'custom';

/**
 * Phase 14 §A — same shape as `TaskAttachment` but lives on the plan
 * doc. Surfaced separately so the renderer can keep the doc rail and
 * task rail visually distinct.
 */
export interface PlanDocAttachment {
  uid: string;
  docUid: string;
  kind: AttachmentKind;
  value: string;
  label?: string;
  contentType?: string;
  author: string;
  authorType: string;
  createdAt: number;
}

export interface PlanDocument {
  uid: string;
  planUid: string;
  docType: PlanDocType | string;
  title: string;
  body: string;
  version: number;
  author: string;
  authorType: 'human' | string;
  /**
   * Sortable string used to render docs in a stable order — matches the
   * swf "00-EXECUTIVE / 01-PHASE-1 / 02-PHASE-2 / …" filename convention.
   * Lexicographic compare; nulls sort last.
   */
  orderHint: string | null;
  /**
   * Optional parent doc — lets docs nest into folder-like groupings
   * (e.g. a "testing" parent with per-phase test children).
   */
  parentDocUid: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface PlanDocumentVersion {
  id: number;
  docUid: string;
  version: number;
  body: string;
  changeSummary: string | null;
  author: string;
  createdAt: number;
}

export interface CreatePlanInput {
  title: string;
  description: string;
  tasks: Array<{
    description: string;
    affectedFiles?: string[];
    affectedSymbols?: string[];
    newConnections?: Array<{ from: string; to: string }>;
    removedConnections?: Array<{ from: string; to: string }>;
    dependencies?: string[];
    fileSpec?: string;
    symbolSpecs?: SymbolSpec[];
    /** Phase 14 §A — accept richer task shape on initial plan creation. */
    body?: string;
    prompt?: string;
    scopePath?: string | null;
    fileSpecs?: FileSpec[];
    parentTaskUid?: string | null;
  }>;
}

// =============================================================================
// Phase 15 — Plan Workspace v2 (Object/Action unified model)
// =============================================================================
//
// The new shape collapses today's three concepts (plan_documents,
// plan_phases, tasks) into one unified tree of `PlanItem`s. Each item
// is either an Object (durable context — markdown body, references)
// or an Action (graph-anchored work item with status / fileSpecs).
//
// The trees mix freely via `parentUid`: an Action can have an Object
// child (its references), an Object can have an Action child (an
// embedded todo), depth is the user's call.
//
// See `docs/PLAN-WORKSPACE-DESIGN.md` (v0.5) for the full design.

/**
 * Discriminator for `PlanItem.kind`. Objects are context (markdown,
 * references, attachments). Actions are graph-anchored work items
 * (status, fileSpecs, claim, drift).
 */
export type PlanItemKind = 'object' | 'action';

/**
 * Object-only template hint — seeds the body with starter markdown
 * and lights up a chip in the UI. Free-form strings beyond this list
 * are accepted (treated as 'custom').
 */
export type PlanObjectTemplate =
  | 'executive_summary'
  | 'references'
  | 'ux_journey'
  | 'competitor_analysis'
  | 'architecture'
  | 'patterns'
  | 'examples'
  | 'research'
  | 'testing'
  | 'security'
  | 'ux_ui'
  | 'constraints'
  | 'acceptance_criteria'
  | 'rollout'
  | 'requirements'
  | 'design'
  | 'bug_report'
  | 'transcript'
  | 'note'
  | 'custom';

/**
 * Action-only template hint — distinguishes a "phase" (Action that
 * groups child Actions, no graph anchor of its own) from a regular
 * leaf Action. UI uses this to render the row differently (folder
 * vs leaf). Defaults to `'leaf'` when omitted.
 */
export type PlanActionTemplate = 'phase' | 'leaf' | 'custom';

/**
 * Edge declaration carried on Action graph anchors.
 * Mirrors the existing `Task.newConnections` / `removedConnections`
 * shape so the drift detector can treat them uniformly.
 */
export interface PlanItemEdge {
  from: string;
  to: string;
}

/**
 * The unified item — replaces `PlanDocument` + `PlanPhase` + `Task`
 * for Phase 15+. Optional fields gated on `kind` per the
 * Action-only / Object-only convention; runtime guards live in
 * `plan-item-service.ts`.
 */
export interface PlanItem {
  uid: string;
  planUid: string;
  /** null = top-level under the plan; a uid = nested under another item. */
  parentUid: string | null;
  /** Stable order within a parent. Reordering rewrites this. */
  sortOrder: number;
  kind: PlanItemKind;

  // Common
  title: string;
  body: string;                 // markdown
  /** Template hint — `PlanObjectTemplate` or `PlanActionTemplate`. */
  template: string | null;

  // Action-only (undefined / null on Objects)
  status?: TaskStatus | null;
  assignee?: string | null;
  assigneeType?: string | null;
  assigneeModel?: string | null;
  progressPercent?: number | null;
  blockedReason?: string | null;
  /** Folder this Action is rooted at; relative paths in fileSpecs resolve here. */
  scopePath?: string | null;
  fileSpecs?: FileSpec[];
  symbolSpecs?: SymbolSpec[];
  newConnections?: PlanItemEdge[];
  removedConnections?: PlanItemEdge[];
  /** Other Action uids that must complete before this one. */
  dependencies?: string[];

  // --- Phase 17.N-Q — Routing & execution rules (cascadeable) ---
  /** 17.N — Required skills. Empty array or undefined = no requirements. */
  skills?: Skill[];
  /** 17.P — How skills merge with parent. */
  skillsMode?: CascadeMode;
  /** 17.O — Claim policy. Null/undefined = inherit from parent. */
  claimPolicy?: ClaimPolicy | null;
  claimPolicyMode?: 'inherit' | 'replace';
  /** 17.Q — Per-item execution settings. Null = inherit from parent. */
  executionConfig?: ExecutionConfig | null;
  executionConfigMode?: 'inherit' | 'replace';
  /** 17.F — Constraints & guardrails. Cascades down the tree. */
  constraints?: ItemConstraints | null;
  constraintsMode?: CascadeMode;
  /** 17.K — Approval gate. When true, agent must wait for human approval
   *  after completing this item before moving to the next sibling. */
  requiresApproval?: boolean;

  // Common metadata
  author: string;
  authorType: string;
  createdAt: number;
  updatedAt: number;

  /**
   * Set during 15.B migration so we can detect already-migrated rows
   * and skip on re-run. Carries the legacy table + id, e.g.
   * "tasks:abc-123" or "plan_documents:def-456". Null on
   * natively-created items.
   */
  migratedFrom?: string | null;
}

/**
 * One row of the per-item edit history. Snapshots both `body` and a
 * JSON dump of all other meaningful fields so non-body changes
 * (status, fileSpecs, scopePath, …) are blameable too.
 */
export interface PlanItemVersion {
  id: number;
  itemUid: string;
  version: number;
  bodySnapshot: string;
  metaSnapshot: Record<string, unknown>;
  changeSummary: string | null;
  author: string;
  authorType: string;
  createdAt: number;
}

/**
 * Plan-level mutation event types. Drives the activity rail and the
 * timeline scrubber. Append-only — never mutated, never deleted.
 */
export type PlanEventType =
  | 'item_created'
  | 'item_moved'
  | 'item_deleted'
  | 'item_restored'
  | 'item_renamed'
  | 'reparented'
  | 'reordered'
  | 'status_changed'
  | 'kind_transmuted'
  | 'plan_status_changed';

export interface PlanEvent {
  id: number;
  planUid: string;
  /** Nullable for plan-scope events that aren't about a specific item. */
  itemUid: string | null;
  eventType: PlanEventType;
  /** "Before" snapshot — JSON, optional (deletes / restores carry it). */
  beforeState?: unknown;
  /** "After" snapshot — JSON. Always present for mutations. */
  afterState?: unknown;
  /** Human-readable summary, e.g. "moved 'Add tests' under Phase 2". */
  summary: string;
  author: string;
  authorType: string;
  createdAt: number;
}

/**
 * Input to `add_item` — fields beyond the common ones are optional
 * and gated on `kind` (Action-only fields are ignored on Objects).
 */
export interface CreatePlanItemInput {
  planUid: string;
  parentUid?: string | null;
  sortOrder?: number;
  kind: PlanItemKind;
  title: string;
  body?: string;
  template?: string | null;
  // Action-only
  status?: TaskStatus;
  assignee?: string | null;
  assigneeType?: string | null;
  assigneeModel?: string | null;
  /** 0–100 — preserved by the migrator so legacy in-progress tasks keep their bar. */
  progressPercent?: number | null;
  /** Free-form blocker reason — preserved by the migrator. */
  blockedReason?: string | null;
  scopePath?: string | null;
  fileSpecs?: FileSpec[];
  symbolSpecs?: SymbolSpec[];
  newConnections?: PlanItemEdge[];
  removedConnections?: PlanItemEdge[];
  dependencies?: string[];
  // Phase 17.N-Q — routing / execution
  skills?: Skill[];
  skillsMode?: CascadeMode;
  claimPolicy?: ClaimPolicy | null;
  claimPolicyMode?: 'inherit' | 'replace';
  executionConfig?: ExecutionConfig | null;
  executionConfigMode?: 'inherit' | 'replace';
  // Phase 17.F — constraints
  constraints?: ItemConstraints | null;
  constraintsMode?: CascadeMode;
  // Phase 17.K — approval gate
  requiresApproval?: boolean;
  // Caller identity
  author: string;
  authorType: string;
  /** For migration only — preserves legacy uids + records source table. */
  uid?: string;
  createdAt?: number;
  updatedAt?: number;
  migratedFrom?: string | null;
}

/**
 * Partial update payload. Any field omitted is left unchanged. Pass
 * `null` to clear a nullable field. Structural changes (parentUid,
 * sortOrder) emit `plan_events`; content changes emit a
 * `plan_item_versions` row.
 */
export interface UpdatePlanItemInput {
  title?: string;
  body?: string;
  template?: string | null;
  status?: TaskStatus | null;
  assignee?: string | null;
  assigneeType?: string | null;
  assigneeModel?: string | null;
  progressPercent?: number | null;
  blockedReason?: string | null;
  scopePath?: string | null;
  fileSpecs?: FileSpec[];
  symbolSpecs?: SymbolSpec[];
  newConnections?: PlanItemEdge[];
  removedConnections?: PlanItemEdge[];
  dependencies?: string[];
  // Phase 17.N-Q — routing / execution
  skills?: Skill[];
  skillsMode?: CascadeMode;
  claimPolicy?: ClaimPolicy | null;
  claimPolicyMode?: 'inherit' | 'replace';
  executionConfig?: ExecutionConfig | null;
  executionConfigMode?: 'inherit' | 'replace';
  // Phase 17.F — constraints
  constraints?: ItemConstraints | null;
  constraintsMode?: CascadeMode;
  // Phase 17.K — approval gate
  requiresApproval?: boolean;
  parentUid?: string | null;   // re-parent — emits plan_events
  sortOrder?: number;          // reorder — emits plan_events
  /** Optional human-readable why-summary. Lands in plan_item_versions.changeSummary. */
  changeSummary?: string;
  /** Required — the actor performing the update. */
  author: string;
  authorType: string;
}
