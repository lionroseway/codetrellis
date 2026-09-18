import { useEffect, useState } from 'react';
import { X, Maximize2, Minimize2 } from 'lucide-react';
import { useUiStore } from '../../stores/ui-store';
import { useAgentStore } from '../../stores/agent-store';
import { usePlanStore } from '../../stores/plan-store';
import { PlanList } from '../plan/PlanListView';
import { CommentThread } from '../plan/CommentThread';
import { ProposedChanges } from '../plan/ProposedChanges';
import { AgentTurnList, useAgentTurns } from './AgentTurns';

type Tab = 'plans' | 'timeline' | 'changes' | 'proposed' | 'comments';

/*
 * Phase 29 §4.15 — the flat event renderer that used to live here
 * (EVENT_ICON_MAP / EVENT_ICON_COLOR / formatPayload) is gone. It
 * printed one row per tool call with the payload stringified, which is
 * exactly what Phase 22's turn grouping was written to replace —
 * `tool-phrasing.ts` says the same things in words, and `agent-turns.ts`
 * groups them. See `AgentTurns.tsx` for why that replacement never
 * landed until now.
 */

export function PlanPanel() {
  const visible = useUiStore((s) => s.agentPanelVisible);
  const expanded = useUiStore((s) => s.planPanelExpanded);
  const togglePlanPanelExpanded = useUiStore((s) => s.togglePlanPanelExpanded);
  const [activeTab, setActiveTab] = useState<Tab>('plans');

  const events = useAgentStore((s) => s.events);
  const status = useAgentStore((s) => s.status);
  const activePlan = usePlanStore((s) => s.activePlan);
  const comments = usePlanStore((s) => s.comments);

  // Phase 29 §4.15 — the Timeline shows turns, not raw tool calls.
  // Phase 22 wrote that view into `AgentPanel`, which `PlanPanel` had
  // already replaced in this slot, so nothing ever rendered it. See
  // `AgentTurns.tsx`.
  const turns = useAgentTurns(events);

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
    // Counts turns, not events — the number on the tab has to be the
    // number of rows in the body.
    { key: 'timeline', label: 'Timeline', count: turns.length || undefined },
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
          <PlanList />
        )}

        {activeTab === 'timeline' && (
          <div className="text-[11px]">
            <AgentTurnList turns={turns} status={status} />
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

    </div>
  );
}
