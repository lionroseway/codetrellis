import { useEffect, useMemo, useState } from 'react';
import { openFindings, type RunFinding, type RunLike } from '../../shared/lib/open-findings';

/**
 * Phase 33 G10 — the project's check runs, kept current: read once, and again
 * whenever a run is recorded or arrives from a teammate (`check-runs-changed`).
 * Every place that shows findings where the code is reads them through this,
 * so the code, the diff and the inspector agree on what is open.
 */
export function useCheckRuns(root: string | null): RunLike[] | null {
  const [runs, setRuns] = useState<RunLike[] | null>(null);
  useEffect(() => {
    if (!root) { setRuns(null); return; }
    let live = true;
    const load = () => {
      fetch(`/api/check-runs?project=${encodeURIComponent(root)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((b) => { if (live) setRuns(b ? ((b as { runs: RunLike[] }).runs ?? []) : []); })
        .catch(() => { if (live) setRuns([]); });
    };
    load();
    window.addEventListener('check-runs-changed', load);
    return () => { live = false; window.removeEventListener('check-runs-changed', load); };
  }, [root]);
  return runs;
}

/** What the latest run found in one file, and which run that is; null when nothing has run. */
export function useFileFindings(root: string | null, file: string | null): { runId: string; who: string; ranIn: string; findings: RunFinding[] } | null {
  const runs = useCheckRuns(root && file ? root : null);
  return useMemo(() => {
    if (!runs || !file) return null;
    const open = openFindings(runs, [file]);
    return open && { runId: open.run.id, who: open.run.who, ranIn: open.run.ranIn, findings: open.findings };
  }, [runs, file]);
}
