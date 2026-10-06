import { useCallback, useEffect, useState } from 'react';
import { useProjectStore } from '../../stores/project-store';
import { RULE_STRENGTHS, type RuleStrength, type RuleView } from '../../../shared/types/architecture-rules';

interface Preview { change: { effect: string; allowed: unknown[] } | null; words: string; needsConfirm: boolean }
type Pending =
  | { kind: 'stop'; id: string; words: string; allowed: number }
  | { kind: 'set'; id: string; body: Record<string, unknown>; words: string; allowed: number };

/** R4 — each strength in a glyph and words, never colour alone. */
const STRENGTH_GLYPH: Record<RuleStrength, string> = { block: '■', warn: '⚠', guide: '○' };
const STRENGTH_WORDS: Record<RuleStrength, string> = {
  block: 'fails the check in CI, and tells agents at once',
  warn: 'said in the check and to agents; CI passes',
  guide: 'shown to agents whose work touches it; never checked',
};

/**
 * Settings → Architecture rules (Phase 32 A7.1; awareness spec M7).
 *
 * Write a path boundary once: "web/ may not import db/, except db/types.ts,
 * because web talks to db through the API". It is saved in a committed suite
 * file, `.codetrellis/rules/architecture.yaml` (Phase 33 R1), so every laptop,
 * agent and pipeline reads the same rule and a pull request reviews a change
 * to it; agents check an import against it before they write it. A rule
 * written today says which imports already break it, rather than hiding them.
 * Rules Phase 32 kept in `.codetrellis/config.json` still count, and are moved
 * to the suite file only when the person says so.
 */

const inputCls = 'w-full rounded border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[12px] text-foreground placeholder:text-foreground-subtle font-mono';
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);

