import { useCallback, useEffect, useState } from 'react';
import { useProjectStore } from '../../stores/project-store';
import type { RuleView } from '../../../shared/types/architecture-rules';

/**
 * Settings → Architecture rules (Phase 32 A7.1; awareness spec M7).
 *
 * Write a path boundary once: "web/ may not import db/, except db/types.ts,
 * because web talks to db through the API". It is saved in the project's
 * committed settings, so every laptop, agent and pipeline reads the same
 * rule; agents check an import against it before they write it. A rule
 * written today says which imports already break it, rather than hiding them.
 */

const inputCls = 'w-full rounded border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[12px] text-foreground placeholder:text-foreground-subtle font-mono';
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);

export function ArchitectureRulesSection() {
  const root = useProjectStore((s) => s.root);
  const [rules, setRules] = useState<RuleView[]>([]);
  const [from, setFrom] = useState('');
  const [mayNotImport, setMayNotImport] = useState('');
  const [except, setExcept] = useState('');
  const [because, setBecause] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!root) return;
    try {
      const res = await fetch(`/api/rules?project=${encodeURIComponent(root)}`);
      if (res.ok) setRules(((await res.json()) as { rules: RuleView[] }).rules);
    } catch { /* keeps what is shown */ }
  }, [root]);

  useEffect(() => {
    void reload();
    const run = () => { void reload(); };
    window.addEventListener('rules-changed', run);
    return () => window.removeEventListener('rules-changed', run);
  }, [reload]);

  const call = async (method: 'PUT' | 'DELETE', id: string, body?: unknown): Promise<boolean> => {
    if (!root) return false;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/rules/${encodeURIComponent(id)}?project=${encodeURIComponent(root)}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!res.ok) { setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Server returned ${res.status}`); return false; }
      await reload();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!root) return <p className="text-[12px] text-foreground-muted">Open a project to write down its architecture rules.</p>;

  const save = async () => {
    const id = slug(`${from}-not-${mayNotImport}`) || 'rule';
    const ok = await call('PUT', id, {
      from: from.trim(), mayNotImport: mayNotImport.trim(), because: because.trim(),
      except: except.split(',').map((s) => s.trim()).filter(Boolean),
    });
    if (ok) { setFrom(''); setMayNotImport(''); setExcept(''); setBecause(''); setOpen(id); }
  };

  return (
    <div className="space-y-4" data-testid="rules-section">
      <p className="text-[12px] text-foreground leading-relaxed">
        Write down where one part of the code may not reach into another, and why. Rules are saved in the project&apos;s settings, so the
        whole team, every agent and the pipeline check the same ones. Agents are told before they write an import that breaks one; imports
        that break a rule today are listed here, not hidden.
      </p>

      {rules.length > 0 && (
        <div className="rounded border border-white/[0.06] bg-white/[0.02] divide-y divide-white/[0.05] text-[12px]" data-testid="rules-list">
          {rules.map((v) => (
            <div key={v.rule.id} className="px-3 py-2" data-testid="rule">
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-foreground font-mono" data-testid="rule-words">{v.words}</div>
                  <div className="text-[11px] text-foreground-muted">
                    {v.breaches && v.breaches.length > 0 ? (
                      <button type="button" className="text-amber-300 hover:underline" onClick={() => setOpen(open === v.rule.id ? null : v.rule.id)} data-testid="rule-breach-words">
                        {v.breachWords}
                      </button>
                    ) : (
                      <span className={v.breaches ? 'text-emerald-300' : ''} data-testid="rule-breach-words">{v.breachWords}</span>
                    )}
                    {v.rule.by ? ` · set by ${v.rule.by}` : ''}
                  </div>
                </div>
                <button type="button" disabled={busy} onClick={() => { void call('DELETE', v.rule.id); }} data-testid="rule-stop"
                  className="shrink-0 px-2 py-0.5 rounded text-[11.5px] bg-white/[0.06] text-foreground hover:bg-white/[0.1] disabled:opacity-40">
                  Stop
                </button>
              </div>
              {open === v.rule.id && v.breaches && v.breaches.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 font-mono text-[11px] text-foreground-muted" data-testid="rule-breaches">
                  {v.breaches.map((b) => <li key={`${b.from}>${b.to}`} data-testid="rule-breach">{b.from} → {b.to}</li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="rounded border border-white/[0.06] bg-white/[0.02] p-3 space-y-3 text-[12px]" data-testid="rule-form">
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-foreground-muted">Files under</span>
            <input className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} placeholder="web/" data-testid="rule-from" />
          </label>
          <label className="block space-y-1">
            <span className="text-foreground-muted">may not import</span>
            <input className={inputCls} value={mayNotImport} onChange={(e) => setMayNotImport(e.target.value)} placeholder="db/" data-testid="rule-may-not-import" />
          </label>
        </div>
        <label className="block space-y-1">
          <span className="text-foreground-muted">Except (optional, comma-separated)</span>
          <input className={inputCls} value={except} onChange={(e) => setExcept(e.target.value)} placeholder="db/types.ts" data-testid="rule-except" />
        </label>
        <label className="block space-y-1">
          <span className="text-foreground-muted">Because</span>
          <input className={inputCls.replace(' font-mono', '')} value={because} onChange={(e) => setBecause(e.target.value)} placeholder="web talks to db through the API" data-testid="rule-because" />
        </label>
        <p className="text-[11px] text-foreground-subtle">A folder ends in /; a pattern may use * within a name and ** across folders, like src/**/ui/**.</p>
        <button type="button" onClick={() => { void save(); }} disabled={busy || !from.trim() || !mayNotImport.trim()} data-testid="rule-save"
          className="px-3 py-1 rounded text-[12px] bg-accent/20 text-foreground hover:bg-accent/30 disabled:opacity-40">
          Add rule
        </button>
      </div>
      {error && <p className="text-[12px] text-red-300" role="alert" data-testid="rule-error">{error}</p>}
    </div>
  );
}
