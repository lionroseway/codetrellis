import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, GitBranch, Loader2, AlertTriangle } from 'lucide-react';
import { useToastStore } from '../../stores/toast-store';

/**
 * Phase 29 §4.16 — prepare a filtered branch for an external
 * contributor (Phase 7.3).
 *
 * `/api/contributor-branch` had no caller. It builds a branch carrying
 * only the plan content you want to share: items marked `local` are
 * dropped, private fields are stripped, and `.codetrellis/contributions/`
 * is removed.
 *
 * **This one needed a guard before it could have a button.** The
 * service checks out a new branch, rewrites `.codetrellis/`, then runs
 * `git add .codetrellis/` and commits — so uncommitted manifest work
 * was swept into the contributor branch's commit, and the `checkout -`
 * at the end returned the user to a branch that no longer had it.
 * Nothing was destroyed; it silently moved. That was survivable while
 * an agent called this deliberately over MCP. It is not something to
 * put behind a button, so the service now refuses on a dirty
 * `.codetrellis/` and says which files to deal with.
 *
 * The copy here is deliberately explicit about the branch switch. This
 * is the most invasive thing in the plan workspace — it touches the
 * user's git state — and a one-line label would not be honest about
 * that.
 */
export function ContributorBranchModal({
  planSlug,
  planTitle,
  projectPath,
  onClose,
}: {
  planSlug: string;
  planTitle: string;
  projectPath: string;
  onClose: () => void;
}) {
  const [branchName, setBranchName] = useState(`contrib/${planSlug}`);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const addToast = useToastStore((s) => s.addToast);

  const submit = async () => {
    const name = branchName.trim();
    if (!name) {
      setError('A branch name is required.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/contributor-branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath, planSlug, branchName: name }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      addToast({
        type: 'success',
        title: `Branch ${data.branch} ready`,
        message: `${data.itemCount} shared item${data.itemCount === 1 ? '' : 's'} committed as ${String(data.commitHash).slice(0, 7)}. You are back on your original branch.`,
        duration: 8000,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-[#0b1020] shadow-[0_24px_80px_rgba(0,0,0,0.6)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold text-foreground min-w-0">
            <GitBranch size={13} className="text-accent shrink-0" />
            <span className="truncate">Prepare a contributor branch</span>
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded text-foreground-subtle hover:text-foreground hover:bg-white/[0.05] shrink-0"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <p className="text-[11px] text-foreground-muted leading-relaxed">
            Builds a branch carrying only the shared parts of{' '}
            <span className="text-foreground">{planTitle}</span>. Items marked local are left out,
            private fields are stripped, and the contributions staging area is removed.
          </p>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-foreground-subtle mb-1">
              Branch name
            </label>
            <input
              type="text"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              placeholder="contrib/my-plan"
              className="w-full bg-white/[0.02] border border-white/[0.08] rounded-md px-3 py-1.5 text-[12px] font-mono text-foreground focus:outline-none focus:border-accent/40"
            />
          </div>

          {/* What this does to their git state, in the words a git user
              would use. This creates a branch and a commit; saying so
              plainly is the difference between a tool and a surprise. */}
          <div className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-wider text-foreground-subtle mb-1.5">
              What happens
            </p>
            <ol className="text-[11px] text-foreground-muted leading-relaxed space-y-0.5 list-decimal list-inside">
              <li>A new branch is created from where you are now.</li>
              <li>The plan&apos;s manifest is rewritten to the shared items only.</li>
              <li>That is committed on the new branch.</li>
              <li>You are returned to the branch you started on.</li>
            </ol>
          </div>

          <p className="flex items-start gap-1.5 text-[10.5px] text-amber-300/80 leading-relaxed">
            <AlertTriangle size={11} className="mt-0.5 shrink-0" />
            Commit or stash any manifest changes first — uncommitted work under{' '}
            <code className="font-mono">.codetrellis/</code> would end up on the new branch instead
            of this one. This is refused rather than guessed at.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-white/[0.06]">
          {error && <span className="text-[10.5px] text-red-300 mr-auto leading-snug">{error}</span>}
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[11px] rounded-md text-foreground-muted hover:text-foreground hover:bg-white/[0.04]"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || !branchName.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting && <Loader2 size={11} className="animate-spin" />}
            {submitting ? 'Preparing…' : 'Create branch'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
