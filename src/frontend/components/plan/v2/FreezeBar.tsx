/**
 * FreezeBar — Phase 6.5.
 *
 * An amber banner that appears across the plan workspace when the
 * project has an active freeze period. Shows the reason and expiry.
 * Non-exempt plans show a "frozen" badge.
 */

import { useEffect, useState } from 'react';
import { ShieldAlert, Clock, X } from 'lucide-react';
import { useProjectStore } from '../../../stores/project-store';

interface FreezeStatus {
  active: boolean;
  reason: string | null;
  since: string | null;
  until: string | null;
  expired: boolean;
  allowedPlanUids: string[];
  remainingMs: number | null;
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

  useEffect(() => {
    if (!projectPath) return;

    const fetchFreeze = async () => {
      try {
        const res = await fetch(`/api/freeze?project=${encodeURIComponent(projectPath)}`);
        if (res.ok) setFreeze(await res.json());
      } catch { /* ignore */ }
    };

    fetchFreeze();

    // Re-check periodically for auto-expiry
    const interval = setInterval(fetchFreeze, 60_000);

    return () => clearInterval(interval);
  }, [projectPath]);

  if (!freeze?.active || dismissed) return null;

  const isExempt = planUid ? freeze.allowedPlanUids.includes(planUid) : false;
  const remaining = formatRemaining(freeze.remainingMs);

  return (
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
        className="p-0.5 text-foreground-subtle hover:text-foreground rounded"
      >
        <X size={11} />
      </button>
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
