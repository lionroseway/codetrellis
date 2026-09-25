/**
 * Phase 31 §13 — the sign-off pack, from the Brief.
 *
 * Save it as a PDF (the desktop app prints it in a window nobody sees), or
 * as the page itself — which carries its own data, so it can be verified
 * later from the file alone. "Verify a pack" takes that saved page (or its
 * JSON), re-hashes every file it names inside this plan's project, and says
 * which still match.
 */

import { useCallback, useRef, useState } from 'react';

interface Verification {
  files: Array<{ path: string; sha256: string; now: string | null; verdict: 'matches' | 'changed' | 'missing' }>;
  matches: number;
  changed: number;
  missing: number;
  checkedAt: string;
}

const VERDICT = {
  matches: { glyph: '✓', words: 'matches', tone: 'text-emerald-300' },
  changed: { glyph: '⚠', words: 'changed since', tone: 'text-amber-300' },
  missing: { glyph: '✕', words: 'missing or unreadable', tone: 'text-red-300' },
} as const;

export function SignoffPackControls({ planUid, planTitle }: { planUid: string; planTitle: string }) {
  const exportPdf = window.electronAPI?.exportSignoffPdf;
  const [busy, setBusy] = useState<'pdf' | 'page' | 'verify' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<Verification | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const savePdf = useCallback(async () => {
    if (!exportPdf) return;
    setBusy('pdf');
    setMessage(null);
    try {
      const r = await exportPdf(planUid);
      if (r.ok) setMessage(`Saved to ${r.path}`);
      else if (r.reason !== 'cancelled') setMessage(`Could not save the PDF: ${r.reason}`);
    } finally {
      setBusy(null);
    }
  }, [exportPdf, planUid]);

  const savePage = useCallback(async () => {
    setBusy('page');
    setMessage(null);
    try {
      const res = await fetch(`/api/plans/${planUid}/signoff-pack.html`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = new Blob([await res.text()], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sign-off-pack-${planTitle.replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'plan'}.html`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setMessage(`Could not save the page: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }, [planUid, planTitle]);

  const verify = useCallback(async (file: File) => {
    setBusy('verify');
    setMessage(null);
    setResult(null);
    try {
      const res = await fetch(`/api/plans/${planUid}/signoff-pack/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: await file.text(),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setResult(data as Verification);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  }, [planUid]);

  const button = 'text-[12px] px-2 py-1 rounded-md border border-white/[0.08] text-foreground-muted hover:text-foreground hover:bg-white/[0.04] disabled:opacity-50 text-left';

  return (
    <section className="mt-6" data-testid="signoff-pack">
      <h2 className="text-[11px] uppercase tracking-[0.1em] text-foreground-subtle font-semibold mb-2">Sign-off pack</h2>
      <div className="flex flex-col gap-1.5">
        {exportPdf && (
          <button className={button} onClick={savePdf} disabled={!!busy}>
            {busy === 'pdf' ? 'Making the PDF…' : 'Save as PDF'}
          </button>
        )}
        <button className={button} onClick={savePage} disabled={!!busy} title="The page carries its own data, so it can be verified later">
          {busy === 'page' ? 'Saving…' : 'Save as page'}
        </button>
        <button className={button} onClick={() => fileInput.current?.click()} disabled={!!busy} title="Choose a saved pack page (.html) or its data (.json)">
          {busy === 'verify' ? 'Checking the files…' : 'Verify a pack…'}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".html,.htm,.json"
          className="hidden"
          data-testid="signoff-pack-verify-input"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void verify(f); }}
        />
      </div>
      {message && <p className="mt-2 text-[11.5px] text-foreground-subtle break-words">{message}</p>}
      {result && (
        <div className="mt-2 text-[11.5px]" data-testid="signoff-pack-verification">
          <p className="text-foreground-muted">
            {result.files.length === 0
              ? 'This pack names no files.'
              : `${result.matches} of ${result.files.length} file${result.files.length === 1 ? '' : 's'} still match${result.changed ? `, ${result.changed} changed` : ''}${result.missing ? `, ${result.missing} missing` : ''}.`}
          </p>
          <ul className="mt-1 space-y-0.5">
            {result.files.map((f) => {
              const v = VERDICT[f.verdict];
              return (
                <li key={`${f.path}-${f.sha256}`} className="flex gap-1.5">
                  <span aria-hidden className={v.tone}>{v.glyph}</span>
                  <span className="truncate font-mono text-[10.5px] text-foreground-muted" title={f.path}>{f.path}</span>
                  <span className={`shrink-0 ${v.tone}`}>{v.words}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
