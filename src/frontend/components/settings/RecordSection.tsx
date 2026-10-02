import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import type { RecordCheck } from '../../../shared/types/record';

/**
 * Settings → Data → The record (Phase 32 B10.1).
 *
 * Everything CodeTrellis keeps about what agents did and what people
 * decided is linked into a hash chain as it is written. This walks it and
 * says, in one sentence, whether any of it changed afterwards, and which
 * entries if so. Walked when the section opens, and again on asking.
 */

const KIND: Record<string, string> = {
  changed: 'content changed',
  removed: 'removed',
  relinked: 'link changed',
  unlinked: 'added around the record',
};

const day = (ms: number) => new Date(ms).toLocaleString();

export function RecordSection() {
  const [check, setCheck] = useState<RecordCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const verify = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/record');
      if (!res.ok) { setError(`Could not walk the record: the server returned ${res.status}.`); return; }
      setCheck((await res.json()) as RecordCheck);
    } catch (e) {
      setError(`Could not walk the record: ${e instanceof Error ? e.message : String(e)}.`);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void verify(); }, [verify]);

  return (
    <div data-testid="record-section" className="mt-5 pt-4 border-t border-white/[0.06] space-y-2">
      <div className="text-[12px] font-medium text-foreground">The record</div>
      <p className="text-[11px] text-foreground-muted leading-relaxed">
        What agents did and what people decided (criteria, breakpoints, signals, spec proposals, rules) is linked into a
        chain as it is written, so a change made afterwards is found here.
      </p>
      {check && (
        <div className="flex items-start gap-2">
          {check.ok
            ? <ShieldCheck size={14} className="mt-0.5 text-success shrink-0" aria-hidden />
            : <ShieldAlert size={14} className="mt-0.5 text-danger shrink-0" aria-hidden />}
          <div data-testid="record-words" data-ok={check.ok ? 'true' : 'false'} className={`text-[11.5px] ${check.ok ? 'text-foreground' : 'text-red-300'}`}>
            {check.words}
          </div>
        </div>
      )}
      {check && check.problems.length > 0 && (
        <ul data-testid="record-problems" className="ml-6 space-y-0.5 text-[10.5px] text-foreground-muted">
          {check.problems.slice(0, 8).map((p, i) => (
            <li key={`${p.seq}-${p.eventId}-${i}`} data-testid="record-problem">
              {p.seq !== null ? `#${p.seq}` : 'An event'} · {KIND[p.kind]}
              {p.type ? ` · ${p.type.replace(/_/g, ' ')}` : ''}{p.agentType ? ` by ${p.agentType}` : ''}{p.at ? ` · ${day(p.at)}` : ''}
            </li>
          ))}
          {check.problems.length > 8 && <li>and {check.problems.length - 8} more</li>}
        </ul>
      )}
      {check && check.entries > 0 && (
        <div data-testid="record-head" className="ml-6 text-[10px] text-foreground-subtle font-mono" title={check.head.hash}>
          Latest entry #{check.head.seq} · {check.head.hash.slice(0, 12)}…
        </div>
      )}
      {error && <div role="alert" data-testid="record-error" className="text-[11px] text-red-300">{error}</div>}
      <button
        data-testid="record-verify"
        onClick={() => void verify()}
        disabled={busy}
        className="text-[11px] px-2.5 py-1 rounded border border-white/[0.08] text-foreground-muted hover:text-foreground hover:bg-white/[0.04] disabled:opacity-50"
      >
        {busy ? 'Checking…' : 'Check it again'}
      </button>
    </div>
  );
}
