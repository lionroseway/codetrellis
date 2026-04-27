import { useEffect, useState } from 'react';
import { FileEdit, Search, Circle, XCircle, X, ClipboardList, Maximize2, Minimize2, Wrench, AlertCircle, Plug } from 'lucide-react';
import { useUiStore } from '../../stores/ui-store';
import { useAgentStore } from '../../stores/agent-store';
import { usePlanStore } from '../../stores/plan-store';
import { PlanList } from '../plan/PlanList';
import { PlanDetail } from '../plan/PlanDetail';
import { CommentThread } from '../plan/CommentThread';
import { PlanCreateModal } from '../plan/PlanCreateModal';
import { ProposedChanges } from '../plan/ProposedChanges';

type Tab = 'plans' | 'timeline' | 'changes' | 'proposed' | 'comments';

const EVENT_ICON_MAP: Record<string, typeof FileEdit> = {
  file_changed: FileEdit,
  architecture_query: Search,
  plan_reported: ClipboardList,
  session_start: Plug,
  session_end: XCircle,
  tool_call: Wrench,
  tool_error: AlertCircle,
};

const EVENT_ICON_COLOR: Record<string, string> = {
  tool_call: 'text-cyan-400',
  tool_error: 'text-red-400',
  session_start: 'text-emerald-400',
  session_end: 'text-zinc-500',
  file_changed: 'text-amber-400',
};

function formatPayload(type: string, payload: Record<string, unknown>): string {
  // Generic MCP tool calls — any agent (Claude Code, Codex, Cursor, ...)
  if (type === 'tool_call' || type === 'tool_error') {
    const tool = String(payload.tool || 'tool');
    const agent = payload.agentType ? `[${payload.agentType}] ` : '';
    const dur = typeof payload.durationMs === 'number' ? ` · ${payload.durationMs}ms` : '';
    const err = type === 'tool_error' && payload.error ? ` — ${String(payload.error).slice(0, 60)}` : '';
    const args = payload.args ? ` ${String(payload.args).slice(0, 80)}` : '';
    return `${agent}${tool}${args}${dur}${err}`;
  }
  if (payload.action === 'read') return `Read ${payload.file}`;
  if (payload.action === 'write') return `Write ${payload.file}`;
  if (payload.action === 'edit') return `Edit ${payload.file}`;
  if (payload.action === 'bash') return `$ ${payload.command}`;
  if (payload.tool === 'Glob') return `Glob: ${payload.pattern}`;
  if (payload.tool === 'Grep') return `Grep: ${payload.pattern}`;
  if (payload.text) return String(payload.text).substring(0, 100);
  if (payload.message) return String(payload.message).substring(0, 100);
  if (payload.agentType && payload.source === 'mcp') return `${payload.agentType} via MCP`;
  if (payload.sessionId) return `Session: ${String(payload.sessionId).substring(0, 12)}...`;
  return JSON.stringify(payload).substring(0, 80);
}

