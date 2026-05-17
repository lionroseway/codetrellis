import {
  Activity, MessageSquare, AlertTriangle, HelpCircle, CheckCircle2, Loader2, Ban,
  Pencil, Plus, Move, Trash2, RotateCcw, Hash, ListPlus,
} from 'lucide-react';
import { usePlanItemsStore } from '../../../stores/plan-items-store';
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
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
        <Activity size={12} className="text-foreground-subtle shrink-0" />
        <span className="text-[12px] font-semibold text-foreground uppercase tracking-wider">
          Activity
        </span>
        <span className="text-[11px] text-foreground-subtle">({events.length})</span>
        <div className="flex-1" />
        <button
          onClick={toggle}
          className="p-1 rounded hover:bg-white/[0.05] text-foreground-subtle hover:text-foreground text-[10px]"
          title="Collapse"
        >
          ›
        </button>
      </div>

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
