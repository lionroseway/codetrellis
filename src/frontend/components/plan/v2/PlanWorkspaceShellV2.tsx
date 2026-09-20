import { useEffect, useState } from 'react';
import { Allotment } from 'allotment';
import { ChevronLeft, Minimize2, Activity as ActivityIcon, ListChecks, PanelRightOpen, MessageCircle, History, ArrowLeft } from 'lucide-react';
import { useUiStore } from '../../../stores/ui-store';
import { usePlanStore } from '../../../stores/plan-store';
import { usePlanItemsStore } from '../../../stores/plan-items-store';
import { useChannelsStore } from '../../../stores/channels-store';
import { StatusBadge } from '../StatusBadge';
import { PlanItemTree } from './PlanItemTree';
import { PlanItemCanvas } from './PlanItemCanvas';
import { PlanActivityDrawer } from './PlanActivityDrawer';
import { PlanItemHistoryDrawer } from './PlanItemHistoryDrawer';
import { PlanHistoryRail } from './PlanHistoryRail';
import { ChannelPanel } from './ChannelPanel';
import { HandoffButton } from './HandoffButton';
import { DriftBadge } from './DriftIndicator';
import { PlanReadinessRing } from './PlanReadinessRing';
import { FreezeBar } from './FreezeBar';
import { ManifestConflictBar } from './ManifestConflictBar';
import { ContributionPanel } from './ContributionPanel';
import { peekCodeReturn, returnToCode, type CodeReturn } from '../../../lib/open-file-at';

/**
 * Phase 15 §15.D — V2 plan workspace shell.
 *
 * Three regions:
 *   - Sidebar tree (PlanItemTree) — mixed Object + Action tree
 *   - Main canvas (PlanItemCanvas) — one item at a time, breadcrumb,
 *     body editor, side rail with metadata
 *   - Activity drawer (PlanActivityDrawer) — plan_events feed
 *     (toggleable to icon-only rail)
 *
 * The only plan workspace (V1 has been removed). Header preserves
 * the minimize-to-chip pattern from 14.B.
 *
 * Entry animation is handled by App.tsx wrapping this in the
 * absolute-positioned z-30 overlay.
 */
