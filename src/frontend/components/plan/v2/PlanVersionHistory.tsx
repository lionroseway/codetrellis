import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { History, X, Bot, User } from 'lucide-react';
import type { Plan, PlanVersion } from '@shared/types';

/**
 * Phase 29 §4.8 — plan-level version history.
 *
 * `plan_versions` gets a row on create and on every `updatePlan`, each
 * carrying a full JSON snapshot of the plan plus a change summary and
 * an author. `/api/plans/:uid/versions` has served them since Phase 3
 * and nothing read it.
 *
 * The sibling table `plan_item_versions` was already surfaced by
 * `PlanItemHistoryDrawer` (Phase 15 §15.D), which is why this is a
 * smaller job than the register's "large" estimate. This is the
 * plan-level half.
 *
 * **Read-only, on purpose.** Items have
 * `POST /api/items/:uid/restore-version/:version`; plans have no such
 * endpoint. Rather than invent one, this shows what changed and when.
 * A Restore button that silently did nothing, or a rollback written
 * here rather than in the service that owns plan mutation, would both
 * be worse than the honest answer.
 *
 * What it adds over a bare list is the diff: a `changeSummary` reading
 * "title, status updated" says which fields moved but not what they
 * moved to, and the snapshots have the answer already.
 */

/** Fields worth diffing. The rest of a Plan snapshot is bookkeeping. */
const TRACKED: Array<{ key: keyof Plan; label: string }> = [
  { key: 'title', label: 'Title' },
  { key: 'status', label: 'Status' },
  { key: 'description', label: 'Description' },
  { key: 'homeRepo', label: 'Home repo' },
];

export interface FieldChange {
  label: string;
  from: string;
  to: string;
}

/**
 * A snapshot is a JSON string; a malformed one is data, not a crash.
 *
 * **Two shapes exist in this column.** `updatePlan` has always written
 * the bare plan, but `createPlan` wrote `{ plan, tasks }` for v1 until
 * Phase 29 §4.8 — so diffing v2 against v1 compared a plan to a
 * wrapper and reported every field as changed from nothing. The writer
 * is fixed, but rows in existing databases still carry the wrapper, so
 * unwrap it here: that is the half that works for plans people already
 * have.
 */
export function parseSnapshot(snapshot: string): Partial<Plan> | null {
  try {
    const parsed = JSON.parse(snapshot);
    if (!parsed || typeof parsed !== 'object') return null;
    const wrapped = (parsed as { plan?: unknown }).plan;
    if (wrapped && typeof wrapped === 'object') return wrapped as Partial<Plan>;
    return parsed as Partial<Plan>;
  } catch {
    return null;
  }
}

function show(value: unknown): string {
  if (value === undefined || value === null || value === '') return '(empty)';
  return String(value);
}

/**
 * What changed between two snapshots. `previous` is null for v1, where
 * every field is an initial value rather than a change — so v1 reports
 * nothing and the UI labels it "created" instead.
 */
export function diffSnapshots(
  current: string,
  previous: string | null,
): FieldChange[] | null {
  const now = parseSnapshot(current);
  if (!now) return null;
  if (previous === null) return [];
  const before = parseSnapshot(previous);
  if (!before) return null;

  const changes: FieldChange[] = [];
  for (const { key, label } of TRACKED) {
    const a = before[key];
    const b = now[key];
    if (show(a) === show(b)) continue;
    changes.push({ label, from: show(a), to: show(b) });
  }
  return changes;
}

export function PlanVersionHistory({
  planUid,
  planTitle,
  onClose,
}: {
  planUid: string;
  planTitle: string;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<PlanVersion[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/plans/${planUid}/versions`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<PlanVersion[]>;
      })
      .then((v) => { if (!cancelled) setVersions(Array.isArray(v) ? v : []); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [planUid]);

  // The endpoint orders newest first; the diff for a row needs the row
  // below it, which is the one before it in time.
  const previousOf = useMemo(() => {
    const map = new Map<number, string | null>();
    (versions ?? []).forEach((v, i) => {
      map.set(v.version, versions![i + 1]?.snapshot ?? null);
    });
    return map;
  }, [versions]);

  const toggle = useCallback((version: number) => {
    setOpen((v) => (v === version ? null : version));
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl max-h-[80vh] flex flex-col rounded-2xl border border-white/[0.08] bg-[#0b1020] shadow-[0_24px_80px_rgba(0,0,0,0.6)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2 min-w-0">
            <History size={13} className="text-accent shrink-0" />
            <span className="truncate">Plan history · {planTitle}</span>
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-foreground-subtle hover:text-foreground hover:bg-white/[0.05] shrink-0"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-1.5">
          {error && (
            <p className="text-[11.5px] text-red-300">Could not load history — {error}</p>
          )}

          {versions !== null && versions.length === 0 && !error && (
            <p className="text-[11.5px] text-foreground-subtle italic">
              No versions recorded.
            </p>
          )}

          {(versions ?? []).map((v) => {
            const changes = diffSnapshots(v.snapshot, previousOf.get(v.version) ?? null);
            const isOpen = open === v.version;
            const isFirst = previousOf.get(v.version) === null;
            const Icon = v.author === 'human' ? User : Bot;
            return (
              <div
                key={v.id}
                className="rounded-lg border border-white/[0.06] bg-white/[0.015] overflow-hidden"
              >
                <button
                  onClick={() => toggle(v.version)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.03] transition-colors"
                >
                  <span className="text-[10px] font-mono text-foreground-subtle bg-white/[0.05] px-1.5 py-0.5 rounded shrink-0">
                    v{v.version}
                  </span>
                  <span className="text-[11.5px] text-foreground-muted truncate flex-1">
                    {isFirst ? 'Plan created' : (v.changeSummary || '—')}
                  </span>
                  <Icon size={10} className="text-foreground-subtle shrink-0" />
                  <span className="text-[10px] text-foreground-subtle shrink-0">
                    {new Date(v.createdAt).toLocaleString()}
                  </span>
                </button>

                {isOpen && (
                  <div className="px-3 pb-2.5 pt-1 border-t border-white/[0.05] space-y-1.5">
                    {changes === null ? (
                      <p className="text-[11px] text-foreground-subtle italic">
                        This version&apos;s snapshot could not be read, so there is nothing to
                        compare. The summary above is what was recorded.
                      </p>
                    ) : changes.length === 0 ? (
                      <p className="text-[11px] text-foreground-subtle italic">
                        {isFirst
                          ? 'The starting state — nothing before it to compare against.'
                          : 'No change to the plan’s own fields. Items and docs version separately.'}
                      </p>
                    ) : (
                      changes.map((c) => (
                        <div key={c.label} className="text-[11px]">
                          <div className="text-[9.5px] uppercase tracking-wider text-foreground-subtle">
                            {c.label}
                          </div>
                          <div className="flex items-start gap-2 font-mono">
                            <span className="text-red-300/70 line-through break-all flex-1 min-w-0">
                              {c.from}
                            </span>
                            <span className="text-emerald-300/90 break-all flex-1 min-w-0">
                              {c.to}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                    <p className="text-[9.5px] text-foreground-subtle pt-1">
                      Recorded by {v.author}.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t border-white/[0.06]">
          <p className="text-[10px] text-foreground-subtle leading-relaxed">
            This is the plan&apos;s own history — title, status, description. Each item keeps its
            own, reachable from the item&apos;s History button.
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
