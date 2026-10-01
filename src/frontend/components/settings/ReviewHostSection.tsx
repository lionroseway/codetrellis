import { useCallback, useEffect, useState } from 'react';
import { useProjectStore } from '../../stores/project-store';

/**
 * Settings → Review hosts (Phase 32 C2.2a; shared-work doc C-2 §5).
 *
 * Git already says whether a task's branch is building, pushed or merged,
 * for any host or none (C2.1). What only a host knows (a pull request open
 * for review, its checks and reviews, one closed without merging) needs the
 * host to be asked, and asking is a request from this machine. So it is off
 * until the person turns it on, per project, here; the section says what
 * would be read before anything is, and where a token would be kept.
 */

interface Detected {
  kind: 'github' | 'gitlab' | 'bitbucket' | null;
  hostname: string;
  slug: string;
  supported: boolean;
  asks: string | null;
}

interface Status {
  project: string;
  detected: Detected | null;
  enabled: boolean;
  turnedOnFor: string | null;
  changedAt: number | null;
  changedBy: string | null;
  token: { saved: boolean; kind: 'os-keychain' | 'memory'; where: string };
  says: string;
}

const NAME: Record<string, string> = { github: 'GitHub', gitlab: 'GitLab', bitbucket: 'Bitbucket' };

/** The least a token needs, per host (C2.2b, C2.3): read only. */
const TOKEN_HINT: Record<string, string> = {
  github: 'A fine-grained token with read access to pull requests, checks and commit statuses on this repository is enough.',
  gitlab: 'A personal, project or group access token with the read_api scope is enough.',
  bitbucket: 'A repository or workspace access token with read access to pull requests is enough.',
};

export function ReviewHostSection() {
  const root = useProjectStore((s) => s.root);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!root) return;
    try {
      const res = await fetch(`/api/review-host?project=${encodeURIComponent(root)}`);
      if (res.ok) setStatus(await res.json() as Status);
    } catch { /* offline: keep what is shown */ }
  }, [root]);

  useEffect(() => {
    void load();
    const run = () => { void load(); };
    window.addEventListener('review-host-changed', run);
    return () => window.removeEventListener('review-host-changed', run);
  }, [load]);

  const send = async (method: 'PUT' | 'DELETE', path: string, body?: unknown) => {
    if (!root) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${path}?project=${encodeURIComponent(root)}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError((json as { error?: string }).error ?? `Failed (${res.status})`); return; }
      setStatus(json as Status);
      if (path.endsWith('/token')) setToken('');
    } finally {
      setBusy(false);
    }
  };

  if (!root) {
    return <p className="text-[12px] text-foreground-muted">Open a project to choose its review host.</p>;
  }

  const d = status?.detected ?? null;
  const name = d?.kind ? NAME[d.kind] : d?.hostname;

  return (
    <div className="space-y-4" data-testid="review-host-section">
      <p className="text-[12px] text-foreground leading-relaxed">
        Git already tells CodeTrellis whether each task&apos;s branch is <span className="font-medium">building</span>, <span className="font-medium">pushed</span> or <span className="font-medium">merged</span>, whatever host you use.
        A review host adds what only it knows: a pull request open for review, its checks and reviews, and one closed without merging.
      </p>

      <div className="rounded border border-white/[0.06] bg-white/[0.02] p-3 space-y-2 text-[12px]">
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <div className="text-foreground-subtle text-[11px] uppercase tracking-wider">This project</div>
            <div className="text-foreground truncate font-mono text-[11.5px]" title={root}>{root.split(/[\\/]/).pop()}</div>
          </div>
          {d?.supported && (
            <button
              data-testid="review-host-toggle"
              aria-pressed={status?.enabled ?? false}
              disabled={busy || !status}
              onClick={() => { void send('PUT', '/api/review-host', { enabled: !status?.enabled }); }}
              className={`shrink-0 px-3 py-1 rounded text-[12px] ${status?.enabled ? 'bg-white/[0.06] text-foreground hover:bg-white/[0.1]' : 'bg-accent text-white hover:bg-accent-hover'}`}
            >
              {status?.enabled ? 'Turn off' : `Turn on ${name}`}
            </button>
          )}
        </div>
        <div className="text-foreground-muted" data-testid="review-host-remote">
          {d ? <>Its remote: <span className="font-mono text-foreground">{d.hostname}/{d.slug}</span>{d.kind ? ` (${NAME[d.kind]})` : ''}</> : 'Its remote names no host.'}
        </div>
        {d?.asks && <p className="text-foreground-muted leading-relaxed" data-testid="review-host-asks">{d.asks}</p>}
        <p className={status?.enabled ? 'text-emerald-300' : 'text-foreground'} data-testid="review-host-says">{status?.says ?? '…'}</p>
        {status?.changedAt && (
          <p className="text-[11px] text-foreground-subtle">
            Last changed {new Date(status.changedAt).toLocaleString()} by {status.changedBy}.
          </p>
        )}
      </div>

      {d?.supported && (
        <div className="space-y-2 text-[12px]">
          <div className="text-foreground">Token for {d.hostname} <span className="text-foreground-subtle">(optional for a public repository)</span></div>
          <p className="text-[11px] text-foreground-muted leading-relaxed" data-testid="review-host-token-hint">
            {d.kind ? TOKEN_HINT[d.kind] : ''}
            {' '}It is used for {d.hostname} only, never shown again, and never written to your project or the database.
          </p>
          {status?.token.saved ? (
            <div className="flex items-center gap-2">
              <span className="text-emerald-300" data-testid="review-host-token-saved">Token saved</span>
              <button
                data-testid="review-host-token-forget"
                disabled={busy}
                onClick={() => { void send('DELETE', '/api/review-host/token'); }}
                className="px-2 py-0.5 rounded bg-white/[0.06] hover:bg-white/[0.1] text-foreground-muted"
              >
                Forget it
              </button>
            </div>
          ) : (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => { e.preventDefault(); void send('PUT', '/api/review-host/token', { token }); }}
            >
              <input
                data-testid="review-host-token"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={`Paste a ${name} token`}
                className="flex-1 min-w-0 bg-white/[0.03] border border-white/[0.08] rounded px-2 py-1 font-mono text-[11.5px] text-foreground focus:outline-none focus:border-accent/50"
              />
              <button type="submit" disabled={busy || !token.trim()} className="px-3 py-1 rounded bg-white/[0.06] hover:bg-white/[0.1] text-foreground disabled:opacity-50">
                Save
              </button>
            </form>
          )}
          <p className="text-[11px] text-foreground-subtle" data-testid="review-host-token-where">Where it is kept: {status?.token.where}.</p>
        </div>
      )}

      {error && <p className="text-[12px] text-red-300" role="alert" data-testid="review-host-error">{error}</p>}
    </div>
  );
}
