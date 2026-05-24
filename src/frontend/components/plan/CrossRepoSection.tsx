/**
 * CDev Phase 3.5 — cross-repo stitched view.
 *
 * Shows a "Plans from other repos" section in the plan list,
 * sourced from the per-project external pointers + plans whose
 * homeRepo doesn't match the current project. Two kinds of entries:
 *
 *   - **Resolved pointers** — the pointer's homeRepo matches a
 *     recent project the user has on this machine. Click switches
 *     to that project and surfaces the actual plan.
 *
 *   - **Unresolved pointers** — the home repo isn't a known clone.
 *     Render a rich card with title / status / summary / contribution
 *     / homeRepo + a "clone <url>" hint so the user knows how to
 *     reach the plan.
 *
 * Hidden when no pointers exist — this surface should be invisible
 * for single-repo workflows.
 */

import { useEffect, useState } from 'react';
import { ExternalLink, Globe, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { useProjectStore } from '../../stores/project-store';
import { useToastStore } from '../../stores/toast-store';

interface StitchedPointer {
  filePath: string;
  pointer: {
    planUid: string;
    homeRepo: string;
    title: string;
    status: string;
    summary?: string;
    contribution?: string;
    cachedAt: number;
  };
  resolved: { projectPath: string; displayName: string } | null;
}

interface StitchedView {
  projectPath: string;
  ownOriginUrl: string | null;
  localPlans: Array<{ uid: string; title: string; homeRepo: string | null; scope: string[] }>;
  pointers: StitchedPointer[];
}

export function CrossRepoSection() {
  const root = useProjectStore((s) => s.root);
  const addTab = useProjectStore((s) => s.addTab);
  const setActiveTab = useProjectStore((s) => s.setActiveTab);
  const tabs = useProjectStore((s) => s.tabs);
  const addToast = useToastStore((s) => s.addToast);

  const [view, setView] = useState<StitchedView | null>(null);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (!root) { setView(null); return; }
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/plans/stitched?project=${encodeURIComponent(root)}`);
        if (!res.ok) return;
        const data = (await res.json()) as StitchedView;
        if (!cancelled) setView(data);
      } catch (err) {
        console.warn('[CrossRepo] stitched fetch failed:', err);
      }
    };
    load();

    // Re-fetch on pointer changes — the watcher broadcasts these.
    const onPointersChanged = () => load();
    const onPlanScope = () => load();
    window.addEventListener('external-pointers-changed', onPointersChanged);
    window.addEventListener('plan-scope-changed', onPlanScope);
    return () => {
      cancelled = true;
      window.removeEventListener('external-pointers-changed', onPointersChanged);
      window.removeEventListener('plan-scope-changed', onPlanScope);
    };
  }, [root]);

  if (!view || view.pointers.length === 0) return null;

  const handleOpenResolved = (pointer: StitchedPointer) => {
    if (!pointer.resolved) return;
    const target = pointer.resolved.projectPath;
    const existing = tabs.find((t) => t.root === target);
    if (existing) {
      setActiveTab(existing.id);
    } else {
      addTab(target);
    }
  };

  const handleCloneHint = (url: string) => {
    void navigator.clipboard.writeText(`git clone ${url}`).then(
      () => addToast({ type: 'info', title: 'Copied clone command', message: `git clone ${url}` }),
      () => addToast({ type: 'error', title: 'Could not copy', message: 'Clipboard unavailable' }),
    );
  };

  return (
    <div className="mt-4 border-t border-border-subtle pt-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-foreground-muted hover:text-foreground"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Globe size={12} />
        Plans from other repos
        <span className="ml-1 rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-foreground-subtle">
          {view.pointers.length}
        </span>
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {view.pointers.map((p) => (
            <div
              key={p.pointer.planUid}
              className="rounded-md border border-border-subtle bg-white/[0.02] px-3 py-2 hover:bg-white/[0.04]"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-foreground">
                    <span className="truncate">{p.pointer.title}</span>
                    <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-normal text-foreground-muted">
                      {p.pointer.status}
                    </span>
                  </div>
                  {p.pointer.contribution && (
                    <div className="mt-1 text-[11.5px] text-foreground-muted">
                      <span className="text-foreground-subtle">contributes:</span> {p.pointer.contribution}
                    </div>
                  )}
                  {p.pointer.summary && (
                    <div className="mt-1 line-clamp-2 text-[11.5px] text-foreground-muted">{p.pointer.summary}</div>
                  )}
                  <div className="mt-1.5 truncate text-[10.5px] text-foreground-subtle">
                    home · {p.pointer.homeRepo || 'unknown'}
                  </div>
                </div>

                {p.resolved ? (
                  <button
                    type="button"
                    onClick={() => handleOpenResolved(p)}
                    className="shrink-0 rounded-md bg-accent/15 px-2 py-1 text-[11px] text-accent hover:bg-accent/25"
                    title={`Open ${p.resolved.displayName}`}
                  >
                    <ExternalLink size={11} className="mr-1 inline" />
                    Open
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleCloneHint(p.pointer.homeRepo)}
                    className="flex shrink-0 items-center gap-1 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300 hover:bg-amber-500/15"
                    title="Copy clone command"
                  >
                    <AlertCircle size={11} />
                    Not cloned
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
