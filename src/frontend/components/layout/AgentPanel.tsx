import { useState } from 'react';
import { FileEdit, Search, ClipboardList, Circle, XCircle, ShieldCheck, X } from 'lucide-react';
import { useUiStore } from '../../stores/ui-store';
import { useAgentStore } from '../../stores/agent-store';

type Tab = 'plan' | 'timeline' | 'changes';

const EVENT_ICON_MAP: Record<string, typeof FileEdit> = {
  file_changed: FileEdit, architecture_query: Search, plan_reported: ClipboardList,
  session_start: Circle, session_end: XCircle, conformity_check: ShieldCheck,
};

function formatPayload(payload: Record<string, unknown>): string {
  if (payload.action === 'read') return `Read ${payload.file}`;
  if (payload.action === 'write') return `Write ${payload.file}`;
  if (payload.action === 'edit') return `Edit ${payload.file}`;
  if (payload.action === 'bash') return `$ ${payload.command}`;
  if (payload.tool === 'Glob') return `Glob: ${payload.pattern}`;
  if (payload.tool === 'Grep') return `Grep: ${payload.pattern}`;
  if (payload.text) return String(payload.text).substring(0, 100);
  if (payload.message) return String(payload.message).substring(0, 100);
  if (payload.sessionId) return `Session: ${String(payload.sessionId).substring(0, 12)}...`;
  return JSON.stringify(payload).substring(0, 80);
}

export function AgentPanel() {
  const visible = useUiStore((s) => s.agentPanelVisible);
  const height = useUiStore((s) => s.agentPanelHeight);
  const [activeTab, setActiveTab] = useState<Tab>('timeline');

  const events = useAgentStore((s) => s.events);
  const currentPlan = useAgentStore((s) => s.currentPlan);
  const status = useAgentStore((s) => s.status);

  const fileChanges = events.filter(
    (e) => e.type === 'file_changed' && (e.payload.action === 'write' || e.payload.action === 'edit')
  );

  if (!visible) return null;

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'plan', label: 'Plan' },
    { key: 'timeline', label: 'Timeline', count: events.length },
    { key: 'changes', label: 'Changes', count: fileChanges.length },
  ];

  return (
    <div className="glass-panel border-t flex flex-col h-full overflow-hidden">
      <div className="flex items-center border-b border-border-subtle px-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 text-[11px] font-medium border-b-2 transition-all flex items-center gap-1.5 ${
              activeTab === tab.key
                ? 'border-accent text-accent'
                : 'border-transparent text-foreground-subtle hover:text-foreground-muted'
            }`}
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
          {status === 'active' ? 'Agent active' : 'Waiting for agent'}
        </span>
        <button onClick={() => useUiStore.getState().toggleAgentPanel()} className="text-foreground-subtle hover:text-foreground p-1 rounded hover:bg-surface-hover transition-colors">
          <X size={12} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {activeTab === 'plan' && (
          <div className="text-[11px] text-foreground-subtle">
            {currentPlan ? (
              <div className="space-y-2">
                <h3 className="font-medium text-foreground text-xs">{currentPlan.title}</h3>
                {currentPlan.steps.map((step, i) => (
                  <div key={i} className="flex items-start gap-2 px-2 py-1 rounded-md hover:bg-surface-hover transition-colors">
                    <span className={`mt-0.5 text-[10px] ${
                      step.status === 'done' ? 'text-success drop-shadow-[0_0_3px_rgba(34,197,94,0.5)]' :
                      step.status === 'active' ? 'text-accent' : 'text-foreground-subtle'
                    }`}>
                      {step.status === 'done' ? '✓' : step.status === 'active' ? '▸' : '○'}
                    </span>
                    <span className={step.status === 'done' ? 'text-foreground-muted' : 'text-foreground'}>
                      {step.description}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <span>No active plan detected</span>
            )}
          </div>
        )}

        {activeTab === 'timeline' && (
          <div className="text-[11px]">
            {events.length === 0 ? (
              <div className="text-foreground-subtle py-6 text-center">
                No agent events yet
              </div>
            ) : (
              <div className="space-y-px">
                {events.slice(-100).reverse().map((event) => {
                  const Icon = EVENT_ICON_MAP[event.type] || Circle;
                  return (
                    <div key={event.id} className="flex items-start gap-2 py-1 px-2 hover:bg-surface-hover rounded-md transition-colors">
                      <span className="text-[9px] text-foreground-subtle font-mono shrink-0 mt-0.5 opacity-50">
                        {new Date(event.timestamp).toLocaleTimeString()}
                      </span>
                      <Icon size={11} className="text-foreground-subtle shrink-0 mt-0.5" />
                      <span className="text-foreground-muted truncate">{formatPayload(event.payload)}</span>
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
              <div className="text-foreground-subtle py-6 text-center">No file changes by agent</div>
            ) : (
              <div className="space-y-px">
                {fileChanges.slice(-50).reverse().map((event) => (
                  <div key={event.id} className="flex items-center gap-2 py-1 px-2 hover:bg-surface-hover rounded-md transition-colors">
                    <span className="text-[9px] text-foreground-subtle font-mono shrink-0 opacity-50">
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </span>
                    <span className={`text-[9px] font-semibold px-1.5 rounded ${
                      event.payload.action === 'write'
                        ? 'text-success bg-success-muted shadow-[0_0_4px_rgba(34,197,94,0.15)]'
                        : 'text-warning bg-warning-muted shadow-[0_0_4px_rgba(245,158,11,0.15)]'
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
      </div>
    </div>
  );
}
