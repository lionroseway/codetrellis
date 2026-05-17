import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { History, X, RotateCcw } from 'lucide-react';
import { usePlanItemsStore } from '../../../stores/plan-items-store';
import { useToastStore } from '../../../stores/toast-store';
import type { PlanItemVersion, PlanEvent } from '@shared/types';

/**
 * Phase 15 §15.D — per-item history drawer.
 *
 * Modal-style overlay that shows the item's `plan_item_versions` log
 * + scoped `plan_events` for the item. Restoring a version posts to
 * /api/items/:uid/restore-version/:version (which writes a new
 * version row + an item_restored event).
 *
 * This is the basic v1 of the drawer — full body diffing lands later.
 */
export function PlanItemHistoryDrawer() {
  const itemUid = usePlanItemsStore((s) => s.historyDrawerItemUid);
  const close = () => usePlanItemsStore.getState().openHistoryDrawer(null);
  const itemsByUid = usePlanItemsStore((s) => s.itemsByUid);

  const [versions, setVersions] = useState<PlanItemVersion[]>([]);
  const [events, setEvents] = useState<PlanEvent[]>([]);
  const [restoring, setRestoring] = useState<number | null>(null);
  const addToast = useToastStore((s) => s.addToast);

  useEffect(() => {
    if (!itemUid) return;
    let cancelled = false;
    Promise.all([
      fetch(`/api/items/${itemUid}/versions`).then((r) => r.ok ? r.json() : []),
      fetch(`/api/items/${itemUid}/events`).then((r) => r.ok ? r.json() : []),
    ]).then(([v, e]) => {
      if (cancelled) return;
      setVersions(Array.isArray(v) ? v : []);
      setEvents(Array.isArray(e) ? e : []);
    });
    return () => { cancelled = true; };
  }, [itemUid]);

  if (!itemUid) return null;
  const item = itemsByUid[itemUid];

  const restore = async (version: number) => {
    setRestoring(version);
    try {
      const res = await fetch(`/api/items/${itemUid}/restore-version/${version}`, { method: 'POST' });
      if (!res.ok) throw new Error('restore failed');
      addToast({ type: 'success', title: `Restored v${version}`, message: 'Item rolled back.', duration: 4000 });
      // Re-fetch versions to show the new "post-restore" version row.
      const next = await fetch(`/api/items/${itemUid}/versions`).then((r) => r.ok ? r.json() : []);
      setVersions(Array.isArray(next) ? next : []);
    } catch (err) {
      addToast({ type: 'error', title: 'Restore failed', message: String(err) });
    } finally {
      setRestoring(null);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm" onClick={close}>
      <div
        className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-2xl border border-white/[0.08] bg-[#0b1020] shadow-[0_24px_80px_rgba(0,0,0,0.6)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2">
            <History size={13} className="text-accent" />
            History · {item?.title ?? 'item'}
          </h3>
          <button onClick={close} className="p-1.5 rounded-md text-foreground-subtle hover:text-foreground hover:bg-white/[0.05]">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-[11px]">
          {/* Versions */}
          <section>
            <div className="text-[10px] uppercase tracking-wider text-foreground-subtle font-medium mb-2">
              Versions ({versions.length})
            </div>
            {versions.length === 0 ? (
              <p className="text-foreground-subtle italic">No versions yet.</p>
            ) : (
              <div className="space-y-1">
                {versions.map((v) => (
                  <div key={v.id} className="rounded-md border border-white/[0.06] bg-white/[0.015] p-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-foreground-subtle bg-white/[0.04] px-1 rounded shrink-0">
                        v{v.version}
                      </span>
                      <span className="text-foreground-muted truncate flex-1">{v.changeSummary || '—'}</span>
                      <button
                        onClick={() => restore(v.version)}
                        disabled={restoring === v.version}
                        className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded text-accent hover:bg-accent/10 disabled:opacity-50"
                        title={`Restore item to v${v.version}`}
                      >
                        <RotateCcw size={9} />
                        {restoring === v.version ? '…' : 'Restore'}
                      </button>
                    </div>
                    <div className="flex items-center gap-2 text-[9.5px] text-foreground-subtle mt-1">
                      <span>{v.author}</span>
                      <span>·</span>
                      <span>{new Date(v.createdAt).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Events */}
          <section>
            <div className="text-[10px] uppercase tracking-wider text-foreground-subtle font-medium mb-2">
              Events ({events.length})
            </div>
            {events.length === 0 ? (
              <p className="text-foreground-subtle italic">No structural events yet.</p>
            ) : (
              <div className="space-y-1">
                {events.map((e) => (
                  <div key={e.id} className="rounded-md border border-white/[0.04] bg-white/[0.01] p-2">
                    <div className="flex items-center gap-2 text-[9.5px] text-foreground-subtle">
                      <span className="font-mono">{e.eventType}</span>
                      <span>·</span>
                      <span>{e.author}</span>
                      <span className="ml-auto opacity-60">{new Date(e.createdAt).toLocaleTimeString()}</span>
                    </div>
                    <div className="text-[10.5px] text-foreground mt-0.5">{e.summary}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
