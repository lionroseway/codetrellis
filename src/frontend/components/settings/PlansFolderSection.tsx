import { useCallback, useEffect, useState } from 'react';
import { useProjectStore } from '../../stores/project-store';

/**
 * Settings → Plans folder (Phase 32 C3.4a; shared-work doc C-3).
 *
 * Where this project's plans live: in the project itself, in a planning
 * repository (named by its remote), or in a folder OneDrive or SharePoint
 * keeps in sync (named by its place under the provider's root). That name
 * goes in the project's committed config, so teammates get it; the path of
 * anyone's copy does not. Each person then links their own copy here, once,
 * on their device. Until they do, nothing in it is read.
 */

type Ref = { kind: 'git'; remote: string } | { kind: 'synced'; provider: 'onedrive' | 'sharepoint' | 'folder'; place: string };

interface Status {
  project: string;
  named: Ref | null;
  state: 'here' | 'linked' | 'unlinked' | 'changed' | 'missing';
  linked: { path: string; confirmedAt: number; confirmedBy: string } | null;
  says: string;
}

type Choice = 'here' | 'git' | 'synced';

const PROVIDERS: Array<{ id: 'onedrive' | 'sharepoint' | 'folder'; label: string }> = [
  { id: 'onedrive', label: 'OneDrive' },
  { id: 'sharepoint', label: 'SharePoint' },
  { id: 'folder', label: 'Another synced folder' },
];

const inputCls = 'w-full rounded border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[12px] text-foreground placeholder:text-foreground-subtle font-mono';