export function PlanWorkspaceShellV2() {
  const plan = usePlanStore((s) => s.activePlan);
  const setWorkspaceMode = useUiStore((s) => s.setWorkspaceMode);
  const splitView = useUiStore((s) => s.splitView);
  const toggleSplitView = useUiStore((s) => s.toggleSplitView);
  const activityDrawerOpen = usePlanItemsStore((s) => s.activityDrawerOpen);
  const channelDrawerOpen = useChannelsStore((s) => s.drawerOpen);
  const toggleChannelDrawer = useChannelsStore((s) => s.toggleDrawer);
  const resetChannels = useChannelsStore((s) => s.reset);
  // F1 — count of unresolved channel events, surfaced as a badge on the
  // Channel button so a waiting decision is visible without opening the panel.
  const openChannelCount = useChannelsStore((s) => {
    let n = 0;
    for (const uid in s.eventsByUid) if (s.eventsByUid[uid].status === 'open') n++;
    return n;
  });
  // F13 — reactive item map used to compute toolbar progress (see below).
  const itemsForProgress = usePlanItemsStore((s) => s.itemsByUid);

  // Hydrate the V2 store whenever the active plan changes.
  const hydratePlan = usePlanItemsStore((s) => s.hydratePlan);
  const resetForPlan = usePlanItemsStore((s) => s.resetForPlan);
  const activeStorePlanUid = usePlanItemsStore((s) => s.activePlanUid);
  const selectedItemUid = usePlanItemsStore((s) => s.selectedItemUid);
  const selectItem = usePlanItemsStore((s) => s.selectItem);

  // Whether there is code to go back to. Read once on mount rather than
  // subscribed: the breadcrumb is set before the navigation that brings
  // this shell up, so it is already there by the time this runs.
  const [codeReturn, setCodeReturn] = useState<CodeReturn | null>(null);
  useEffect(() => { setCodeReturn(peekCodeReturn()); }, [selectedItemUid]);

  useEffect(() => {
    if (!plan) return;
    if (activeStorePlanUid !== plan.uid) {
      resetForPlan(plan.uid);
      resetChannels(plan.uid);
    }
    hydratePlan(plan.uid);
    // F1 — hydrate channels even when the Channel panel is closed so the
    // open-event badge is accurate from the moment the plan loads.
    useChannelsStore.getState().hydrate(plan.uid).catch(() => {});
  }, [plan?.uid, activeStorePlanUid, hydratePlan, resetForPlan, resetChannels]);

  // Esc minimizes (matches V1 behaviour from Phase 14.B).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || (t as HTMLElement).isContentEditable)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        setWorkspaceMode('graph');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setWorkspaceMode]);

  // Phase 6.2 — Plan history rail toggle.
  const [historyRailOpen, setHistoryRailOpen] = useState(false);

  // F10 — let the MCP `toggle_panel('history')` tool drive the history rail
  // (its open state is local to this component, so it listens for an event).
  useEffect(() => {
    const onToggle = () => setHistoryRailOpen((v) => !v);
    window.addEventListener('toggle-history-rail', onToggle);
    return () => window.removeEventListener('toggle-history-rail', onToggle);
  }, []);

  // Entrance animation (matches V1 takeover).
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(t);
  }, []);

  if (!plan) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-[#070810] text-foreground-subtle text-sm gap-2">
        <p>No plan selected.</p>
        <button className="text-accent text-[12px] hover:text-accent-hover" onClick={() => setWorkspaceMode('graph')}>
          ← Back to graph
        </button>
      </div>
    );
  }

  // F13 — derive progress from the live V2 item tree (kind === 'action'),
  // the same source the progress card uses. The legacy plan.taskCount/
  // completedTaskCount fields are stale on V2 plans (often 0/0), which made
  // the toolbar contradict the card.
  const actions = Object.values(itemsForProgress).filter((i) => i.kind === 'action');
  const doneActions = actions.filter((a) => a.status === 'done').length;
  const progress = actions.length ? Math.round((doneActions / actions.length) * 100) : 0;

  return (
    <div
      className={`flex flex-col h-full bg-[#070810] origin-bottom transition-all duration-300 ease-out ${
        shown ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-[0.985] translate-y-2'
      }`}
    >
      {/* Header */}
      <div className="border-b border-white/[0.06] px-4 py-2 flex items-center gap-3 bg-[#0a0b14]">
        <button
          onClick={() => setWorkspaceMode('graph')}
          className="flex items-center gap-1.5 text-[12.5px] text-foreground-subtle hover:text-foreground transition-colors px-2.5 py-1 rounded hover:bg-white/[0.04]"
          title="Minimize plan workspace (Esc) — plan stays selected, click the floating chip to restore"
        >
          <ChevronLeft size={13} />
          <Minimize2 size={13} />
        </button>
        {/*
          The way back to the code you came from.

          Only rendered when there IS a way back — arriving here from the
          graph or the plan list leaves no breadcrumb, and a disabled
          "back" pointing nowhere is worse than no control. See
          `lib/open-file-at`.
        */}
        {codeReturn && (
          <button
            onClick={() => { void returnToCode().then((ok) => { if (ok) setCodeReturn(null); }); }}
            className="flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded border border-accent/25 bg-accent/[0.07] text-accent hover:bg-accent/[0.14] transition-colors"
            title={`Back to ${codeReturn.filePath}${codeReturn.line ? `:${codeReturn.line}` : ''}`}
          >
            <ArrowLeft size={12} />
            <span className="font-mono text-[11.5px] truncate max-w-[16ch]">{codeReturn.label}</span>
          </button>
        )}
        <div className="h-5 w-px bg-white/[0.08]" />
        <ListChecks size={12} className="text-accent shrink-0" />
        {/*
          The plan's name is the way back to the plan's own page.

          Opening an item set `selectedItemUid` and nothing ever cleared
          it: `selectItem(null)` had no caller in any component, and
          `navigateBack` only one, in a WebSocket handler. So the plan
          page — its description, its budget chip, its ticket chip, the
          shared/local toggle and the revision history, all of which live
          only there — became unreachable the moment you clicked a task,
          for the rest of the session. Clicking the document's name to
          get to the document is how every editor behaves; it just was
          not wired.
        */}
        <button
          onClick={() => selectItem(null)}
          disabled={!selectedItemUid}
          className="text-[13px] font-semibold text-foreground truncate flex-1 min-w-0 text-left rounded px-1 -mx-1 transition-colors enabled:hover:text-accent enabled:hover:bg-white/[0.04] disabled:cursor-default"
          title={selectedItemUid ? `Back to ${plan.title}` : plan.title}
        >
          {plan.title}
        </button>
        <span className="text-[11px] uppercase tracking-wider text-accent bg-accent/10 px-1.5 py-0.5 rounded border border-accent/30">
          V2
        </span>
        <StatusBadge status={plan.status} />
        <div className="flex items-center gap-2 text-[12px] text-foreground-subtle">
          <span>{doneActions}/{actions.length} actions</span>
          <div className="h-1.5 w-24 rounded-full bg-white/[0.05] overflow-hidden">
            <div className="h-full bg-accent/60 rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
          <span>{progress}%</span>
        </div>
        {/* Phase 17.G — Plan readiness score */}
        <PlanReadinessRing />
        {/* Phase 17.L — Drift detection badge */}
        <DriftBadge planUid={plan.uid} />
        {/* Phase 17.H — Hand off to agent */}
        <HandoffButton />
        <button
          onClick={toggleSplitView}
          className={`flex items-center gap-1.5 px-2.5 py-1 text-[12px] rounded-md border transition-colors ${
            splitView
              ? 'border-accent/30 bg-accent/10 text-accent'
              : 'border-white/[0.08] text-foreground-muted hover:text-foreground hover:bg-white/[0.04]'
          }`}
          title="Toggle split view (workspace + graph side by side)"
        >
          <PanelRightOpen size={12} />
          Graph
        </button>
        <button
          onClick={() => usePlanItemsStore.getState().toggleActivityDrawer()}
          className={`flex items-center gap-1.5 px-2.5 py-1 text-[12px] rounded-md border transition-colors ${
            activityDrawerOpen
              ? 'border-accent/30 bg-accent/10 text-accent'
              : 'border-white/[0.08] text-foreground-muted hover:text-foreground hover:bg-white/[0.04]'
          }`}
          title="Toggle activity drawer"
        >
          <ActivityIcon size={12} />
          Activity
        </button>
        <button
          onClick={toggleChannelDrawer}
          className={`flex items-center gap-1.5 px-2.5 py-1 text-[12px] rounded-md border transition-colors ${
            channelDrawerOpen
              ? 'border-accent/30 bg-accent/10 text-accent'
              : 'border-white/[0.08] text-foreground-muted hover:text-foreground hover:bg-white/[0.04]'
          }`}
          title={openChannelCount > 0
            ? `Toggle channel — ${openChannelCount} open event${openChannelCount === 1 ? '' : 's'} need attention`
            : 'Toggle channel — peer-to-peer team coordination events'}
        >
          <MessageCircle size={12} />
          Channel
          {openChannelCount > 0 && (
            <span className="ml-0.5 min-w-[16px] h-[16px] px-1 inline-flex items-center justify-center rounded-full bg-amber-500/90 text-[10px] font-semibold text-black leading-none">
              {openChannelCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setHistoryRailOpen(!historyRailOpen)}
          className={`flex items-center gap-1.5 px-2.5 py-1 text-[12px] rounded-md border transition-colors ${
            historyRailOpen
              ? 'border-accent/30 bg-accent/10 text-accent'
              : 'border-white/[0.08] text-foreground-muted hover:text-foreground hover:bg-white/[0.04]'
          }`}
          title="Toggle plan history — time-travel through commits"
        >
          <History size={12} />
          History
        </button>
      </div>

      {/* Phase 6.5 — Freeze bar */}
      <FreezeBar planUid={plan.uid} />

      {/* Phase 29 §4.9 — Phase 6.4 built conflict detection AND
          resolution and neither client ever called either endpoint.
          Sits below the freeze bar: a freeze is a policy you chose, a
          conflict is the plan files being unreadable until it is
          settled, so it reads last and louder. */}
      <ManifestConflictBar />

      {/* Phase 29 §4.15 — Phase 7.2's contributor staging area. This
          component existed and nothing imported it, which is why the
          §2 audit thought /api/contributions was surfaced. It renders
          nothing unless the current branch has staged contributions. */}
      <ContributionPanel />

      {/* Three regions */}
      <div className="flex-1 min-h-0">
        <Allotment>
          <Allotment.Pane preferredSize={300} minSize={220}>
            <PlanItemTree planUid={plan.uid} />
          </Allotment.Pane>
          <Allotment.Pane minSize={400}>
            <PlanItemCanvas />
          </Allotment.Pane>
          {activityDrawerOpen && (
            <Allotment.Pane preferredSize={320} minSize={240} maxSize={500}>
              <PlanActivityDrawer />
            </Allotment.Pane>
          )}
          {channelDrawerOpen && (
            <Allotment.Pane preferredSize={340} minSize={260} maxSize={520}>
              <ChannelPanel planUid={plan.uid} />
            </Allotment.Pane>
          )}
          {historyRailOpen && (
            <Allotment.Pane preferredSize={320} minSize={240} maxSize={480}>
              <PlanHistoryRail
                planSlug={makePlanSlugFrontend(plan.title, plan.uid)}
                onClose={() => setHistoryRailOpen(false)}
              />
            </Allotment.Pane>
          )}
        </Allotment>
      </div>

      <PlanItemHistoryDrawer />
    </div>
  );
}

/** Frontend-side slug generation — mirrors backend makePlanSlug(). */
function makePlanSlugFrontend(title: string, uid: string): string {
  const titlePart = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'plan';
  const uidSuffix = uid.split('-')[0];
  return `${titlePart}-${uidSuffix}`;
}
