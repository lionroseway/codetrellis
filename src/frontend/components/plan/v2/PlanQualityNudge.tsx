import { useState } from 'react';
import { Lightbulb, Sparkles, X } from 'lucide-react';
import type { Plan, PlanItem, TaskAttachment } from '@shared/types';

/**
 * Phase 15 §15.D — Plan Quality Nudge.
 *
 * Friendly coaching banner. Surfaces when a plan or Action looks
 * thin (short body + no context). Never blocks anything; user can
 * dismiss and the same nudge stays dismissed for the session.
 *
 * The point: most coding agents fail not because the model is bad
 * but because the user gave them a vague prompt with no anchors.
 * The nudge says, in plain words, "this is too vague — link some
 * files / symbols / docs, or talk to your AI to flesh it out."
 *
 * Two flavours:
 *   - <PlanLevelNudge>   for the plan home page
 *   - <ItemLevelNudge>   for an Action / Object page
 */

const SESSION_DISMISSED = new Set<string>();
// Module-level set, so navigating away and back doesn't re-show
// nudges the user already swatted. Cleared on full reload.

function useDismiss(key: string): { dismissed: boolean; dismiss: () => void } {
  const [dismissed, setDismissed] = useState(SESSION_DISMISSED.has(key));
  return {
    dismissed,
    dismiss: () => {
      SESSION_DISMISSED.add(key);
      setDismissed(true);
    },
  };
}

// ---------------------------------------------------------------------------
// Plan-level nudge
// ---------------------------------------------------------------------------

const SHORT_BODY_THRESHOLD = 40;

export function PlanLevelNudge({
  plan, topLevelCount,
}: {
  plan: Plan;
  topLevelCount: number;
}) {
  const { dismissed, dismiss } = useDismiss(`plan:${plan.uid}`);
  const bodyLen = (plan.description ?? '').trim().length;
  const isVague = bodyLen < SHORT_BODY_THRESHOLD && topLevelCount === 0;
  if (dismissed || !isVague) return null;

  return (
    <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3.5 flex items-start gap-3">
      <Lightbulb size={16} className="text-amber-300 shrink-0 mt-0.5" />
      <div className="flex-1 space-y-2 text-[13.5px] text-amber-100/90 leading-relaxed">
        <div className="font-medium text-amber-200 text-[15px]">This plan looks vague.</div>
        <p>
          Agents do their best work when the plan is concrete. Two ways to get there:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-amber-100/80">
          <li>Add a sub-page (<span className="font-mono text-[12.5px]">/</span> in the body) for each piece of context — files, journeys, references.</li>
          <li>Ask your AI agent to help flesh it out — paste the goal, let it draft sub-Actions and link the files.</li>
        </ul>
      </div>
      <button
        onClick={dismiss}
        className="p-1.5 rounded text-amber-200/70 hover:text-amber-200 hover:bg-amber-500/10"
        title="Dismiss for this session"
      >
        <X size={13} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Item-level nudge (Action or Object)
// ---------------------------------------------------------------------------

export function ItemLevelNudge({
  item, attachments,
}: {
  item: PlanItem;
  attachments: TaskAttachment[];
}) {
  const { dismissed, dismiss } = useDismiss(`item:${item.uid}`);
  const bodyLen = (item.body ?? '').trim().length;
  const isAction = item.kind === 'action';

  const hasCodeAnchor =
    (item.fileSpecs?.length ?? 0) > 0 ||
    (item.symbolSpecs?.length ?? 0) > 0 ||
    (item.newConnections?.length ?? 0) > 0 ||
    (item.removedConnections?.length ?? 0) > 0;
  const hasReferences = attachments.length > 0;
  const hasAnyContext = hasCodeAnchor || hasReferences;

  // Progressive disclosure: don't fire on empty/near-empty items.
  // Only nudge once the user has actually written something (>50 chars)
  // but hasn't added any targets or context.
  const hasSubstantialBody = bodyLen > 50;
  const isVague = hasSubstantialBody && !hasAnyContext;
  const isUntrackable = isAction && !hasCodeAnchor && hasSubstantialBody;

  if (dismissed || (!isVague && !isUntrackable)) return null;

  const headline = isVague
    ? `This ${isAction ? 'task' : 'page'} needs more context.`
    : 'This task has no graph anchor.';

  const detail = isVague
    ? (isAction
        ? 'An agent will struggle to land it. Add a file, folder, or symbol target — or paste a URL / transcript / image as context.'
        : 'Hard for the room to use. Drop a file, image, URL, or write a few sentences explaining the purpose.')
    : 'Body is solid, but no file / folder / symbol / edge target means drift detection has nothing to compare against. Add at least one target so progress is visible.';

  return (
    <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3.5 flex items-start gap-3">
      <Sparkles size={16} className="text-amber-300 shrink-0 mt-0.5" />
      <div className="flex-1 space-y-1.5 text-[13.5px] text-amber-100/90 leading-relaxed">
        <div className="font-medium text-amber-200 text-[15px]">{headline}</div>
        <p className="text-amber-100/80">{detail}</p>
        <p className="text-[12.5px] text-amber-100/60">
          Tip: ask your AI agent — paste this {isAction ? 'task' : 'page'} and let it suggest the anchors.
        </p>
      </div>
      <button
        onClick={dismiss}
        className="p-1.5 rounded text-amber-200/70 hover:text-amber-200 hover:bg-amber-500/10"
        title="Dismiss for this session"
      >
        <X size={13} />
      </button>
    </div>
  );
}