export function PlansFolderSection() {
  const root = useProjectStore((s) => s.root);
  const [status, setStatus] = useState<Status | null>(null);
  const [choice, setChoice] = useState<Choice>('here');
  const [remote, setRemote] = useState('');
  const [provider, setProvider] = useState<'onedrive' | 'sharepoint' | 'folder'>('onedrive');
  const [place, setPlace] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const show = useCallback((s: Status) => {
    setStatus(s);
    const n = s.named;
    setChoice(n ? n.kind : 'here');
    if (n?.kind === 'git') setRemote(n.remote);
    if (n?.kind === 'synced') { setProvider(n.provider); setPlace(n.place); }
  }, []);

  const load = useCallback(async () => {
    if (!root) return;
    try {
      const res = await fetch(`/api/plans-folder?project=${encodeURIComponent(root)}`);
      if (res.ok) show(await res.json() as Status);
    } catch { /* offline: keep what is shown */ }
  }, [root, show]);

  useEffect(() => {
    void load();
    const run = () => { void load(); };
    window.addEventListener('plans-folder-changed', run);
    return () => window.removeEventListener('plans-folder-changed', run);
  }, [load]);

  const call = async (method: string, url: string, body?: unknown) => {
    if (!root) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${url}?project=${encodeURIComponent(root)}`, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError((json as { error?: string }).error ?? `Failed (${res.status})`); return; }
      show(json as Status);
      if (method === 'POST') setLocalPath('');
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const folder = choice === 'here' ? null
      : choice === 'git' ? { kind: 'git', remote: remote.trim() }
        : { kind: 'synced', provider, place: place.trim() };
    void call('PUT', '/api/plans-folder', { folder });
  };

  if (!root) {
    return <p className="text-[12px] text-foreground-muted">Open a project to choose where its plans live.</p>;
  }

  const named = status?.named ?? null;
  const unchanged = choice === (named?.kind ?? 'here')
    && (choice !== 'git' || (named?.kind === 'git' && named.remote === remote.trim()))
    && (choice !== 'synced' || (named?.kind === 'synced' && named.provider === provider && named.place === place.trim()));
  const tone = status?.state === 'linked' || status?.state === 'here' ? 'text-emerald-300' : 'text-amber-200';

  return (
    <div className="space-y-4" data-testid="plans-folder-section">
      <p className="text-[12px] text-foreground leading-relaxed">
        A project&apos;s plans can live in the project, or somewhere the whole team keeps its plans: a planning repository, or a folder
        OneDrive or SharePoint keeps in sync. Where they live is saved in the project&apos;s settings, so teammates get it; the path on your
        computer is not, because everyone&apos;s copy is somewhere else. Each of you links your own copy once, below.
      </p>

      <p className={`text-[12px] ${tone}`} data-testid="plans-folder-says" data-state={status?.state}>{status?.says ?? '…'}</p>

      <div className="rounded border border-white/[0.06] bg-white/[0.02] p-3 space-y-3 text-[12px]">
        <div className="text-foreground-subtle text-[11px] uppercase tracking-wider">Where the plans live</div>
        <div className="space-y-1.5" role="radiogroup" aria-label="Where the plans live">
          {([['here', 'In this project'], ['git', 'A planning repository'], ['synced', 'A synced folder (OneDrive, SharePoint)']] as Array<[Choice, string]>).map(([id, label]) => (
            <label key={id} className="flex items-center gap-2 text-foreground cursor-pointer">
              <input type="radio" name="plans-folder-kind" checked={choice === id} onChange={() => setChoice(id)} data-testid={`plans-folder-kind-${id}`} />
              {label}
            </label>
          ))}
        </div>
        {choice === 'git' && (
          <label className="block space-y-1">
            <span className="text-foreground-muted">Its remote, as <code>git clone</code> takes it</span>
            <input className={inputCls} value={remote} onChange={(e) => setRemote(e.target.value)} placeholder="git@github.com:acme/plans.git" data-testid="plans-folder-remote" />
          </label>
        )}
        {choice === 'synced' && (
          <div className="space-y-2">
            <label className="block space-y-1">
              <span className="text-foreground-muted">Kept in sync by</span>
              <select className={inputCls} value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)} data-testid="plans-folder-provider">
                {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-foreground-muted">The folder, from the top of the synced folders (the same for everyone)</span>
              <input className={inputCls} value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Acme/Board pack" data-testid="plans-folder-place" />
            </label>
          </div>
        )}
        <button
          type="button"
          onClick={save}
          disabled={busy || unchanged}
          data-testid="plans-folder-save"
          className="px-3 py-1 rounded text-[12px] bg-accent text-white hover:bg-accent-hover disabled:opacity-40"
        >
          Save for the team
        </button>
      </div>

      {named && (
        <div className="rounded border border-white/[0.06] bg-white/[0.02] p-3 space-y-2 text-[12px]" data-testid="plans-folder-device">
          <div className="text-foreground-subtle text-[11px] uppercase tracking-wider">On this device</div>
          {status?.state === 'linked' ? (
            <div className="flex items-baseline justify-between gap-3">
              <code className="font-mono text-[11.5px] text-foreground break-all" data-testid="plans-folder-linked">{status.linked?.path}</code>
              <button type="button" onClick={() => { void call('DELETE', '/api/plans-folder/link'); }} disabled={busy} data-testid="plans-folder-unlink"
                className="shrink-0 px-2 py-0.5 rounded text-[11.5px] bg-white/[0.06] text-foreground hover:bg-white/[0.1]">
                Unlink
              </button>
            </div>
          ) : (
            <>
              <p className="text-foreground-muted">
                {named.kind === 'git' ? 'Clone the planning repository if you have not, then give the folder it is in.' : 'Give the folder where your sync client keeps it.'}
                {' '}It is checked to be a copy of the folder named above before anything in it is read.
              </p>
              <div className="flex gap-2">
                <input className={inputCls} value={localPath} onChange={(e) => setLocalPath(e.target.value)} placeholder="/Users/you/work/acme-plans" data-testid="plans-folder-path" />
                <button type="button" onClick={() => { void call('POST', '/api/plans-folder/link', { path: localPath.trim() }); }} disabled={busy || !localPath.trim()} data-testid="plans-folder-link"
                  className="shrink-0 px-3 py-1 rounded text-[12px] bg-accent text-white hover:bg-accent-hover disabled:opacity-40">
                  Link
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {error && <p className="text-[12px] text-red-300" role="alert" data-testid="plans-folder-error">{error}</p>}
    </div>
  );
}
