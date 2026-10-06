import { useCallback, useEffect, useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import { useProjectStore } from '../../stores/project-store';
import { useUiStore } from '../../stores/ui-store';
import { absoluteFilePath, openFileAt } from '../../lib/open-file-at';
import { compareRuns, type ComparedFinding } from '../../../shared/lib/check-compare';
import { ATTENTION, chipClass } from '../../lib/visual-language';
import { reachWords } from '../../../shared/lib/check-words';
import { reviewWords, type AgentFinding, type AgentReview } from '../../../shared/lib/agent-review';

interface Finding extends ComparedFinding { suite: string }
interface Run {
  id: string; mine: boolean; who: string; verified: boolean; ranIn: string; commit: string | null; base: string | null; scope: string | null;
  outcome: { ok: boolean; files: number; blocks: number; warns: number }; says: string[]; findings: Finding[]; at: number; words: string;
  /** C4b: an agent's review, when the run is one. */
  review?: AgentReview | null;
}
interface Suite { suite: string }

const CI = /Actions|CI\b|Pipelines|Jenkins|Buildkite|CircleCI/;
type Filter = 'all' | 'failing' | 'mine' | 'ci';

/** A run's outcome in a glyph and words (G1): never colour alone. */
function outcomeOf(r: Run): { glyph: string; tone: string; words: string } {
  // C4b: a review says what it found, in its own words and glyph.
  if (r.review) {
    const words = reviewWords(r.review);
    const tone = r.review.outcome === 'error' ? 'text-red-300' : r.review.outcome === 'findings' ? 'text-amber-300' : r.review.outcome === 'pass' ? 'text-emerald-300' : 'text-foreground-muted';
    return { glyph: words.slice(0, 1), tone, words: words.slice(2) };
  }
  if (!r.outcome.ok) return { glyph: '✗', tone: 'text-red-300', words: `${r.outcome.blocks} ${r.outcome.blocks === 1 ? 'blocks' : 'block'}` };
  if (r.outcome.warns) return { glyph: '⚠', tone: 'text-amber-300', words: `conforms · ${r.outcome.warns} ${r.outcome.warns === 1 ? 'warns' : 'warn'}` };
  return { glyph: '✓', tone: 'text-emerald-300', words: 'conforms' };
}

const ago = (at: number) => {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : new Date(at).toLocaleDateString();
};

/**
 * The Checks view (Phase 33 G9; AGENT-CHECKS-AND-REVIEW §3.3): beside the
 * rules, what the checks say. Run any check from the app, over this work's
 * changes since its base, at any scope; the runs from anywhere, this device's
 * and (with task state shared) CI's and teammates', each marked with where it
 * ran; open one for its findings, each with a way to its place; compare two.
 */
export function ChecksView() {
  const root = useProjectStore((s) => s.root);
  const [runs, setRuns] = useState<Run[]>([]);
  const [suites, setSuites] = useState<string[]>([]);
  // In the store, so the code gutter, the inspector and the Brief can open a run here (G10).
  const open = useUiStore((s) => s.checkRunOpen);
  const setOpen = useUiStore((s) => s.setCheckRunOpen);
  const [against, setAgainst] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [scope, setScope] = useState('');
  const [base, setBase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!root) return;
    try {
      const r = await fetch(`/api/check-runs?project=${encodeURIComponent(root)}&limit=100`);
      if (r.ok) setRuns(((await r.json()) as { runs: Run[] }).runs);
      const s = await fetch(`/api/rules?project=${encodeURIComponent(root)}`);
      if (s.ok) setSuites((((await s.json()) as { suites?: Suite[] }).suites ?? []).map((x) => x.suite).filter((x) => x !== 'config.json'));
    } catch { /* keeps what is shown */ }
  }, [root]);

  useEffect(() => {
    void load();
    const again = () => { void load(); };
    window.addEventListener('check-runs-changed', again);
    window.addEventListener('rules-changed', again);
    return () => { window.removeEventListener('check-runs-changed', again); window.removeEventListener('rules-changed', again); };
  }, [load]);

  const run = async () => {
    if (!root) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/check-runs?project=${encodeURIComponent(root)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(scope ? { suite: scope } : {}), ...(base.trim() ? { base: base.trim() } : {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as { run?: string; error?: string };
      if (!res.ok) { setError(body.error ?? `Server returned ${res.status}`); return; }
      await load();
      if (body.run) { setOpen(body.run); setAgainst(null); }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const shown = useMemo(() => runs.filter((r) => filter === 'all'
    || (filter === 'failing' && !r.outcome.ok)
    || (filter === 'mine' && r.mine)
    || (filter === 'ci' && CI.test(r.ranIn))), [runs, filter]);
  const opened = runs.find((r) => r.id === open) ?? null;
  const other = runs.find((r) => r.id === against) ?? null;
  const comparison = opened && other ? compareRuns(other, opened) : null;

  if (!root) return null;
  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="checks-view">
      <div className="shrink-0 border-b border-border px-6 py-2 flex flex-wrap items-center gap-3 text-[12px]" data-testid="check-run-form">
        <span className="text-foreground-muted">Check this work&apos;s changes against</span>
        <select value={scope} onChange={(e) => setScope(e.target.value)} className="rounded border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-foreground" data-testid="check-scope">
          <option value="">every rule</option>
          {suites.map((s) => <option key={s} value={s}>the {s} suite</option>)}
        </select>
        <span className="text-foreground-muted">since</span>
        <input value={base} onChange={(e) => setBase(e.target.value)} placeholder="origin's default branch" className="w-44 rounded border border-white/[0.08] bg-white/[0.03] px-2 py-1 font-mono text-foreground placeholder:text-foreground-subtle" data-testid="check-base" />
        <button type="button" onClick={() => { void run(); }} disabled={busy} className="flex items-center gap-1.5 rounded bg-accent/20 px-3 py-1 text-foreground hover:bg-accent/30 disabled:opacity-40" data-testid="check-run">
          <Play size={12} /> {busy ? 'Checking…' : 'Run now'}
        </button>
        {error && <span className="text-red-300" role="alert" data-testid="check-error">{error}</span>}
      </div>
      <div className="flex-1 min-h-0 flex">
        <aside className="w-80 shrink-0 border-r border-border overflow-y-auto p-3 space-y-1 text-[12px]" data-testid="check-runs">
          <div className="flex gap-1 pb-1" role="group" aria-label="Show">
            {(['all', 'failing', 'mine', 'ci'] as const).map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f} data-testid={`check-filter-${f}`}
                className={`rounded px-2 py-0.5 text-[11px] ${filter === f ? 'bg-accent/15 text-foreground' : 'text-foreground-muted hover:bg-white/[0.04]'}`}>
                {f === 'ci' ? 'CI' : f}
              </button>
            ))}
          </div>
          {shown.length === 0 && <p className="px-2 py-3 text-foreground-muted" data-testid="check-runs-empty">{runs.length === 0 ? 'No check has run in this project yet. Run one above, or from the command line or CI.' : 'No run matches.'}</p>}
          {shown.map((r) => {
            const o = outcomeOf(r);
            return (
              <button key={r.id} type="button" onClick={() => { setOpen(r.id); if (against === r.id) setAgainst(null); }} data-testid="check-run-row" data-run={r.id} aria-current={open === r.id ? "true" : undefined} title={r.words}
                className={`w-full text-left rounded px-2 py-1.5 ${open === r.id ? 'bg-accent/10' : 'hover:bg-white/[0.04]'}`}>
                <div className="flex items-baseline gap-1.5">
                  <span className={o.tone} aria-hidden>{o.glyph}</span>
                  <span className="text-foreground">{r.scope ?? 'every rule'}</span>
                  <span className="ml-auto text-foreground-subtle text-[11px]">{ago(r.at)}</span>
                </div>
                <div className="text-[11px] text-foreground-muted" data-testid="check-run-where">{r.who} in {r.ranIn}{r.verified ? '' : ' · unverified'}</div>
              </button>
            );
          })}
        </aside>
        <main className="flex-1 min-w-0 overflow-y-auto p-6 space-y-4 text-[12px]" data-testid="check-run-detail">
          {!opened ? <p className="text-foreground-muted">Open a run to see what it found.</p> : (
            <>
              <header className="space-y-1">
                <div className="flex items-baseline gap-2">
                  <span className={outcomeOf(opened).tone}>{outcomeOf(opened).glyph}</span>
                  <h3 className="text-[13px] font-semibold text-foreground">{opened.scope ?? 'Every rule'} · {outcomeOf(opened).words}</h3>
                </div>
                <p className="text-foreground-muted" data-testid="check-run-words">{opened.words}</p>
                <p className="text-foreground-subtle">
                  {opened.outcome.files} changed {opened.outcome.files === 1 ? 'file' : 'files'}
                  {opened.base ? <> since <span className="font-mono">{opened.base.slice(0, 12)}</span></> : null}
                  {opened.commit ? <> · at <span className="font-mono">{opened.commit.slice(0, 7)}</span></> : null}
                </p>
              </header>

              {opened.review ? <ReviewFindings review={opened.review} root={root} /> : <Findings findings={opened.findings} root={root} />}

              {opened.says.filter((s) => !/ now imports .*, which the rule “/.test(s)).length > 0 && (
                <section className="space-y-1" data-testid="check-run-also">
                  <h4 className="text-[10px] uppercase tracking-wide text-foreground-subtle">Also</h4>
                  {opened.says.filter((s) => !/ now imports .*, which the rule “/.test(s)).map((s) => <p key={s} className="text-foreground-muted">{s}</p>)}
                </section>
              )}

              <section className="space-y-2 border-t border-white/[0.06] pt-3" data-testid="check-compare">
                <label className="flex items-center gap-2 text-foreground-muted">
                  Compare with
                  <select value={against ?? ''} onChange={(e) => setAgainst(e.target.value || null)} className="rounded border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-foreground" data-testid="check-compare-with">
                    <option value="">another run…</option>
                    {runs.filter((r) => r.id !== opened.id).map((r) => <option key={r.id} value={r.id}>{r.who} in {r.ranIn}, {ago(r.at)}</option>)}
                  </select>
                </label>
                {comparison && (
                  <div className="space-y-2" data-testid="check-comparison">
                    <p className="text-foreground" data-testid="check-comparison-words">{comparison.words}</p>
                    {([['New', comparison.added, 'check-new'], ['Fixed', comparison.fixed, 'check-fixed'], ['Unchanged', comparison.unchanged, 'check-unchanged']] as const).map(([title, list, id]) => list.length > 0 && (
                      <div key={id} data-testid={id}>
                        <div className="text-[10px] uppercase tracking-wide text-foreground-subtle">{title}</div>
                        {list.map((f) => <div key={`${f.rule}${f.path}${f.imports}`} className="font-mono text-foreground-muted">{f.path} → {f.imports} <span className="text-foreground-subtle">({f.rule})</span></div>)}
                      </div>
                    ))}
                    {comparison.saysAdded.map((s) => <p key={`+${s}`} className="text-foreground-muted">New: {s}</p>)}
                    {comparison.saysGone.map((s) => <p key={`-${s}`} className="text-foreground-subtle line-through">{s}</p>)}
                  </div>
                )}
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

/** A run's findings by suite, then rule, each with a way to its place: [graph] and [code]. */
function Findings({ findings, root }: { findings: Finding[]; root: string }) {
  const setSelectedNode = useUiStore((s) => s.setSelectedNode);
  const setWorkspaceMode = useUiStore((s) => s.setWorkspaceMode);
  if (findings.length === 0) return <p className="text-emerald-300" data-testid="check-run-clean">✓ No import this change adds breaks a rule.</p>;
  const bySuite = new Map<string, Finding[]>();
  for (const f of findings) bySuite.set(f.suite, [...(bySuite.get(f.suite) ?? []), f]);
  return (
    <div className="space-y-3">
      {[...bySuite].map(([suite, list]) => (
        <section key={suite} className="space-y-1.5" data-testid="check-run-suite">
          <h4 className="text-[11px] font-semibold text-foreground">{suite}</h4>
          {list.map((f) => (
            <div key={`${f.rule}${f.path}${f.imports}`} className="rounded border border-white/[0.06] bg-white/[0.02] px-3 py-2 space-y-1" data-testid="check-finding">
              <div className="flex items-baseline gap-2">
                <span className={f.failing ? 'text-red-300' : 'text-amber-300'}>{f.failing ? '✗' : '⚠'}</span>
                <span className="font-mono text-foreground">{f.rule}</span>
                <span className="text-foreground-subtle">({f.strength})</span>
                <span className="text-foreground-muted min-w-0">{f.words}</span>
              </div>
              <div className="flex items-baseline gap-2 pl-5">
                <span className={`rounded-full border px-1.5 text-[10.5px] ${chipClass(ATTENTION.breach.tone)}`} data-testid="check-finding-where">{ATTENTION.breach.glyph} {f.path} {reachWords(f.imports)}</span>
                <button type="button" className="text-sky-300/90 hover:underline text-[11px]" data-testid="check-finding-graph"
                  onClick={() => { setSelectedNode(f.path, 'file'); setWorkspaceMode('graph'); }}>graph</button>
                <button type="button" className="text-sky-300/90 hover:underline text-[11px]" data-testid="check-finding-code"
                  onClick={() => { void openFileAt(absoluteFilePath(root, f.path)); }}>code</button>
              </div>
              {f.fix && <div className="pl-5 text-foreground-muted" data-testid="check-finding-fix">→ {f.fix}</div>}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

const KIND_GLYPH: Record<AgentFinding['kind'], { glyph: string; tone: string }> = {
  rule: { glyph: '✗', tone: 'text-red-300' },
  bug: { glyph: '✗', tone: 'text-red-300' },
  risk: { glyph: '⚠', tone: 'text-amber-300' },
  question: { glyph: '?', tone: 'text-sky-300' },
  suspicious: { glyph: '⚑', tone: 'text-fuchsia-300' },
};

/**
 * Phase 33 C4b — an agent's review: who reviewed and its outcome, each
 * finding that held with where it is and what to do, and what was dropped,
 * with why. Only grounded findings are findings; the rest are said, apart.
 */
function ReviewFindings({ review, root }: { review: AgentReview; root: string }) {
  return (
    <div className="space-y-3" data-testid="check-review">
      <p className="text-foreground" data-testid="check-review-words">{review.agent}&apos;s review: {reviewWords(review)}</p>
      {review.findings.length === 0 && review.outcome === 'pass' && <p className="text-emerald-300">✓ It found nothing to raise in the change.</p>}
      {review.findings.map((f, i) => (
        <div key={i} className="rounded border border-white/[0.06] bg-white/[0.02] px-3 py-2 space-y-1" data-testid="check-review-finding" data-kind={f.kind}>
          <div className="flex items-baseline gap-2">
            <span className={KIND_GLYPH[f.kind].tone}>{KIND_GLYPH[f.kind].glyph}</span>
            <span className="text-foreground-muted">{f.kind}{f.rule ? ` · ${f.rule}` : ''}</span>
            {f.path && (
              <button type="button" className="font-mono text-sky-300/90 hover:underline text-[11px]" data-testid="check-review-where"
                onClick={() => { void openFileAt(absoluteFilePath(root, f.path!), f.start ?? undefined); }}>
                {f.path}{f.start ? `:${f.start}${f.end && f.end !== f.start ? `–${f.end}` : ''}` : ''}
              </button>
            )}
          </div>
          <p className="text-foreground">{f.says}</p>
          {f.quote && <pre className="font-mono text-[11px] text-foreground-muted whitespace-pre-wrap">{f.quote}</pre>}
          {f.fix && <p className="text-foreground-muted">→ {f.fix}</p>}
        </div>
      ))}
      {review.dropped.length > 0 && (
        <details className="text-foreground-muted" data-testid="check-review-dropped">
          <summary className="cursor-pointer">{review.dropped.length} not grounded in the change, and dropped</summary>
          <ul className="mt-1 space-y-0.5 pl-4">
            {review.dropped.map((d, i) => <li key={i}>{d.says} <span className="text-foreground-subtle">({d.why})</span></li>)}
          </ul>
        </details>
      )}
      {review.refused.length > 0 && (
        <p className="text-foreground-muted" data-testid="check-review-refused">It reached for what it may not use: {review.refused.join(', ')}.</p>
      )}
    </div>
  );
}