export function ArchitectureRulesSection() {
  const root = useProjectStore((s) => s.root);
  const [rules, setRules] = useState<RuleView[]>([]);
  const [inConfig, setInConfig] = useState(0);
  const [problems, setProblems] = useState<string[]>([]);
  const [from, setFrom] = useState('');
  const [mayNotImport, setMayNotImport] = useState('');
  const [except, setExcept] = useState('');
  const [because, setBecause] = useState('');
  // R4 — a new rule starts at warn: said, and CI passes, until it is made to block.
  const [strength, setStrength] = useState<RuleStrength>('warn');
  const [pending, setPending] = useState<Pending | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!root) return;
    try {
      const res = await fetch(`/api/rules?project=${encodeURIComponent(root)}`);
      if (res.ok) {
        const body = (await res.json()) as { rules: RuleView[]; inConfig?: number; problems?: string[] };
        setRules(body.rules);
        setInConfig(body.inConfig ?? 0);
        setProblems(body.problems ?? []);
      }
    } catch { /* keeps what is shown */ }
  }, [root]);

  useEffect(() => {
    void reload();
    const run = () => { void reload(); };
    window.addEventListener('rules-changed', run);
    return () => window.removeEventListener('rules-changed', run);
  }, [reload]);

  const call = async (method: 'PUT' | 'DELETE' | 'POST', id: string, body?: unknown, query = ''): Promise<boolean> => {
    if (!root) return false;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/rules/${encodeURIComponent(id)}?project=${encodeURIComponent(root)}${query}`, {
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

  // R3 — what a change would do, before it is made. A loosening waits for the
  // person to confirm it, having read what it allows; the app then signs it.
  const preview = async (id: string, body: Record<string, unknown>): Promise<Preview | null> => {
    if (!root) return null;
    try {
      const res = await fetch(`/api/rules/${encodeURIComponent(id)}/preview?project=${encodeURIComponent(root)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) { setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Server returned ${res.status}`); return null; }
      return (await res.json()) as Preview;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  const stop = async (id: string) => {
    const p = await preview(id, { remove: true });
    if (p) setPending({ kind: 'stop', id, words: p.words, allowed: p.change?.allowed.length ?? 0 });
  };

  const confirm = async () => {
    if (!pending) return;
    const ok = pending.kind === 'stop'
      ? await call('DELETE', pending.id, undefined, '&confirm=1')
      : await call('PUT', pending.id, { ...pending.body, confirm: true });
    if (ok && pending.kind === 'set') { setFrom(''); setMayNotImport(''); setExcept(''); setBecause(''); setStrength('warn'); setOpen(pending.id); }
    setPending(null);
  };

  if (!root) return <p className="text-[12px] text-foreground-muted">Open a project to write down its architecture rules.</p>;

  const save = async () => {
    const id = slug(`${from}-not-${mayNotImport}`) || 'rule';
    const body = {
      from: from.trim(), mayNotImport: mayNotImport.trim(), because: because.trim(),
      except: except.split(',').map((s) => s.trim()).filter(Boolean),
      strength,
    };
    // A rule that already exists and would hold less tightly: shown first, then confirmed.
    const p = await preview(id, body);
    if (!p) return;
    if (p.needsConfirm) { setPending({ kind: 'set', id, body, words: p.words, allowed: p.change?.allowed.length ?? 0 }); return; }
    const ok = await call('PUT', id, body);
    if (ok) { setFrom(''); setMayNotImport(''); setExcept(''); setBecause(''); setStrength('warn'); setOpen(id); }
  };

  const confirmPanel = pending && (
    <div className="rounded border border-red-300/30 bg-red-500/[0.06] px-3 py-2 space-y-2 text-[12px]" role="alertdialog" aria-label="Confirm loosening a rule" data-testid="rule-confirm-panel">
      <p className="text-foreground" data-testid="rule-confirm-words">{pending.words}</p>
      <p className="text-[11px] text-foreground-muted">
        Confirming makes the change and signs your approval with your key, beside the rules in <span className="font-mono">.codetrellis/rules/approvals/</span>.
        CI accepts it only if that key is already listed on the base branch.
      </p>
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => { void confirm(); }} data-testid="rule-confirm"
          className="px-2.5 py-0.5 rounded text-[11.5px] bg-red-500/20 text-foreground hover:bg-red-500/30 disabled:opacity-40">
          {pending.kind === 'stop' ? 'Stop it, signed as you' : 'Loosen it, signed as you'}
        </button>
        <button type="button" onClick={() => setPending(null)} data-testid="rule-cancel"
          className="px-2.5 py-0.5 rounded text-[11.5px] bg-white/[0.06] text-foreground hover:bg-white/[0.1]">
          Keep it as it is
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4" data-testid="rules-section">
      <p className="text-[12px] text-foreground leading-relaxed">
        Write down where one part of the code may not reach into another, and why. Rules are saved in <span className="font-mono">.codetrellis/rules/</span>,
        committed with the code, so the whole team, every agent and the pipeline check the same ones, and a pull request shows any change to
        them. Agents are told before they write an import that breaks one; imports that break a rule today are listed here, not hidden.
      </p>

      {inConfig > 0 && (
        <div className="rounded border border-amber-300/25 bg-amber-500/[0.06] px-3 py-2 text-[12px] space-y-2" data-testid="rules-in-config">
          <p className="text-foreground">
            ⚠ {inConfig === 1 ? '1 rule is' : `${inConfig} rules are`} still in <span className="font-mono">.codetrellis/config.json</span>, where earlier versions kept
            them. {inConfig === 1 ? 'It still counts' : 'They still count'}. Moving them to <span className="font-mono">.codetrellis/rules/architecture.yaml</span> lets
            a pull request review a change to them.
          </p>
          <button type="button" disabled={busy} onClick={() => { void call('POST', 'move-from-config'); }} data-testid="rules-move"
            className="px-2 py-0.5 rounded text-[11.5px] bg-white/[0.06] text-foreground hover:bg-white/[0.1] disabled:opacity-40">
            Move {inConfig === 1 ? 'it' : 'them'} to the rules file
          </button>
        </div>
      )}

      {problems.length > 0 && (
        <ul className="rounded border border-red-300/25 bg-red-500/[0.06] px-3 py-2 text-[12px] text-foreground space-y-1" data-testid="rules-problems">
          {problems.map((p) => <li key={p}>✗ {p}</li>)}
        </ul>
      )}

      {rules.length > 0 && (
        <div className="rounded border border-white/[0.06] bg-white/[0.02] divide-y divide-white/[0.05] text-[12px]" data-testid="rules-list">
          {rules.map((v) => (
            <div key={v.rule.id} className="px-3 py-2" data-testid="rule">
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-foreground font-mono" data-testid="rule-words">{v.words}</span>
                    <span className="shrink-0 text-[10.5px] text-foreground-muted" data-testid="rule-strength" title={STRENGTH_WORDS[v.rule.strength]}>
                      {STRENGTH_GLYPH[v.rule.strength]} {v.rule.strength}
                    </span>
                  </div>
                  <div className="text-[11px] text-foreground-muted">
                    {v.breaches && v.breaches.length > 0 ? (
                      <button type="button" className="text-amber-300 hover:underline" onClick={() => setOpen(open === v.rule.id ? null : v.rule.id)} data-testid="rule-breach-words">
                        {v.breachWords}
                      </button>
                    ) : (
                      <span className={v.breaches ? 'text-emerald-300' : ''} data-testid="rule-breach-words">{v.breachWords}</span>
                    )}
                    {v.rule.by ? ` · set by ${v.rule.by}` : ''}
                    {v.where ? <span className="font-mono" data-testid="rule-where"> · {v.where}</span> : null}
                  </div>
                </div>
                <button type="button" disabled={busy} onClick={() => { void stop(v.rule.id); }} data-testid="rule-stop"
                  className="shrink-0 px-2 py-0.5 rounded text-[11.5px] bg-white/[0.06] text-foreground hover:bg-white/[0.1] disabled:opacity-40">
                  Stop
                </button>
              </div>
              {pending?.kind === 'stop' && pending.id === v.rule.id && <div className="mt-2">{confirmPanel}</div>}
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
        <fieldset className="space-y-1" data-testid="rule-strength-choice">
          <legend className="text-foreground-muted">How hard it holds</legend>
          {RULE_STRENGTHS.map((k) => (
            <label key={k} className="flex items-baseline gap-2">
              <input type="radio" name="rule-strength" value={k} checked={strength === k} onChange={() => setStrength(k)} data-testid={`rule-strength-${k}`} />
              <span className="text-foreground">{STRENGTH_GLYPH[k]} {k}</span>
              <span className="text-[11px] text-foreground-subtle">{STRENGTH_WORDS[k]}</span>
            </label>
          ))}
        </fieldset>
        <p className="text-[11px] text-foreground-subtle">A folder ends in /; a pattern may use * within a name and ** across folders, like src/**/ui/**.</p>
        <button type="button" onClick={() => { void save(); }} disabled={busy || !from.trim() || !mayNotImport.trim()} data-testid="rule-save"
          className="px-3 py-1 rounded text-[12px] bg-accent/20 text-foreground hover:bg-accent/30 disabled:opacity-40">
          Add rule
        </button>
      </div>
      {pending?.kind === 'set' && confirmPanel}
      {error && <p className="text-[12px] text-red-300" role="alert" data-testid="rule-error">{error}</p>}
    </div>
  );
}