export function PlanPanel() {
  const visible = useUiStore((s) => s.agentPanelVisible);
  const expanded = useUiStore((s) => s.planPanelExpanded);
  const togglePlanPanelExpanded = useUiStore((s) => s.togglePlanPanelExpanded);
  const [activeTab, setActiveTab] = useState<Tab>('plans');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const events = useAgentStore((s) => s.events);
  const status = useAgentStore((s) => s.status);
  const activePlan = usePlanStore((s) => s.activePlan);
  const comments = usePlanStore((s) => s.comments);

  const fileChanges = events.filter(
    (e) => e.type === 'file_changed' && (e.payload.action === 'write' || e.payload.action === 'edit')
  );

  // If the active plan goes away while the user is on the Proposed
  // tab (which depends on it), bounce back to Plans.
  useEffect(() => {
    if (activeTab === 'proposed' && !activePlan) setActiveTab('plans');
  }, [activeTab, activePlan]);

  if (!visible) return null;

  const tabs: { key: Tab; label: string; count?: number; disabled?: boolean }[] = [
    { key: 'plans', label: 'Plans' },
    { key: 'timeline', label: 'Timeline', count: events.length || undefined },
    { key: 'changes', label: 'Changes', count: fileChanges.length || undefined },
    // Proposed Changes (Phase 12 §B) requires an active plan — task
    // fields are the source of truth.
    { key: 'proposed', label: 'Proposed', disabled: !activePlan },
    { key: 'comments', label: 'Comments', count: comments.length || undefined },
  ];

  return (
    <div className="glass-panel border-t flex flex-col h-full overflow-hidden">
      <div className="flex items-center border-b border-border-subtle px-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => !tab.disabled && setActiveTab(tab.key)}
            disabled={tab.disabled}
            className={`px-3 py-1.5 text-[11px] font-medium border-b-2 transition-all flex items-center gap-1.5 ${
              tab.disabled
                ? 'border-transparent text-foreground-subtle/40 cursor-not-allowed'
                : activeTab === tab.key
                  ? 'border-accent text-accent'
                  : 'border-transparent text-foreground-subtle hover:text-foreground-muted'
            }`}
            title={tab.disabled ? 'Open a plan to see its proposed changes' : undefined}
          >
            {tab.label}
            {tab.count != null && tab.count > 0 && (
              <span className={`text-[9px] px-1.5 rounded-full ${
                activeTab === tab.key ? 'bg-accent-muted text-accent' : 'bg-surface text-foreground-subtle'
              }`}>{tab.count}</span>
            )}
          </button>
        ))}
        <div className="flex-1" />
        <span className={`text-[10px] mr-2 flex items-center gap-1.5 ${status === 'active' ? 'text-success' : 'text-foreground-subtle'}`}>
          {status === 'active' && <span className="w-1 h-1 rounded-full bg-success shadow-[0_0_4px_rgba(34,197,94,0.6)] animate-pulse" />}
          {status === 'active' ? 'Agent active' : 'Waiting'}
        </span>
        <button
          onClick={togglePlanPanelExpanded}
          className="text-foreground-subtle hover:text-foreground p-1 rounded hover:bg-surface-hover transition-colors"
          title={expanded ? 'Collapse panel' : 'Expand panel'}
        >
          {expanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
        </button>
        <button onClick={() => useUiStore.getState().toggleAgentPanel()} className="text-foreground-subtle hover:text-foreground p-1 rounded hover:bg-surface-hover transition-colors" title="Hide panel">
          <X size={12} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {activeTab === 'plans' && (
          activePlan
            ? <PlanDetail />
            : <PlanList onCreateClick={() => setShowCreateModal(true)} />
        )}

        {activeTab === 'timeline' && (
          <div className="text-[11px]">
            {events.length === 0 ? (
              <div className="text-foreground-subtle py-6 text-center">No agent events yet</div>
            ) : (
              <div className="space-y-px">
                {events.slice(-100).reverse().map((event) => {
                  const Icon = EVENT_ICON_MAP[event.type] || Circle;
                  const iconClass = EVENT_ICON_COLOR[event.type] || 'text-foreground-subtle';
                  return (
                    <div key={event.id} className="flex items-start gap-2 py-1 px-2 hover:bg-surface-hover rounded-md transition-colors">
                      <span className="text-[9px] text-foreground-subtle font-mono shrink-0 mt-0.5 opacity-50">
                        {new Date(event.timestamp).toLocaleTimeString()}
                      </span>
                      <Icon size={11} className={`${iconClass} shrink-0 mt-0.5`} />
                      <span className="text-foreground-muted truncate">{formatPayload(event.type, event.payload as Record<string, unknown>)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'changes' && (
          <div className="text-[11px]">
            {fileChanges.length === 0 ? (
              <div className="text-foreground-subtle py-6 text-center">No file changes</div>
            ) : (
              <div className="space-y-px">
                {fileChanges.slice(-50).reverse().map((event) => (
                  <div key={event.id} className="flex items-center gap-2 py-1 px-2 hover:bg-surface-hover rounded-md transition-colors">
                    <span className="text-[9px] text-foreground-subtle font-mono shrink-0 opacity-50">
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </span>
                    <span className={`text-[9px] font-semibold px-1.5 rounded ${
                      event.payload.action === 'write'
                        ? 'text-green-400 bg-green-500/10'
                        : 'text-amber-400 bg-amber-500/10'
                    }`}>
                      {String(event.payload.action).toUpperCase()}
                    </span>
                    <span className="text-foreground-muted font-mono truncate">
                      {String(event.payload.file || '').split('/').pop()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'proposed' && activePlan && (
          <ProposedChanges planUid={activePlan.uid} />
        )}

        {activeTab === 'comments' && <CommentThread />}
      </div>

      {showCreateModal && <PlanCreateModal onClose={() => setShowCreateModal(false)} />}
    </div>
  );
}
