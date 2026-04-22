export type PlanStatus = 'draft' | 'review' | 'approved' | 'in_progress' | 'completed' | 'archived';
export type TaskStatus = 'pending' | 'assigned' | 'in_progress' | 'done' | 'blocked' | 'skipped';
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
