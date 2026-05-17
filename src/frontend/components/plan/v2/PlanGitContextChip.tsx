import { useEffect, useRef, useState } from 'react';
import { GitBranch, GitCommit, FolderTree, Sparkles, X, Check } from 'lucide-react';
import { usePlanStore } from '../../../stores/plan-store';
import type { Plan } from '@shared/types';

/**
 * Phase 15 §15.D — plan-level git context chip + popover editor.
 *
 * Renders an inline pill on the plan home page showing the user's
 * intent ("base off `main`, land on `feat/auth`, optional worktree at
 * /tmp/foo"). Click → popover with four fields:
 *
 *   - baseRef          — what we diff against (branch / SHA)
 *   - targetBranch     — where work lands
 *   - targetWorktree   — optional absolute path
 *   - autoCreateBranch — checkbox (create targetBranch from baseRef
 *                        if missing on first agent claim)
 *
 * Persists via `updatePlanGitContext` on the plan store, which calls
 * PUT /api/plans/:uid. No git commands are executed at write time —
 * this is intent capture only. The runner / agent integration uses
 * these as input.
 *
 * Empty / unset state shows a "Set git context" prompt in muted
 * styling so the chip doesn't disappear; once values are set the
 * chip renders the configured base→target pair compactly.
 */
export function PlanGitContextChip({ plan }: { plan: Plan }) {
  const updatePlanGitContext = usePlanStore((s) => s.updatePlanGitContext);
  const [open, setOpen] = useState(false);
  const [baseRef, setBaseRef] = useState(plan.baseRef ?? '');
  const [targetBranch, setTargetBranch] = useState(plan.targetBranch ?? '');
  const [targetWorktree, setTargetWorktree] = useState(plan.targetWorktree ?? '');
  const [autoCreateBranch, setAutoCreateBranch] = useState(!!plan.autoCreateBranch);
  const [saving, setSaving] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Resync when the plan changes (different plan opened, WS update).
  useEffect(() => {
    setBaseRef(plan.baseRef ?? '');
    setTargetBranch(plan.targetBranch ?? '');
    setTargetWorktree(plan.targetWorktree ?? '');
    setAutoCreateBranch(!!plan.autoCreateBranch);
  }, [plan.uid, plan.baseRef, plan.targetBranch, plan.targetWorktree, plan.autoCreateBranch]);

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const isConfigured = !!(plan.baseRef || plan.targetBranch || plan.targetWorktree);

  const save = async () => {
    setSaving(true);
    try {
      await updatePlanGitContext(plan.uid, {
        baseRef: baseRef.trim() || null,
        targetBranch: targetBranch.trim() || null,
        targetWorktree: targetWorktree.trim() || null,
        autoCreateBranch,
      });
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setSaving(true);
    try {
      await updatePlanGitContext(plan.uid, {
        baseRef: null,
        targetBranch: null,
        targetWorktree: null,
        autoCreateBranch: false,
      });
      setBaseRef(''); setTargetBranch(''); setTargetWorktree(''); setAutoCreateBranch(false);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 px-2.5 py-1 rounded-full border transition-colors ${
          isConfigured
            ? 'border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-300 hover:bg-emerald-500/15'
            : 'border-white/[0.08] bg-white/[0.02] text-foreground-subtle hover:text-foreground-muted hover:bg-white/[0.04]'
        }`}
        title={isConfigured
          ? 'Click to edit plan git context (base ref, target branch, worktree)'
          : 'Click to set the plan git context — what we diff against, where work lands'}
      >
        <GitBranch size={12} />
        {isConfigured ? (
          <span className="font-mono text-[12px]">
            {plan.baseRef || '?'}
            <span className="opacity-60 mx-1">→</span>
            {plan.targetBranch || plan.baseRef || '?'}
            {plan.targetWorktree && (
              <span className="opacity-60 ml-1">·worktree</span>
            )}
          </span>
        ) : (
          <span className="text-[12.5px]">Set git context</span>
        )}
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute top-full left-0 mt-2 z-30 w-[400px] rounded-xl border border-white/[0.1] bg-[#0d0e16] shadow-2xl shadow-black/60 p-4 space-y-3 text-[13px]"
        >
          <div className="flex items-center gap-2 text-foreground font-medium pb-2 border-b border-white/[0.06] text-[14px]">
            <GitBranch size={14} className="text-emerald-400" />
            Plan git context
          </div>

          <Field
            label="Base ref"
            hint="What we diff against. Branch name (`main`) or commit SHA."
            icon={<GitCommit size={12} />}
          >
            <input
              type="text"
              value={baseRef}
              onChange={(e) => setBaseRef(e.target.value)}
              placeholder="main"
              className="w-full bg-white/[0.02] border border-white/[0.08] rounded-md px-2.5 py-1.5 font-mono text-[13px] text-foreground placeholder:text-foreground-subtle focus:outline-none focus:border-accent/40"
            />
          </Field>

          <Field
            label="Target branch"
            hint="Where the work lands. Leave blank to edit base ref in place."
            icon={<GitBranch size={12} />}
          >
            <input
              type="text"
              value={targetBranch}
              onChange={(e) => setTargetBranch(e.target.value)}
              placeholder="feat/your-branch"
              className="w-full bg-white/[0.02] border border-white/[0.08] rounded-md px-2.5 py-1.5 font-mono text-[13px] text-foreground placeholder:text-foreground-subtle focus:outline-none focus:border-accent/40"
            />
          </Field>

          <Field
            label="Target worktree"
            hint="Optional absolute path. Useful for parallel agents."
            icon={<FolderTree size={12} />}
          >
            <input
              type="text"
              value={targetWorktree}
              onChange={(e) => setTargetWorktree(e.target.value)}
              placeholder="/tmp/codetrellis-worktrees/…"
              className="w-full bg-white/[0.02] border border-white/[0.08] rounded-md px-2.5 py-1.5 font-mono text-[13px] text-foreground placeholder:text-foreground-subtle focus:outline-none focus:border-accent/40"
            />
          </Field>

          <label className="flex items-center gap-2.5 px-1.5 py-2 rounded hover:bg-white/[0.02] cursor-pointer">
            <input
              type="checkbox"
              checked={autoCreateBranch}
              onChange={(e) => setAutoCreateBranch(e.target.checked)}
              className="accent-accent w-3.5 h-3.5"
            />
            <span className="flex items-center gap-1.5 text-foreground-muted">
              <Sparkles size={12} className="text-accent" />
              Auto-create target branch
            </span>
            <span className="ml-auto text-[11.5px] text-foreground-subtle">
              from base ref if missing
            </span>
          </label>

          <div className="flex items-center gap-2 pt-2 border-t border-white/[0.06]">
            <button
              onClick={clear}
              disabled={saving}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12.5px] rounded text-foreground-subtle hover:text-red-300 hover:bg-red-500/10 disabled:opacity-50"
              title="Clear all fields"
            >
              <X size={12} /> Clear
            </button>
            <div className="flex-1" />
            <button
              onClick={() => setOpen(false)}
              className="px-3 py-1.5 text-[12.5px] rounded text-foreground-subtle hover:text-foreground hover:bg-white/[0.04]"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] rounded bg-accent text-white hover:bg-accent-hover disabled:opacity-50"
            >
              <Check size={12} /> {saving ? 'Saving…' : 'Save'}
            </button>
          </div>

          <p className="text-[11.5px] text-foreground-subtle leading-relaxed pt-1">
            Capturing intent only — no git commands run when you save. The runner / agent
            integration reads these to scope diffs and decide where to commit.
          </p>
        </div>
      )}
    </div>
  );
}

function Field({
  label, hint, icon, children,
}: {
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-foreground-muted text-[12.5px]">
        {icon}
        <span className="font-medium">{label}</span>
        {hint && <span className="text-[11px] text-foreground-subtle ml-auto truncate">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
