/**
 * Phase 32 A8.3 — the breakpoint hook, offered to Gemini CLI. Desktop app only.
 *
 * Add to Claude Code's flow (AddToClaudeCode.tsx), for one file: the person
 * sees where it goes and the whole change as a diff, and nothing is ticked:
 * the hook runs before every edit Gemini CLI makes, so it is theirs to opt
 * into. It is written only if the file is still the one they saw. The
 * content is decided in the main process (services/gemini-cli-hook.ts).
 */
import { useState } from 'react';

type Api = NonNullable<NonNullable<Window['electronAPI']>['geminiCli']>;
type Shown = Extract<Awaited<ReturnType<Api['preview']>>, { ok: true }>;

export function AddToGeminiCli() {
  const api: Api | undefined = window.electronAPI?.geminiCli;
  const [shown, setShown] = useState<Shown | null>(null);
  const [want, setWant] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!api) return null;

  const preview = async (note?: string) => {
    setBusy(true);
    try {
      const p = await api.preview();
      if (!p.ok) { setShown(null); setMessage({ tone: 'warn', text: p.reason }); return; }
      setShown(p);
      setWant(false);
      setMessage(note ? { tone: 'warn', text: note } : null);
    } finally {
      setBusy(false);
    }
  };

  const pending = !!shown && shown.status !== 'unchanged';

  const apply = async () => {
    if (!shown || !pending || !want) return;
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
        text: `Added the hook. Gemini CLI picks it up in its next session.${r.backupPath ? ` The previous file is kept as ${r.backupPath}.` : ''}`,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3" data-testid="add-to-gemini-cli">
      {!shown && (
        <button
          onClick={() => void preview()}
          disabled={busy}
          className="px-2.5 py-1 rounded-md text-[11px] border border-accent/30 text-accent hover:bg-accent/10 disabled:opacity-50"
          title="Hold Gemini CLI's edits at the breakpoints you set, before they are made"
        >
          Add breakpoints to Gemini CLI…
        </button>
      )}
      {shown && (
        <div className="rounded-md border border-white/[0.08] bg-black/20 p-3 space-y-3">
          <p className="text-[10.5px] text-foreground-muted leading-relaxed">
            This adds one hook to Gemini CLI&apos;s settings; nothing else in them changes. It works on its own; for
            CodeTrellis&apos;s tools too, add the JSON entry above under <code className="font-mono">mcpServers</code> in the same file.
          </p>
          <div data-testid="gemini-cli-hook">
            <label className="flex items-start gap-2 text-[11px] text-foreground">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={pending && want}
                disabled={!pending || busy}
                onChange={(e) => setWant(e.target.checked)}
              />
              <span>
                <strong>Hold edits at your breakpoints</strong> <span className="text-foreground-subtle">(optional)</span>
                <span className="block text-[10.5px] text-foreground-muted leading-relaxed">
                  {pending
                    ? <>
                        Before Gemini CLI writes or changes a file, it asks CodeTrellis whether you set a breakpoint there, and
                        holds the edit until you answer. It never approves an edit, and does nothing when CodeTrellis is not
                        running.{' '}
                        {shown.status === 'update' ? 'Updates' : shown.exists ? 'Changes' : 'Creates'}{' '}
                        <code className="font-mono break-all">{shown.path}</code>
                        {shown.exists ? ' (a copy of the current file is kept beside it)' : ''}.
                      </>
                    : 'Already added, and up to date.'}
                </span>
              </span>
            </label>
            {pending && shown.caveat && (
              <p className="mt-1.5 text-[10.5px] text-amber-200/90 leading-relaxed" data-testid="gemini-cli-hook-caveat">{shown.caveat}</p>
            )}
            {pending && (
              <pre className="mt-1.5 max-h-40 overflow-auto bg-black/30 border border-white/[0.06] rounded px-2 py-1.5 text-[10.5px] font-mono leading-[1.45]" data-testid="gemini-cli-hook-diff">
                {shown.diff.map((l, i) => (
                  <div key={i} className={l.op === '+' ? 'text-emerald-300 bg-emerald-400/[0.06]' : l.op === '-' ? 'text-red-300 bg-red-400/[0.06]' : 'text-foreground-subtle'}>
                    {l.op} {l.text}
                  </div>
                ))}
              </pre>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={() => void apply()} disabled={busy || !pending || !want} className="px-2.5 py-1 rounded-md text-[11px] bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-50">
              Add to Gemini CLI
            </button>
            <button onClick={() => { setShown(null); setMessage(null); }} disabled={busy} className="px-2.5 py-1 rounded-md text-[11px] text-foreground-subtle hover:text-foreground">
              {pending ? 'Cancel' : 'Close'}
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
