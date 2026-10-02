/**
 * Phase 32 B10.4 — the evidence export, from the plan and from the replay bar.
 *
 * "Export evidence" saves one signed page: the record's entries for the
 * plan (or the replay's window) with how to recompute them, the recorded
 * moments, the stack and signals at both ends, the breakpoints and
 * decisions, and, for a plan, its sign-off pack. "Verify evidence…" takes
 * that page (or its JSON) back and says who signed it, whether its chain
 * holds, and, on this computer, whether anything in it was changed in the
 * record since.
 */

import { useCallback, useRef, useState } from 'react';

interface EvidenceCheck {
  ok: boolean;
  seal: { state: 'this-computer' | 'teammate' | 'unknown-key' | 'changed' | 'unsigned'; words: string };
  chain: { ok: boolean; entries: number; words: string };
  here: { state: 'matches' | 'differs' | 'trimmed' | 'not-here'; words: string };
  words: string;
}

const tone = (good: boolean, warn = false) => (good ? 'text-emerald-300' : warn ? 'text-amber-300' : 'text-red-300');

/** What the export covers: a plan, or a window of an opened project. */
export type EvidenceScope = { plan: string } | { project: string; from: number; to: number };

function query(scope: EvidenceScope): string {
  return 'plan' in scope
    ? `plan=${encodeURIComponent(scope.plan)}`
    : `project=${encodeURIComponent(scope.project)}&from=${scope.from}&to=${scope.to}`;
}

const fileName = (name: string) => `evidence-${name.replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'window'}.html`;

export function EvidenceControls({ scope, name, compact = false }: { scope: EvidenceScope | (() => EvidenceScope); name: string; compact?: boolean }) {
  const [busy, setBusy] = useState<'export' | 'verify' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<EvidenceCheck | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const save = useCallback(async () => {
    setBusy('export');
    setMessage(null);
    try {
      const s = typeof scope === 'function' ? scope() : scope;
      const res = await fetch(`/api/evidence?${query(s)}&format=html`);
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      const blob = new Blob([await res.text()], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName(name);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setMessage(`Saved ${a.download}. It is signed by this computer: verify it here or on any CodeTrellis.`);
    } catch (err) {
      setMessage(`Could not export the evidence: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }, [scope, name]);

  const verify = useCallback(async (file: File) => {
    setBusy('verify');
    setMessage(null);
    setResult(null);
    try {
      const res = await fetch('/api/evidence/verify', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: await file.text() });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setResult(data as EvidenceCheck);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  }, []);

  const button = compact
    ? 'text-[10.5px] px-2 py-0.5 rounded-md border border-white/[0.08] text-foreground-muted hover:text-foreground hover:bg-white/[0.04] disabled:opacity-50'
    : 'text-[12px] px-2 py-1 rounded-md border border-white/[0.08] text-foreground-muted hover:text-foreground hover:bg-white/[0.04] disabled:opacity-50 text-left';
  const sealGood = result?.seal.state === 'this-computer' || result?.seal.state === 'teammate';

  return (
    <div data-testid="evidence">
      <div className={compact ? 'flex flex-wrap gap-1.5' : 'flex flex-col gap-1.5'}>
        <button className={button} onClick={() => { void save(); }} disabled={!!busy} data-testid="evidence-export"
          title="One signed page: the record's entries with how to recompute them, the recorded moments, the stack and signals at both ends, and the decisions">
          {busy === 'export' ? 'Exporting…' : 'Export evidence'}
        </button>
        <button className={button} onClick={() => fileInput.current?.click()} disabled={!!busy} title="Choose a saved evidence page (.html) or its data (.json)">
          {busy === 'verify' ? 'Checking…' : 'Verify evidence…'}
        </button>
        <input ref={fileInput} type="file" accept=".html,.htm,.json" className="hidden" data-testid="evidence-verify-input"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void verify(f); }} />
      </div>
      {message && <p className="mt-2 text-[11px] text-foreground-subtle break-words" data-testid="evidence-message">{message}</p>}
      {result && (
        <div className="mt-2 text-[11.5px] space-y-1" data-testid="evidence-verification" data-ok={result.ok ? 'true' : 'false'}>
          <p className={`font-medium ${tone(result.ok)}`}>{result.ok ? '✓ This evidence holds.' : '✕ This evidence does not hold.'}</p>
          <p data-testid="evidence-seal" data-state={result.seal.state} className={tone(sealGood, result.seal.state === 'unknown-key' || result.seal.state === 'unsigned')}>{result.seal.words}</p>
          <p data-testid="evidence-chain" className={tone(result.chain.ok)}>{result.chain.words}</p>
          {result.here.words && (
            <p data-testid="evidence-here" data-state={result.here.state} className={tone(result.here.state === 'matches', result.here.state === 'trimmed' || result.here.state === 'not-here')}>{result.here.words}</p>
          )}
        </div>
      )}
    </div>
  );
}
