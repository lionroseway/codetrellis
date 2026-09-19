import { useCallback, useEffect, useRef, useState } from 'react';
import { Ticket, ExternalLink, Info } from 'lucide-react';
import type { Plan } from '@shared/types';

/**
 * Linked tickets that have drifted from the plan — Phase 29.
 *
 * See [docs/PHASE-29-SURFACING-WHAT-WE-COLLECT.md](../../../../../docs/PHASE-29-SURFACING-WHAT-WE-COLLECT.md).
 *
 * Phase 24 built the whole intake path — epics flattened into nested
 * plans, ticket keys at every level, a watermark so "what changed since
 * the last sync" is answerable — and left it reachable only through the
 * `get_external_sync_state` MCP tool. The "3 tickets need updating"
 * signal existed as data and appeared nowhere. Phase 29 added
 * `/api/plans/:uid/external-sync` because there was not even a REST
 * endpoint to wire.
 *
 * ## CodeTrellis does not hold a tracker credential, and must not act
 * like it does
 *
 * That is the settled Phase 24 posture: the **agent** holds the Jira or
 * Linear MCP and does the writing. So this chip has no "sync now"
 * button, and never will — it would be an affordance for something this
 * process cannot do.
 *
 * The suggested transition is advisory for the same reason, and the
 * service says so where it is computed: every tracker has its own
 * workflow, and the agent knows the real transition names. Guessing them
 * here would be inventing a workflow we cannot see. The popover presents
 * them as "probably wants", never as an instruction.
 *
 * ## Never synced is not the same as up to date
 *
 * A null watermark means the plan has never been synced, so **every**
 * item with a ticket key counts as changed. That is the correct first
 * run, and the copy says "not synced yet" rather than reporting a
 * drift count that would look like a backlog.
 */

interface SyncStateEntry {
  itemUid: string;
  title: string;
  status: string | null;
  externalKey: string;
  url: string;
  updatedAt: number;
  suggestedTransition: string | null;
}

interface SyncState {
  planUid: string;
  lastSyncedAt: number | null;
  changed: SyncStateEntry[];
  /**
   * `externalKey` is `string | null` on the backend — `keyFromUrl` only
   * recognises Jira, Linear and GitHub, and returns null for the Azure
   * DevOps, Shortcut and wiki URLs the intake service also accepts.
   * Declaring it non-null here did not make it so: it rendered an anchor
   * with no text, which is a link the user can neither see nor click.
   */
  planRefs: Array<{ externalKey: string | null; url: string; title?: string | null }>;
}

function formatWhen(ts: number): string {
  const age = Date.now() - ts;
  if (age < 60_000) return 'just now';
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}m ago`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h ago`;
  return `${Math.floor(age / 86_400_000)}d ago`;
}

export function PlanTicketSyncChip({ plan }: { plan: Plan }) {
  const [state, setState] = useState<SyncState | null>(null);
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/plans/${encodeURIComponent(plan.uid)}/external-sync`);
      if (!res.ok) return;
      setState((await res.json()) as SyncState);
    } catch {
      // Silent. A plan with no linked tickets renders no chip; a failed
      // fetch should look the same rather than becoming an error.
    }
  }, [plan.uid]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // No linked tickets at all — this plan did not come from a tracker, so
  // there is nothing to say and no chip to show.
  if (!state || (state.changed.length === 0 && state.planRefs.length === 0)) return null;

  const neverSynced = state.lastSyncedAt === null;
  const count = state.changed.length;
  const hasDrift = count > 0;

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 px-2.5 py-1 rounded-full border transition-colors ${
          hasDrift
            ? 'border-amber-500/30 bg-amber-500/[0.08] text-amber-300 hover:bg-amber-500/15'
            : 'border-white/[0.08] bg-white/[0.02] text-foreground-subtle hover:bg-white/[0.04]'
        }`}
        title="Linked tickets and whether they have drifted from this plan"
      >
        <Ticket size={12} />
        <span className="text-[12.5px]">
          {!hasDrift
            ? 'Tickets in step'
            : neverSynced
              ? `${count} ticket${count === 1 ? '' : 's'} · not synced yet`
              : `${count} ticket${count === 1 ? '' : 's'} to update`}
        </span>
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute left-0 top-full mt-1.5 w-96 z-50 bg-surface-solid/95 backdrop-blur-xl border border-white/[0.08] rounded-lg shadow-[0_0_20px_rgba(0,0,0,0.5)] p-3 text-[11.5px]"
        >
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <span className="text-foreground font-medium">Linked tickets</span>
            <span className="text-foreground-subtle shrink-0">
              {neverSynced ? 'never synced' : `synced ${formatWhen(state.lastSyncedAt!)}`}
            </span>
          </div>

          {state.planRefs.length > 0 && (
            <div className="mb-2 text-foreground-subtle">
              This plan came from{' '}
              {state.planRefs.map((r, i) => (
                // Keyed on the URL: the external key is null for several
                // of the trackers this accepts, so several siblings
                // shared `key={null}` and React reconciled them by
                // position.
                <span key={r.url}>
                  {i > 0 && ', '}
                  <a
                    href={r.url} target="_blank" rel="noreferrer"
                    className="text-accent hover:underline font-mono"
                  >
                    {r.externalKey || r.title || r.url}
                  </a>
                </span>
              ))}
            </div>
          )}

          {!hasDrift ? (
            <p className="text-foreground-subtle/70 leading-snug">
              Nothing has moved since the last sync.
            </p>
          ) : (
            <>
              <p className="mb-2 text-foreground-subtle/70 leading-snug">
                {neverSynced
                  ? 'This plan has not been synced yet, so everything with a ticket key is listed.'
                  : 'These items have moved since the last sync.'}
              </p>
              <ul className="space-y-1.5 max-h-56 overflow-y-auto">
                {state.changed.map((entry) => (
                  <li key={entry.itemUid} className="flex items-baseline gap-2">
                    <a
                      href={entry.url} target="_blank" rel="noreferrer"
                      className="font-mono text-accent hover:underline shrink-0 inline-flex items-center gap-1"
                    >
                      {entry.externalKey}
                      <ExternalLink size={9} className="opacity-60" />
                    </a>
                    <span className="text-foreground-muted truncate flex-1">{entry.title}</span>
                    {entry.suggestedTransition && (
                      <span className="text-foreground-subtle/60 shrink-0">
                        → {entry.suggestedTransition}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* No "sync now" button, deliberately — see the header. */}
          <p className="mt-2.5 pt-2 border-t border-white/[0.06] flex gap-1.5 text-foreground-subtle/70 leading-snug">
            <Info size={11} className="shrink-0 mt-px" />
            <span>
              CodeTrellis holds no tracker credential. Ask your agent to push
              these — it has the Jira or Linear MCP, and knows the real
              transition names. Anything shown here is a guess at what they
              probably want.
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
