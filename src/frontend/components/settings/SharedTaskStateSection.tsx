import { useCallback, useEffect, useState } from 'react';
import { useProjectStore } from '../../stores/project-store';

/**
 * Settings → Shared task state (Phase 32 C3.1; shared-work doc C-3).
 *
 * A plan's files carry its intent, not its state (C2.4b), so a teammate who
 * pulls sees the tasks but not who is doing what. Turned on here, per
 * project and on this device, each change to a task's state is written as a
 * new record in the project's files, one per change and never edited, and
 * teammates' records are read back. git or a synced folder carries them;
 * nothing is sent from this machine. Until records are signed, what a
 * teammate's record says is shown as unverified.
 */

interface Status {
  project: string;
  enabled: boolean;
  changedAt: number | null;
  changedBy: string | null;
  writer: string;
  name: string;
  records: number;
  writers: number;
  says: string;
}

export function SharedTaskStateSection() {
  const root = useProjectStore((s) => s.root);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!root) return;
    try {
      const res = await fetch(`/api/shared-task-state?project=${encodeURIComponent(root)}`);
      if (res.ok) setStatus(await res.json() as Status);
    } catch { /* offline: keep what is shown */ }
  }, [root]);

  useEffect(() => {
    void load();
    const run = () => { void load(); };
    window.addEventListener('shared-task-state-changed', run);
    return () => window.removeEventListener('shared-task-state-changed', run);
  }, [load]);

  const toggle = async () => {
    if (!root || !status) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/shared-task-state?project=${encodeURIComponent(root)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !status.enabled }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError((json as { error?: string }).error ?? `Failed (${res.status})`); return; }
      setStatus(json as Status);
    } finally {
      setBusy(false);
    }
  };

  if (!root) {
    return <p className="text-[12px] text-foreground-muted">Open a project to choose whether its task state is shared.</p>;
  }

  return (
    <div className="space-y-4" data-testid="shared-state-section">
      <p className="text-[12px] text-foreground leading-relaxed">
        A plan&apos;s files say what the work is. Who is doing each task, and how far it has got, stays on this device unless you share it here.
        Shared, each change is written to the project&apos;s files as a new record, one file per change and never edited, and your teammates&apos; records are read back.
        Two people changing a task at once make two files, so git or a synced folder never has to merge them.
      </p>

      <div className="rounded border border-white/[0.06] bg-white/[0.02] p-3 space-y-2 text-[12px]">
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <div className="text-foreground-subtle text-[11px] uppercase tracking-wider">This project</div>
            <div className="text-foreground truncate font-mono text-[11.5px]" title={root}>{root.split(/[\\/]/).pop()}</div>
          </div>
          <button
            data-testid="shared-state-toggle"
            aria-pressed={status?.enabled ?? false}
            disabled={busy || !status}
            onClick={() => { void toggle(); }}
            className={`shrink-0 px-3 py-1 rounded text-[12px] ${status?.enabled ? 'bg-white/[0.06] text-foreground hover:bg-white/[0.1]' : 'bg-accent text-white hover:bg-accent-hover'}`}
          >
            {status?.enabled ? 'Stop sharing' : 'Share task state'}
          </button>
        </div>
        <p className={status?.enabled ? 'text-emerald-300' : 'text-foreground'} data-testid="shared-state-says">{status?.says ?? '…'}</p>
        {status && (
          <p className="text-foreground-muted leading-relaxed" data-testid="shared-state-writer">
            Your records name you as <span className="text-foreground">{status.name}</span> (from Settings → Identity) and this device as <span className="font-mono text-foreground">{status.writer}</span>.
          </p>
        )}
        {status?.changedAt && (
          <p className="text-[11px] text-foreground-subtle">
            Last changed {new Date(status.changedAt).toLocaleString()} by {status.changedBy}.
          </p>
        )}
      </div>

      <p className="text-[11px] text-foreground-muted leading-relaxed" data-testid="shared-state-trust">
        Anyone who can write to the project&apos;s files could write a record in someone else&apos;s name, so a teammate&apos;s state is shown as
        &ldquo;in their record, unverified&rdquo; until records are signed. Nothing is sent from this machine: git, or the folder&apos;s sync, carries the files.
      </p>
      {error && <p className="text-[12px] text-red-300" role="alert" data-testid="shared-state-error">{error}</p>}
    </div>
  );
}
