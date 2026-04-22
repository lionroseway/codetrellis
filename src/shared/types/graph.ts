export type NodeKind =
  | 'workspace'
  | 'package'
  | 'directory'
  | 'file'
  | 'class'
  | 'function'
  | 'method'
  | 'interface'
  | 'type';

export type ChangeStatus = 'added' | 'modified' | 'removed' | 'unchanged'
  | 'planned_add' | 'planned_modify' | 'planned_remove' | 'in_progress_task' | 'active' | 'affected';

export interface GraphNode {
  id: string;
  type: NodeKind;
  label: string;
  filePath?: string;
  lineRange?: { start: number; end: number };
  parentId: string | null;
  metadata: Record<string, unknown>;
  changeStatus?: ChangeStatus;
}

export type EdgeKind =
  | 'import'
  | 'call'
  | 'extends'
  | 'implements'
  | 'dependency'
  | 'devDependency';

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeKind;
  label?: string;
  changeStatus?: ChangeStatus;
}

export interface ArchitectureDiff {
  addedNodes: GraphNode[];
  removedNodes: GraphNode[];
  modifiedNodes: GraphNode[];
  addedEdges: GraphEdge[];
  removedEdges: GraphEdge[];
}

export type ViewDepth = 'package' | 'file' | 'symbol';

export type TrellisMode = 'current' | 'planned' | 'live' | 'diff';

export interface ProjectionData {
  ghostFiles: Array<{ path: string; taskUid: string; taskDescription: string }>;
  modifiedFiles: Array<{ path: string; taskUid: string }>;
  removedFiles: Array<{ path: string; taskUid: string }>;
  newEdges: Array<{ from: string; to: string; taskUid: string }>;
  removedEdges: Array<{ from: string; to: string; taskUid: string }>;
}
