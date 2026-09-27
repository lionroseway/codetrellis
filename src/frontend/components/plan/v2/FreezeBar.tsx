/**
 * FreezeBar — Phase 6.5.
 *
 * An amber banner that appears across the plan workspace when the
 * project has an active freeze period. Shows the reason and expiry.
 * Non-exempt plans show a "frozen" badge.
 */

import { useCallback, useEffect, useState } from 'react';
import { ShieldAlert, Clock, X, Flag } from 'lucide-react';
import { useProjectStore } from '../../../stores/project-store';
import { describeFreezeChange, type FreezeSettings } from '../../../../shared/lib/freeze-words';

/** An agent's change to the freeze that no person has acknowledged (§0.4k). */
interface FlaggedFreezeChange {
  id: number;
  actor: string;
  before: FreezeSettings | null;
  after: FreezeSettings;
  at: number;
}

interface FreezeStatus {
  active: boolean;
  reason: string | null;
  since: string | null;
  until: string | null;
  expired: boolean;
  allowedPlanUids: string[];
  remainingMs: number | null;
  flaggedChanges?: FlaggedFreezeChange[];
}

function formatRemaining(ms: number | null): string | null {
  if (ms === null) return null;
  if (ms <= 0) return 'expired';
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h remaining`;
  if (hours > 0) return `${hours}h remaining`;
  return `${Math.ceil(ms / 60_000)}m remaining`;
}

export function FreezeBar({ planUid }: { planUid?: string }) {
  const projectPath = useProjectStore((s) => s.root);
  const [freeze, setFreeze] = useState<FreezeStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const fetchFreeze = useCallback(async () => {
    if (!projectPath) return;
    try {
      const res = await fetch(`/api/freeze?project=${encodeURIComponent(projectPath)}`);
      if (res.ok) setFreeze(await res.json());
    } catch { /* ignore */ }
  }, [projectPath]);

  useEffect(() => {
    void fetchFreeze();
    // Re-check periodically for auto-expiry
    const interval = setInterval(() => void fetchFreeze(), 60_000);
    // Live: an agent's set_freeze, another window's change, an acknowledgement.
    const onChanged = () => { setDismissed(false); void fetchFreeze(); };
    window.addEventListener('freeze-changed', onChanged);
    return () => {
      clearInterval(interval);
      window.removeEventListener('freeze-changed', onChanged);
    };
  }, [fetchFreeze]);

  const acknowledge = async (id: number) => {
    const res = await fetch(`/api/freeze/changes/${id}/acknowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath }),
    });
    if (res.ok) await fetchFreeze();
  };

  const flagged = freeze?.flaggedChanges ?? [];
  // Shown while there is an agent's change to see, frozen or not: an agent
  // lifting the freeze is the change most worth seeing, and it is exactly
  // the one that made this bar disappear (owner's decision, §0.4k).
  if (!freeze || (!freeze.active && flagged.length === 0) || (dismissed && flagged.length === 0)) return null;

  const isExempt = planUid ? freeze.allowedPlanUids.includes(planUid) : false;
  const remaining = formatRemaining(freeze.remainingMs);

  return (
    <div data-testid="freeze-bar">
    {freeze.active && !dismissed && (
    <div className={`flex items-center gap-2 px-3 py-1.5 text-xs border-b ${
      isExempt
        ? 'bg-emerald-950/30 border-emerald-800/30 text-emerald-300'
        : 'bg-amber-950/30 border-amber-800/30 text-amber-300'
    }`}>
      <ShieldAlert size={13} className="shrink-0" />
      <span className="font-medium">
        {isExempt ? 'Freeze active (this plan is exempt)' : 'Project frozen'}
      </span>
      {freeze.reason && (
        <span className="text-foreground-muted">— {freeze.reason}</span>
      )}
      {remaining && (
        <span className="flex items-center gap-1 text-foreground-subtle">
          <Clock size={10} />
          {remaining}
        </span>
      )}
      <div className="flex-1" />
      <button
        onClick={() => setDismissed(true)}
        aria-label="Hide the freeze notice"
        className="p-0.5 text-foreground-subtle hover:text-foreground rounded"
      >
        <X size={11} />
      </button>
    </div>
    )}
    {flagged.map((c) => (
      // An agent may change a freeze, but a person sees that it did, until
      // they say they have. Not dismissable: "Seen" is the only way out.
      <div
        key={c.id}
        className="flex items-center gap-2 px-3 py-1.5 text-xs border-b bg-amber-950/40 border-amber-800/40 text-amber-200"
        data-testid="freeze-flagged-change"
      >
        <Flag size={12} className="shrink-0 text-amber-300" />
        <span className="flex-1">
          <span className="font-medium">{c.actor}</span> (agent) {describeFreezeChange(c.before, c.after)}
          <span className="text-foreground-subtle"> · {new Date(c.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
        </span>
        <button
          onClick={() => void acknowledge(c.id)}
          className="shrink-0 px-1.5 py-0.5 rounded border border-white/[0.08] text-foreground-muted hover:text-foreground hover:bg-white/[0.05]"
        >
          Seen
        </button>
      </div>
    ))}
    </div>
  );
}

/**
 * Small badge for plan cards when the project is frozen.
 * Shows "Frozen" or "Exempt" depending on the plan's status.
 */
export function FreezeBadge({ planUid }: { planUid: string }) {
  const projectPath = useProjectStore((s) => s.root);
  const [freeze, setFreeze] = useState<FreezeStatus | null>(null);

  useEffect(() => {
    if (!projectPath) return;
    fetch(`/api/freeze?project=${encodeURIComponent(projectPath)}`)
      .then((r) => r.ok ? r.json() : null)
      .then(setFreeze)
      .catch(() => {});
  }, [projectPath]);

  if (!freeze?.active) return null;

  const isExempt = freeze.allowedPlanUids.includes(planUid);

  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium ${
      isExempt
        ? 'bg-emerald-900/40 text-emerald-400'
        : 'bg-amber-900/40 text-amber-400'
    }`}>
      <ShieldAlert size={8} />
      {isExempt ? 'Exempt' : 'Frozen'}
    </span>
  );
}
