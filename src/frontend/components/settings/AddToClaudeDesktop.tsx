/**
 * Phase 31 §6.1 — "Add to Claude Desktop", desktop app only.
 *
 * Writes the connector's entry into Claude Desktop's own config file — the
 * person's action, on the person's file: they see the file's path and the
 * whole change as a diff first, the old file is kept beside it, and nothing
 * is written if the file changed after they looked (they are shown the new
 * diff instead). The entry is resolved in the main process, not here.
 */
import { useState } from 'react';

type Api = NonNullable<NonNullable<Window['electronAPI']>['claudeDesktop']>;
type Preview = Awaited<ReturnType<Api['preview']>>;
type Shown = Extract<Preview, { ok: true }>;

export function AddToClaudeDesktop() {
  const api: Api | undefined = window.electronAPI?.claudeDesktop;
  const [shown, setShown] = useState<Shown | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!api) return null;

  const preview = async (note?: string) => {
    setBusy(true);
    try {
      const p = await api.preview();
      if (!p.ok) { setShown(null); setMessage({ tone: 'warn', text: p.reason }); return; }
      if (p.status === 'unchanged') {
        setShown(null);
        setMessage({ tone: 'ok', text: 'Claude Desktop already has CodeTrellis. If it is not connected, quit and reopen Claude Desktop.' });
        return;
      }
      setShown(p);
      setMessage(note ? { tone: 'warn', text: note } : null);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!shown) return;
    setBusy(true);
    try {
      const r = await api.apply(shown.beforeHash);
      if (!r.ok) {
        if (r.changed) { await preview(r.reason); return; }
        setShown(null);
        setMessage({ tone: 'warn', text: r.reason });
        return;
      }
      setShown(null);
      setMessage({
        tone: 'ok',
        text: `Added. Quit and reopen Claude Desktop, and CodeTrellis appears in its tools.${r.backupPath ? ` The previous file is kept as ${r.backupPath}.` : ''}`,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3" data-testid="add-to-claude-desktop">
      {!shown && (
        <button
          onClick={() => void preview()}
          disabled={busy}
          className="px-2.5 py-1 rounded-md text-[11px] border border-accent/30 text-accent hover:bg-accent/10 disabled:opacity-50"
        >
          Add to Claude Desktop…
        </button>
      )}
      {shown && (
        <div className="rounded-md border border-white/[0.08] bg-black/20 p-3">
          <p className="text-[10.5px] text-foreground-muted leading-relaxed">
            {shown.status === 'update' ? 'This updates' : shown.exists ? 'This adds CodeTrellis to' : 'This creates'}{' '}
            <code className="font-mono break-all">{shown.path}</code>
            {shown.exists ? '. A copy of the current file is kept beside it.' : '.'} Nothing else in it changes.
          </p>
          <pre className="mt-2 max-h-56 overflow-auto bg-black/30 border border-white/[0.06] rounded px-2 py-1.5 text-[10.5px] font-mono leading-[1.45]" data-testid="claude-desktop-diff">
            {shown.diff.map((l, i) => (
              <div key={i} className={l.op === '+' ? 'text-emerald-300 bg-emerald-400/[0.06]' : l.op === '-' ? 'text-red-300 bg-red-400/[0.06]' : 'text-foreground-subtle'}>
                {l.op} {l.text}
              </div>
            ))}
          </pre>
          <div className="mt-2 flex gap-2">
            <button onClick={() => void apply()} disabled={busy} className="px-2.5 py-1 rounded-md text-[11px] bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-50">
              {shown.status === 'update' ? 'Update Claude Desktop' : 'Add to Claude Desktop'}
            </button>
            <button onClick={() => { setShown(null); setMessage(null); }} disabled={busy} className="px-2.5 py-1 rounded-md text-[11px] text-foreground-subtle hover:text-foreground">
              Cancel
            </button>
          </div>
        </div>
      )}
      {message && (
        <p className={`mt-2 text-[10.5px] leading-relaxed ${message.tone === 'ok' ? 'text-emerald-300/90' : 'text-amber-200/90'}`}>{message.text}</p>
      )}
    </div>
  );
}
