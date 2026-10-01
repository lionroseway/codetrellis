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
 * nothing is sent from this machine. Each record is signed (C3.3): with the
 * person's git SSH key, else this device's own key, which teammates trust
 * once here after checking its fingerprint. A teammate's record reads
 * unverified unless it is signed with a key trusted here.
 *
 * Teammates' material reads (C3.5) are a separate switch, on by default
 * while task state is shared: which version of each material your tasks
 * read is written beside the records, and teammates' reads are compared with
 * yours, so "Alex's task used last week's version" can be said.
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
  signing: { how: 'git' | 'device'; as: string; says: string };
  keys: TeammateKey[];
  checked: { verified: number; unverified: number; reasons: Array<{ why: string; records: number }> };
  materialReads: { enabled: boolean; chosen: boolean; changedAt: number | null; changedBy: string | null; mine: number; teammates: number; people: string[]; says: string };
}

interface TeammateKey {
  writer: string;
  name: string;
  fingerprint: string;
  short: string;
  state: 'new' | 'trusted' | 'refused';
  firstSeen: number;
  decidedAt: number | null;
  decidedBy: string | null;
  replaces: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "3 teammates' records verified; 1 unverified: it is not signed." */
function checkedWords(c: Status['checked']): string {
  if (c.verified + c.unverified === 0) return 'No teammate\'s record is in the project\'s files yet.';
  const why = c.reasons.map((r) => (c.reasons.length > 1 ? `${r.why} (${r.records})` : r.why)).join('; ');
  return `Teammates' records here: ${plural(c.verified, 'signed and verified', 'signed and verified')}${c.unverified ? `, ${c.unverified} unverified: ${why}` : ''}.`;
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

  const decide = async (k: TeammateKey, trust: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/shared-task-state/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ writer: k.writer, fingerprint: k.fingerprint, trust }),
      });
      if (!res.ok) { setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Failed (${res.status})`); return; }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const put = async (body: { enabled: boolean } | { materialReads: boolean }) => {
    if (!root || !status) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/shared-task-state?project=${encodeURIComponent(root)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
            onClick={() => { if (status) void put({ enabled: !status.enabled }); }}
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

      {status && (
        <div className="rounded border border-white/[0.06] bg-white/[0.02] p-3 space-y-2 text-[12px]" data-testid="shared-reads">
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <div className="text-foreground-subtle text-[11px] uppercase tracking-wider">Teammates&apos; material reads</div>
              <p className="text-foreground-muted leading-relaxed mt-1">
                Which version of each spreadsheet or document your tasks worked from, so a task that used last week&apos;s file is named beside the one that replaced it.
                {!status.materialReads.chosen && status.enabled ? ' On by default while task state is shared.' : ''}
              </p>
            </div>
            {status.enabled && (
              <button
                data-testid="shared-reads-toggle"
                aria-pressed={status.materialReads.enabled}
                disabled={busy}
                onClick={() => { void put({ materialReads: !status.materialReads.enabled }); }}
                className={`shrink-0 px-3 py-1 rounded text-[12px] ${status.materialReads.enabled ? 'bg-white/[0.06] text-foreground hover:bg-white/[0.1]' : 'bg-accent text-white hover:bg-accent-hover'}`}
              >
                {status.materialReads.enabled ? 'Stop sharing reads' : 'Share reads'}
              </button>
            )}
          </div>
          <p className={status.materialReads.enabled ? 'text-emerald-300' : 'text-foreground'} data-testid="shared-reads-says">{status.materialReads.says}</p>
          {status.materialReads.enabled && (
            <p className="text-[11px] text-foreground-muted" data-testid="shared-reads-counts">
              {plural(status.materialReads.mine, 'version')} read here {status.materialReads.mine === 1 ? 'is' : 'are'} recorded; {plural(status.materialReads.teammates, 'read')} from teammates {status.materialReads.teammates === 1 ? 'is' : 'are'} compared with yours.
            </p>
          )}
        </div>
      )}

      {status && (
        <div className="rounded border border-white/[0.06] bg-white/[0.02] p-3 space-y-2 text-[12px]" data-testid="shared-state-signing">
          <div className="text-foreground-subtle text-[11px] uppercase tracking-wider">Signing</div>
          <p className="text-foreground leading-relaxed" data-testid="shared-state-signing-says">{status.signing.says}</p>
          {status.signing.how === 'device' && (
            <p className="text-foreground-muted">
              This device&apos;s fingerprint: <code className="font-mono text-[11px] text-foreground break-all" data-testid="shared-state-fingerprint">{status.signing.as}</code>
            </p>
          )}
        </div>
      )}

      {status && (
        <div className="space-y-2 text-[12px]" data-testid="shared-state-keys">
          <div className="text-foreground-subtle text-[11px] uppercase tracking-wider">Teammates&apos; keys</div>
          {status.keys.length === 0 ? (
            <p className="text-foreground-muted leading-relaxed" data-testid="shared-state-keys-empty">
              No teammate&apos;s device has introduced a key in this project. A teammate who signs with a git key needs none: git&apos;s allowed signers vouches for them.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {status.keys.map((k) => (
                <li key={`${k.writer}:${k.fingerprint}`} data-testid="shared-state-key" data-state={k.state} className="rounded border border-white/[0.06] bg-white/[0.02] px-3 py-2 space-y-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-foreground">{k.name}</span>
                      <span className="ml-2 font-mono text-[11px] text-foreground-muted" title={k.fingerprint}>{k.short}…</span>
                    </div>
                    <div className="shrink-0 flex gap-1.5">
                      {k.state !== 'trusted' && (
                        <button data-testid="shared-state-key-trust" disabled={busy} onClick={() => { void decide(k, true); }} className="px-2 py-0.5 rounded text-[11.5px] bg-accent text-white hover:bg-accent-hover">Trust</button>
                      )}
                      {k.state !== 'refused' && (
                        <button data-testid="shared-state-key-refuse" disabled={busy} onClick={() => { void decide(k, false); }} className="px-2 py-0.5 rounded text-[11.5px] bg-white/[0.06] text-foreground hover:bg-white/[0.1]">
                          {k.state === 'trusted' ? 'Stop trusting' : 'Refuse'}
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-[11px] text-foreground-muted" data-testid="shared-state-key-says">
                    {k.state === 'new' && `New. Check that ${k.name}'s Settings shows ${k.short}… before trusting it; until then their records read unverified.`}
                    {k.state === 'trusted' && `Trusted${k.decidedAt ? ` ${new Date(k.decidedAt).toLocaleDateString()}` : ''}: records this key signs read as ${k.name}'s.`}
                    {k.state === 'refused' && 'Refused: records this key signs read unverified.'}
                  </p>
                  {k.replaces && (
                    <p className="text-[11px] text-amber-300" data-testid="shared-state-key-replaces">
                      ⚠ You already trust another key for this device. A new key can mean a reinstall, or someone else writing as {k.name}: ask them.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-foreground-muted leading-relaxed" data-testid="shared-state-checked">{checkedWords(status.checked)}</p>
        </div>
      )}

      <p className="text-[11px] text-foreground-muted leading-relaxed" data-testid="shared-state-trust">
        Anyone who can write to the project&apos;s files could write a record in someone else&apos;s name, so a teammate&apos;s state reads
        &ldquo;in their record, unverified&rdquo; unless it is signed with a key you trust here: their git key, listed in git&apos;s allowed signers, or their
        device key, trusted above. Nothing is sent from this machine: git, or the folder&apos;s sync, carries the files.
      </p>
      {error && <p className="text-[12px] text-red-300" role="alert" data-testid="shared-state-error">{error}</p>}
    </div>
  );
}
