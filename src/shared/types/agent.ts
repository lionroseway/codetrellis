import type { ArchitectureDiff } from './graph';

export type AgentEventSource = 'mcp' | 'claude-code-watcher' | 'file-watcher';

export type AgentEventType =
  | 'plan_reported'
  | 'architecture_query'
  | 'conformity_check'
  | 'file_changed'
  | 'session_start'
  | 'session_end';

export interface AgentEvent {
  id: string;
  timestamp: number;
  source: AgentEventSource;
  type: AgentEventType;
  payload: Record<string, unknown>;
}

export type PlanStepStatus = 'pending' | 'active' | 'done' | 'skipped';

export interface AgentPlanStep {
  description: string;
  status: PlanStepStatus;
  files: string[];
}

export type PlanStatus = 'proposed' | 'in_progress' | 'completed' | 'abandoned';

export interface AgentPlan {
  id: string;
  title: string;
  steps: AgentPlanStep[];
  status: PlanStatus;
  affectedFiles: string[];
  estimatedImpact: ArchitectureDiff | null;
}

export type AgentStatus = 'idle' | 'active' | 'paused';
