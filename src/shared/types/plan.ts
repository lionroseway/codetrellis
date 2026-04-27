export type PlanStatus = 'draft' | 'review' | 'approved' | 'in_progress' | 'completed' | 'archived';
export type TaskStatus = 'pending' | 'assigned' | 'in_progress' | 'done' | 'blocked' | 'skipped';
export type PhaseStatus = 'pending' | 'in_progress' | 'done' | 'blocked';
export type CommentType = 'comment' | 'suggestion' | 'approval' | 'concern' | 'status_update';
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
}

export interface SymbolSpec {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'method' | 'enum';
  action: 'add' | 'modify' | 'remove' | 'move';
  description?: string;
  signature?: string;    // e.g. "signToken(payload: JwtPayload, secret: string): string"
  moveTo?: string;       // target file if action is 'move'
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
  targetType: 'plan' | 'task';
  targetUid: string;
  parentUid: string | null;
  author: string;
  authorType: 'human' | string;
  body: string;
  commentType: CommentType;
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
  | 'custom';

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
  }>;
}
