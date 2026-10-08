import { useCallback, useEffect, useState } from 'react';
import type { PipelineView } from '../../../shared/types/pipeline';

/**
 * Phase 33 B6 — the pipeline, in the Rules view: each stage in words, in the
 * order it runs, and what an edit to `.codetrellis/pipeline.yaml` loosens
 * since the last commit, for the person to approve, signed as them. Nothing
 * shows when the project has no pipeline and nothing is pending.
 */
export function PipelinePanel({ root, version }: { root: string; version: number }) {
  const [view, setView] = useState<PipelineView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/pipeline?project=${encodeURIComponent(root)}`);
      if (res.ok) setView((await res.json()) as PipelineView);
    } catch { /* keeps what is shown */ }
  }, [root]);

  useEffect(() => { void load(); }, [load, version]);

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/pipeline/approve?project=${encodeURIComponent(root)}`, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { view?: PipelineView; error?: string };
      if (!res.ok) setError(body.error ?? `Server returned ${res.status}`);
      else if (body.view) setView(body.view);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!view || (!view.pipeline && view.problems.length === 0 && view.pending.length === 0)) return null;
  return (
    <section className="rounded border border-white/[0.06] bg-white/[0.02] px-3 py-2 space-y-2 text-[12px]" data-testid="pipeline-panel">
      <div className="flex items-baseline gap-2">
        <h3 className="text-[11px] uppercase tracking-wide text-foreground-subtle">Pipeline</h3>
        <span className="font-mono text-[11px] text-foreground-subtle">{view.where}</span>
      </div>
      {view.problems.map((p) => <p key={p} className="text-amber-300" data-testid="pipeline-problem">⚠ {p}</p>)}
      {view.words.length > 0 && (
        <ol className="space-y-0.5 list-decimal pl-5" data-testid="pipeline-stages">
          {view.words.map((w) => <li key={w} className="text-foreground" data-testid="pipeline-stage">{w}</li>)}
        </ol>
      )}
      {view.pending.length > 0 && (
        <div className="rounded border border-red-300/30 bg-red-500/[0.06] px-3 py-2 space-y-2" data-testid="pipeline-pending">
          {view.pending.map((p) => <p key={p.stage} className="text-foreground" data-testid="pipeline-pending-words">{p.words}</p>)}
          <p className="text-[11px] text-foreground-muted">
            Approving signs it with your key, beside the rules in <span className="font-mono">.codetrellis/rules/approvals/</span>. CI accepts it only if that key is already listed on the base branch.
          </p>
          <button type="button" disabled={busy} onClick={() => { void approve(); }} data-testid="pipeline-approve"
            className="px-2.5 py-0.5 rounded text-[11.5px] bg-red-500/20 text-foreground hover:bg-red-500/30 disabled:opacity-40">
            Approve, signed as you
          </button>
        </div>
      )}
      {error && <p className="text-red-300" data-testid="pipeline-error">{error}</p>}
    </section>
  );
}
