import { useMemo, useState } from 'react';
import {
  Circle, ChevronRight, ChevronDown,
  AlertTriangle, HelpCircle, Pencil, Eye, Plug, FileEdit,
} from 'lucide-react';
import {
  groupIntoTurns, formatDuration, formatRelative, type AgentTurn,
} from '../../lib/agent-turns';
import { phraseEvent, rawPayloadText, type EventIntent } from '../../lib/tool-phrasing';
import type { AgentEvent } from '@shared/types';

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
 *
 * ---
 *
 * Phase 29 §4.15 — this lived inside `AgentPanel`, and `AgentPanel` is
 * not rendered by anything. `PlanPanel` replaced it in the same slot
 * (both read `agentPanelVisible`, both draw the same close button), and
 * Phase 22 then improved the copy that had already been replaced. So
 * the flat raw-payload list this was written to fix is what users have
 * been looking at, while its replacement — and `agent-turns.test.ts`,
 * which tests the grouping — sat dark.
 *
 * Extracted here so there is exactly one implementation. Two panels
 * rendering the same events two ways is how this happened; a shared
 * component is the structural fix, not just the wiring.
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

/**
 * Group events into turns. Exported so a panel can show the turn count
 * on its tab without grouping a second time — the count on the tab and
 * the rows in the body have to be the same number.
 */
export function useAgentTurns(events: AgentEvent[]): AgentTurn[] {
  // Newest first for display; the grouper works oldest-first.
  return useMemo(() => groupIntoTurns(events.slice(-400)).reverse(), [events]);
}

export function AgentTurnList({
  turns,
  status,
}: {
  turns: AgentTurn[];
  status: string;
}) {
  const lastTurn = turns[0] ?? null;

  if (turns.length === 0) {
    return (
      <div className="text-foreground-subtle py-6 text-center">No agent events yet</div>
    );
  }

  return (
    <>
      {/* An idle panel used to show nothing, which is indistinguishable
          from the app being broken. Say when the last thing happened and
          what it was. */}
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
  );
}
