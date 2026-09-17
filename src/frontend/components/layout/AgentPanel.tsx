import { useMemo, useState } from 'react';
import {
  FileEdit, Search, Circle, X, ChevronRight, ChevronDown,
  AlertTriangle, HelpCircle, Pencil, Eye, Plug,
} from 'lucide-react';
import { useUiStore } from '../../stores/ui-store';
import { useAgentStore } from '../../stores/agent-store';
import { groupIntoTurns, formatDuration, formatRelative, type AgentTurn } from '../../lib/agent-turns';
import { phraseEvent, rawPayloadText, type EventIntent } from '../../lib/tool-phrasing';
import type { AgentEvent } from '@shared/types';

type Tab = 'plan' | 'timeline' | 'changes';

/**
 * Phase 22 — the Timeline renders TURNS, not raw tool calls.
 *
 * An agent reads three files, greps, edits two and runs a test: one
 * intention, seven rows. The old view rendered all seven as raw payload
 * JSON and left the user to infer meaning. Nobody does that inference.
 *
 * Grouping is a view concern only — every underlying event is kept and
 * reachable through the disclosure, because a complete log is what makes
 * the Timeline worth anything in a post-mortem.
 */

const INTENT_ICON: Record<EventIntent, typeof FileEdit> = {
  read: Eye,
  write: Pencil,
  ask: HelpCircle,
  session: Plug,
  error: AlertTriangle,
};

const INTENT_COLOR: Record<EventIntent, string> = {
  read: 'text-foreground-subtle',
  write: 'text-accent',
  ask: 'text-warning',
  session: 'text-foreground-subtle',
  error: 'text-danger',
};

/** One event row inside an expanded turn. */
function EventRow({ event }: { event: AgentEvent }) {
  const [showRaw, setShowRaw] = useState(false);
  const phrased = phraseEvent(event);
  const Icon = INTENT_ICON[phrased.intent] ?? Circle;

  return (
    <div className="pl-6 pr-2">
      <button
        onClick={() => setShowRaw((v) => !v)}
        className="w-full flex items-start gap-2 py-0.5 text-left hover:bg-surface-hover rounded transition-colors"
        title={phrased.tool ?? undefined}
      >
        <span className="text-[9px] text-foreground-subtle font-mono shrink-0 mt-0.5 opacity-50">
          {new Date(event.timestamp).toLocaleTimeString()}
        </span>
        <Icon size={10} className={`shrink-0 mt-0.5 ${INTENT_COLOR[phrased.intent]}`} />
        <span className="text-foreground-muted truncate flex-1">{phrased.text}</span>
      </button>
      {showRaw && (
        <pre className="ml-6 my-1 p-2 rounded bg-surface text-[9px] text-foreground-subtle font-mono overflow-x-auto max-h-40">
          {rawPayloadText(event)}
        </pre>
      )}
    </div>
  );
}

/** One turn card. Collapsed by default — the summary is the point. */
function TurnCard({ turn }: { turn: AgentTurn }) {
  const [expanded, setExpanded] = useState(false);
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <div className="rounded-md hover:bg-surface-hover transition-colors">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-start gap-2 py-1 px-2 text-left"
      >
        <span className="text-[9px] text-foreground-subtle font-mono shrink-0 mt-0.5 opacity-50">
          {new Date(turn.startedAt).toLocaleTimeString()}
        </span>
        <Chevron size={11} className="text-foreground-subtle shrink-0 mt-0.5" />
        <span className="flex-1 min-w-0">
          <span
            className={`block truncate ${
              turn.hasError ? 'text-danger' : turn.mutating ? 'text-foreground' : 'text-foreground-muted'
            }`}
          >
            {turn.summary}
          </span>
          {(turn.files.length > 0 || turn.agentType) && (
            <span className="block text-[9px] text-foreground-subtle truncate mt-0.5">
              {turn.agentType && <span>{turn.agentType}</span>}
              {turn.agentType && turn.files.length > 0 && <span> · </span>}
              {turn.files.length > 0 && (
                <span className="font-mono">
                  {turn.files.slice(0, 3).join(', ')}
                  {turn.files.length > 3 && ` +${turn.files.length - 3}`}
                </span>
              )}
            </span>
          )}
        </span>
        {turn.durationMs >= 1000 && (
          <span className="text-[9px] text-foreground-subtle font-mono shrink-0 mt-0.5 opacity-60">
            {formatDuration(turn.durationMs)}
          </span>
        )}
      </button>
      {expanded && (
        <div className="pb-1">
          {turn.events.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}

export function AgentPanel() {
  const visible = useUiStore((s) => s.agentPanelVisible);
  const height = useUiStore((s) => s.agentPanelHeight);
  const [activeTab, setActiveTab] = useState<Tab>('timeline');

  const events = useAgentStore((s) => s.events);
  const currentPlan = useAgentStore((s) => s.currentPlan);
  const status = useAgentStore((s) => s.status);

  // Newest first for display; the grouper works oldest-first.
  const turns = useMemo(() => groupIntoTurns(events.slice(-400)).reverse(), [events]);
  const lastTurn = turns[0] ?? null;

  const fileChanges = events.filter(
    (e) => e.type === 'file_changed' && (e.payload.action === 'write' || e.payload.action === 'edit')
  );

  if (!visible) return null;

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'plan', label: 'Plan' },
    { key: 'timeline', label: 'Timeline', count: turns.length },
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
            {turns.length === 0 ? (
              <div className="text-foreground-subtle py-6 text-center">
                No agent events yet
              </div>
            ) : (
              <>
                {/* An idle panel used to show nothing, which is
                    indistinguishable from the app being broken. Say when
                    the last thing happened and what it was. */}
                {status !== 'active' && lastTurn && (
                  <div className="mb-2 px-2 py-1.5 rounded-md bg-surface text-[10px] text-foreground-subtle">
                    Last activity {formatRelative(lastTurn.endedAt)} — {lastTurn.summary}
                  </div>
                )}
                <div className="space-y-px">
                  {turns.map((turn) => (
                    <TurnCard key={turn.id} turn={turn} />
                  ))}
                </div>
              </>
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
