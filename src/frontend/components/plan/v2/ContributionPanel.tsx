/**
 * ContributionPanel — Phase 7.2.
 *
 * Shows a collapsible list of items the contributor has promoted to
 * the contributions staging area. Appears in the plan workspace when
 * the current branch has staged contributions.
 *
 * ---
 *
 * Phase 29 §4.15 — this file was written and never imported, so the
 * whole Phase 7 contributor workflow was dark: `/api/contributions`
 * looked surfaced to the §2 audit precisely *because* this component
 * calls it, which is the blind spot that audit has.
 *
 * Accepting is added here. It is the other half of the same screen —
 * a list of staged work with no way to take it is a receipt, not a
 * workflow — and it is the only endpoint of the three whose natural
 * home is this panel. (`prepareContributorBranch` is a different job:
 * a team member building a filtered branch *for* a contractor, before
 * any of this exists. Recorded in §4.15 rather than bolted on here.)
 *
 * What accept actually does matters for the wording: it writes YAML
 * into `.codetrellis/plans/<slug>/items/`, on disk. It does not touch
 * the database — the plan-file watcher picks the files up. So the
 * button does not say "added to your plan", because that is a claim
 * about something this call does not do.
 */

import { useCallback, useEffect, useState } from 'react';
import { GitPullRequest, Package, Check, RefreshCw, Download, Loader2 } from 'lucide-react';
import { useProjectStore } from '../../../stores/project-store';
import { usePlanStore } from '../../../stores/plan-store';
import { useToastStore } from '../../../stores/toast-store';

interface Contribution {
  uid: string;
  branch: string;
  kind: 'item' | 'attachment';
  title: string;
  description?: string;
  filePath: string;
  promotedAt: string;
}

interface ContributionSummary {
  branch: string;
  total: number;
  items: Contribution[];
}

export function ContributionPanel() {
  const projectPath = useProjectStore((s) => s.root);
  const activePlan = usePlanStore((s) => s.activePlan);
  const addToast = useToastStore((s) => s.addToast);
  const [summary, setSummary] = useState<ContributionSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [accepting, setAccepting] = useState(false);

  const fetchContributions = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/contributions?project=${encodeURIComponent(projectPath)}`);
      if (res.ok) setSummary(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, [projectPath]);

  useEffect(() => {
    fetchContributions();
  }, [fetchContributions]);

  /**
   * `acceptContributions` needs the plan's on-disk slug, and the slug
   * is derived by the backend from the plan's title. Deriving it again
   * here would be a second implementation of a rule that only has to
   * hold because both sides agree — the exact drift this phase keeps
   * finding. `file-status` already returns the real directory, so ask
   * for it and take the basename.
   */
  const accept = useCallback(async () => {
    if (!projectPath || !activePlan || !summary) return;
    setAccepting(true);
    try {
      const statusRes = await fetch(
        `/api/plans/${activePlan.uid}/file-status?path=${encodeURIComponent(projectPath)}`,
      );
      const status = await statusRes.json() as { linked: boolean; planDir: string | null };
      if (!status.linked || !status.planDir) {
        throw new Error(
          'This plan is not on disk yet. Share it first (the Shared/Local chip in the plan header) '
          + 'so there is a directory to accept into.',
        );
      }
      const planSlug = status.planDir.split(/[\\/]/).filter(Boolean).pop()!;

      const res = await fetch('/api/contributions/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath, branch: summary.branch, planSlug }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);

      const errors: string[] = data?.errors ?? [];
      addToast(
        errors.length > 0
          ? {
              type: 'warning',
              title: `Accepted ${data.accepted}, ${errors.length} failed`,
              message: errors[0],
              duration: 8000,
            }
          : {
              type: 'success',
              title: `Accepted ${data.accepted} contribution${data.accepted === 1 ? '' : 's'}`,
              message: `Written into ${planSlug}/items/. The plan-file watcher picks them up.`,
            },
      );
      await fetchContributions();
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Could not accept',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setAccepting(false);
    }
  }, [projectPath, activePlan, summary, addToast, fetchContributions]);

  if (!summary || summary.total === 0) return null;

  return (
    <div className="border-b border-zinc-800/60">
      <div className="flex items-center gap-2 px-3 py-2 bg-indigo-950/20 border-b border-indigo-900/30">
        <GitPullRequest size={13} className="text-indigo-400" />
        <span className="text-xs font-medium text-indigo-300">
          Contributions staged ({summary.total})
        </span>
        <span className="text-[10px] text-zinc-500 ml-1">
          branch: {summary.branch}
        </span>
        <div className="flex-1" />
        {activePlan && (
          <button
            onClick={accept}
            disabled={accepting}
            className="flex items-center gap-1 px-2 py-0.5 text-[10.5px] rounded-md bg-indigo-500/20 text-indigo-200 hover:bg-indigo-500/30 border border-indigo-400/20 disabled:opacity-50 transition-colors"
            title={`Copy these ${summary.total} staged item(s) into ${activePlan.title}'s files on disk`}
          >
            {accepting ? <Loader2 size={10} className="animate-spin" /> : <Download size={10} />}
            {accepting ? 'Accepting…' : 'Accept into plan'}
          </button>
        )}
        <button
          onClick={fetchContributions}
          className="p-0.5 text-zinc-500 hover:text-zinc-300 rounded"
          disabled={loading}
          title="Re-check the staging area"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="max-h-32 overflow-y-auto">
        {summary.items.map((item) => (
          <div
            key={item.uid}
            className="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-zinc-800/30 last:border-b-0"
          >
            <Package size={11} className="text-zinc-500 shrink-0" />
            <span className="text-zinc-300 truncate flex-1">{item.title}</span>
            <span className="text-[9px] text-zinc-600 shrink-0">
              {item.kind}
            </span>
            <Check size={10} className="text-emerald-500 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
