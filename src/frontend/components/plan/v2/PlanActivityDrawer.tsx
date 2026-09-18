import { useState } from 'react';
import {
  Activity, CheckCircle2, Loader2, 
  Pencil, Plus, Move, Trash2, RotateCcw, Hash, ListPlus, Zap, Users,
} from 'lucide-react';
import { usePlanItemsStore } from '../../../stores/plan-items-store';
import { ExecutionDashboard } from './ExecutionDashboard';
import { TeamActivityPanel } from './TeamActivityPanel';
import type { PlanEvent, PlanEventType } from '@shared/types';

const EVENT_META: Record<PlanEventType, { Icon: typeof Activity; tint: string; label: string }> = {
  item_created:        { Icon: Plus,           tint: 'text-green-300',     label: 'Created' },
  item_moved:          { Icon: Move,           tint: 'text-cyan-300',      label: 'Moved' },
  item_deleted:        { Icon: Trash2,         tint: 'text-red-300',       label: 'Deleted' },
  item_restored:       { Icon: RotateCcw,      tint: 'text-emerald-300',   label: 'Restored' },
  item_renamed:        { Icon: Pencil,         tint: 'text-foreground-muted', label: 'Renamed' },
  reparented:          { Icon: Move,           tint: 'text-cyan-300',      label: 'Reparented' },
  reordered:           { Icon: ListPlus,       tint: 'text-foreground-muted', label: 'Reordered' },
  status_changed:      { Icon: Loader2,        tint: 'text-accent',        label: 'Status' },
  kind_transmuted:     { Icon: Hash,           tint: 'text-foreground-muted', label: 'Kind changed' },
  plan_status_changed: { Icon: CheckCircle2,   tint: 'text-green-300',     label: 'Plan status' },
};

/**
 * Phase 15 §15.D — right rail. Real-time chronological feed of
 * `plan_events` for the active plan, hydrated by the store from
 * /api/plans/:uid/timeline + WS plan-event events. Click a row to
 * jump to the affected item.
 */
export function PlanActivityDrawer() {
  const events = usePlanItemsStore((s) => s.events);
  const itemsByUid = usePlanItemsStore((s) => s.itemsByUid);
  const selectItem = usePlanItemsStore((s) => s.selectItem);
  const open = usePlanItemsStore((s) => s.activityDrawerOpen);
  const toggle = usePlanItemsStore((s) => s.toggleActivityDrawer);
  // Phase 29 §4.15 — "Team" joins the two tabs that were already here.
  // TeamActivityPanel (Phase 6.1) was written and never rendered, and
  // its header says "accessible from the plan workspace as a
  // drawer/tab" — so this is where it was meant to go. A fifth toggle
  // in the shell header reading "Team Activity" next to the existing
  // "Activity" would have been two buttons a user has to tell apart;
  // as a tab, the distinction is visible at the point of choosing.
  //
  // They really are different questions: Activity is this plan's
  // `plan_events` from the database, Team is the git history of
  // `.codetrellis/` across the whole project — who changed what, in
  // commits, including plans this one knows nothing about.
  const [tab, setTab] = useState<'activity' | 'live' | 'team'>('activity');

  if (!open) {
    // Collapsed — show a slim icon-only rail
    return (
      <div className="h-full w-8 border-l border-white/[0.06] bg-[#080915] flex flex-col items-center py-3">
        <button
          onClick={toggle}
          className="p-1.5 rounded hover:bg-white/[0.05] text-foreground-subtle hover:text-foreground"
          title="Open activity drawer"
        >
          <Activity size={13} />
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col border-l border-white/[0.06] bg-[#080915] min-w-0">
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-white/[0.06]">
        {/* Tab buttons */}
        <button
          onClick={() => setTab('activity')}
          className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-md transition-colors ${
            tab === 'activity'
              ? 'bg-white/[0.05] text-foreground font-medium'
              : 'text-foreground-subtle hover:text-foreground-muted'
          }`}
        >
          <Activity size={11} />
          Activity
          {events.length > 0 && <span className="text-[10px] opacity-60">({events.length})</span>}
        </button>
        <button
          onClick={() => setTab('live')}
          className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-md transition-colors ${
            tab === 'live'
              ? 'bg-white/[0.05] text-foreground font-medium'
              : 'text-foreground-subtle hover:text-foreground-muted'
          }`}
        >
          <Zap size={11} />
          Live
        </button>
        <button
          onClick={() => setTab('team')}
          className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-md transition-colors ${
            tab === 'team'
              ? 'bg-white/[0.05] text-foreground font-medium'
              : 'text-foreground-subtle hover:text-foreground-muted'
          }`}
          title="What the rest of the team changed in .codetrellis/, from git"
        >
          <Users size={11} />
          Team
        </button>
        <div className="flex-1" />
        <button
          onClick={toggle}
          className="p-1 rounded hover:bg-white/[0.05] text-foreground-subtle hover:text-foreground text-[10px]"
          title="Collapse"
        >
          ›
        </button>
      </div>

      {tab === 'activity' ? (
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {events.length === 0 ? (
            <p className="text-[12px] text-foreground-subtle italic px-2 py-4 text-center">
              Quiet. Item events will land here in real time.
            </p>
          ) : (
            events.map((e) => (
              <EventRow
                key={e.id}
                event={e}
                affectedTitle={e.itemUid ? itemsByUid[e.itemUid]?.title : undefined}
                onClick={() => e.itemUid && selectItem(e.itemUid)}
              />
            ))
          )}
        </div>
      ) : tab === 'live' ? (
        <div className="flex-1 overflow-y-auto">
          <ExecutionDashboard />
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <TeamActivityPanel />
        </div>
      )}
    </div>
  );
}

function EventRow({ event, affectedTitle, onClick }: { event: PlanEvent; affectedTitle?: string; onClick: () => void }) {
  const meta = EVENT_META[event.eventType] ?? EVENT_META.item_renamed;
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-md border border-white/[0.04] bg-white/[0.015] px-2 py-1.5 hover:bg-white/[0.03] transition-colors"
    >
      <div className="flex items-start gap-2">
        <meta.Icon size={11} className={`${meta.tint} shrink-0 mt-0.5`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[11.5px]">
            <span className={`font-medium ${meta.tint}`}>{meta.label}</span>
            <span className="text-foreground-subtle">·</span>
            <span className="text-foreground-muted">{event.author}</span>
            <span className="ml-auto text-foreground-subtle opacity-60">
              {new Date(event.createdAt).toLocaleTimeString()}
            </span>
          </div>
          <div className="text-[12.5px] text-foreground mt-0.5 truncate">
            {event.summary}
          </div>
          {affectedTitle && (
            <div className="text-[11.5px] text-foreground-subtle truncate mt-0.5">
              → {affectedTitle}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
