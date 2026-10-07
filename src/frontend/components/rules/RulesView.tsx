import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useProjectStore } from '../../stores/project-store';
import { useUiStore } from '../../stores/ui-store';
import { ChecksView } from './ChecksView';
import { RULE_STRENGTHS, type RuleStrength, type RuleView } from '../../../shared/types/architecture-rules';

interface Preview { change: { effect: string; allowed: unknown[] } | null; words: string; needsConfirm: boolean }
interface Proposal {
  uid: string; ruleId: string; status: string; why: string; author: string; createdAt: number;
  now: { words: string; needsConfirm: boolean } | null;
}
type Pending =
  | { kind: 'stop'; id: string; words: string; allowed: number }
  | { kind: 'proposal'; id: string; uid: string; words: string; allowed: number }
  | { kind: 'set'; id: string; body: Record<string, unknown>; words: string; allowed: number };

/** R4 — each strength in a glyph and words, never colour alone. */
const STRENGTH_GLYPH: Record<RuleStrength, string> = { block: '■', warn: '⚠', guide: '○' };
const STRENGTH_WORDS: Record<RuleStrength, string> = {
  block: 'fails the check in CI, and tells agents at once',
  warn: 'said in the check and to agents; CI passes',
  guide: 'shown to agents whose work touches it; never checked',
};

interface Suite { suite: string; where: string; rules: number; breaches: number | null; debt: number; status: 'holds' | 'breaks' | 'unknown'; words: string }
interface HistoryEntry { at: number; ruleId: string | null; change: string; by: string; words: string }
type Shown = RuleView & { debt?: number };

/** A suite's state in a glyph and a word, never colour alone (G1). */
const SUITE_GLYPH: Record<Suite['status'], { glyph: string; tone: string; word: string }> = {
  holds: { glyph: '✓', tone: 'text-emerald-300', word: 'holds' },
  breaks: { glyph: '✗', tone: 'text-red-300', word: 'breaks' },
  unknown: { glyph: '?', tone: 'text-foreground-subtle', word: 'not checked here' },
};

/**
 * The Rules view (Phase 33 G7; RULES-AND-CLARITY §5.6): a workspace of its
 * own, beside graph, plan, docs and code. Rules are made, read and changed
 * here, never in Settings: the suites with whether each holds, its breaches
 * and its debt; each rule with its reason; what agents propose; and the
 * history of changes. A change goes through R3's preview, and a loosening
 * waits for the person's confirm, which the app signs.
 *
 * It began as Settings → Architecture rules (Phase 32 A7.1; awareness spec M7).
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

export function RulesView() {
  const root = useProjectStore((s) => s.root);
  const [rules, setRules] = useState<Shown[]>([]);
  const [suites, setSuites] = useState<Suite[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  // Which suite the list shows; null for every suite.
  const [shownSuite, setShownSuite] = useState<string | null>(null);
  // R5 — a rule is an import boundary, or who alone may import an outside package;
  // R6 — or who alone may import one named export; R7 — or make one call;
  // R8 — or what the files in a folder are.
  const [kind, setKind] = useState<'imports' | 'package' | 'symbol' | 'calls' | 'folder' | 'grep' | 'agent'>('imports');
  // B5: an agent rule's words.
  const [agentWords, setAgentWords] = useState('');
  // B2: a grep rule's text, whether the files must hold it, and how it is read.
  const [grepText, setGrepText] = useState('');
  const [grepMust, setGrepMust] = useState(false);
  const [grepMatch, setGrepMatch] = useState<'exact' | 'glob' | 'regex'>('exact');
  const [fileNames, setFileNames] = useState('');
  const [oneExport, setOneExport] = useState(false);
  const [guide, setGuide] = useState('');
  const [pkg, setPkg] = useState('');
  const [sym, setSym] = useState('');
  const [callTarget, setCallTarget] = useState('');
  const [only, setOnly] = useState('');
  const [suite, setSuite] = useState('');
  const setWorkspaceMode = useUiStore((s) => s.setWorkspaceMode);
  const tab = useUiStore((s) => s.rulesViewTab);
  const setTab = useUiStore((s) => s.setRulesViewTab);
  const [inConfig, setInConfig] = useState(0);
  const [problems, setProblems] = useState<string[]>([]);
  const [from, setFrom] = useState('');
  const [mayNotImport, setMayNotImport] = useState('');
  const [except, setExcept] = useState('');
  const [because, setBecause] = useState('');
  // R4 — a new rule starts at warn: said, and CI passes, until it is made to block.
  const [strength, setStrength] = useState<RuleStrength>('warn');
  const [pending, setPending] = useState<Pending | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!root) return;
    try {
      const res = await fetch(`/api/rules?project=${encodeURIComponent(root)}`);
      if (res.ok) {
        const body = (await res.json()) as { rules: Shown[]; suites?: Suite[]; inConfig?: number; problems?: string[] };
        setRules(body.rules);
        setSuites(body.suites ?? []);
        setInConfig(body.inConfig ?? 0);
        setProblems(body.problems ?? []);
      }
      // R3 — what agents proposed, for the person to decide.
      const p = await fetch(`/api/rules/proposals?project=${encodeURIComponent(root)}`);
      if (p.ok) setProposals(((await p.json()) as { proposals: Proposal[] }).proposals.filter((x) => x.status === 'open'));
      // G7 — what changed, by whom, newest first.
      const h = await fetch(`/api/rules/history?project=${encodeURIComponent(root)}`);
      if (h.ok) setHistory(((await h.json()) as { history: HistoryEntry[] }).history);
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

  const decide = async (uid: string, decision: 'accept' | 'reject', confirmed = false): Promise<boolean> => {
    if (!root) return false;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/rules/proposals/${encodeURIComponent(uid)}/decide?project=${encodeURIComponent(root)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, ...(confirmed ? { confirm: true } : {}) }),
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

  const accept = (p: Proposal) => {
    if (p.now?.needsConfirm) setPending({ kind: 'proposal', id: p.ruleId, uid: p.uid, words: p.now.words, allowed: 0 });
    else void decide(p.uid, 'accept');
  };

  const confirm = async () => {
    if (!pending) return;
    const ok = pending.kind === 'stop'
      ? await call('DELETE', pending.id, undefined, '&confirm=1')
      : pending.kind === 'proposal'
        ? await decide(pending.uid, 'accept', true)
        : await call('PUT', pending.id, { ...pending.body, confirm: true });
    if (ok && pending.kind === 'set') { clearForm(); setOpen(pending.id); }
    setPending(null);
  };

  const clearForm = () => {
    setFrom(''); setMayNotImport(''); setExcept(''); setBecause(''); setPkg(''); setSym(''); setCallTarget(''); setFileNames(''); setOneExport(false); setGuide(''); setOnly(''); setSuite(''); setStrength('warn'); setGrepText(''); setGrepMust(false); setGrepMatch('exact'); setAgentWords('');
  };

  if (!root) return <p className="p-6 text-[12px] text-foreground-muted">Open a project to write down its architecture rules.</p>;

  const list = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean);
  const ready = kind === 'package' ? !!pkg.trim() && list(only).length > 0
    : kind === 'symbol' ? sym.includes('#') && list(only).length > 0
      : kind === 'calls' ? /^(http|sql):./.test(callTarget.trim()) && list(only).length > 0
        : kind === 'folder' ? !!from.trim() && (list(fileNames).length > 0 || oneExport)
          : kind === 'grep' ? list(from).length > 0 && !!grepText.trim()
            : kind === 'agent' ? list(from).length > 0 && !!agentWords.trim()
          : !!from.trim() && !!mayNotImport.trim();

  const save = async () => {
    const id = kind === 'package'
      ? slug(`${pkg.replace(/^[a-z]+:/, '')}-only-${list(only)[0] ?? ''}`) || 'package-rule'
      : kind === 'symbol'
        ? slug(`${sym.split('#')[1] ?? ''}-only-${list(only)[0] ?? ''}`) || 'symbol-rule'
        : kind === 'calls'
          ? slug(`${callTarget.replace(/^(http|sql):/, '')}-only-${list(only)[0] ?? ''}`) || 'call-rule'
          : kind === 'folder'
            ? slug(`${from}-files`) || 'folder-rule'
            : kind === 'grep'
              ? slug(`${grepMust ? 'must' : 'no'}-${grepText}`) || 'grep-rule'
              : kind === 'agent'
                ? slug(agentWords.split(/\s+/).slice(0, 5).join('-')) || 'agent-rule'
            : slug(`${from}-not-${mayNotImport}`) || 'rule';
    const body: Record<string, unknown> = kind === 'package'
      ? { kind: 'package', package: pkg.trim(), only: list(only), because: because.trim(), strength }
      : kind === 'symbol'
        ? { kind: 'symbol', symbol: sym.trim(), only: list(only), because: because.trim(), strength }
        : kind === 'calls'
          ? { kind: 'calls', calls: callTarget.trim(), only: list(only), because: because.trim(), strength }
          : kind === 'folder'
            ? { kind: 'folder', folder: from.trim(), files: list(fileNames), ...(oneExport ? { exports: 'one' } : {}), ...(guide.trim() ? { guide: guide.trim() } : {}), because: because.trim(), strength }
            : kind === 'grep'
              ? { kind: 'grep', in: list(from), ...(list(except).length ? { except: list(except) } : {}), [grepMust ? 'must' : 'mustNot']: grepText.trim(), ...(grepMatch !== 'exact' ? { match: grepMatch } : {}), because: because.trim(), strength }
              : kind === 'agent'
                ? { engine: 'agent', rule: agentWords.trim(), in: list(from), ...(list(except).length ? { except: list(except) } : {}), because: because.trim(), strength }
            : { from: from.trim(), mayNotImport: mayNotImport.trim(), because: because.trim(), except: list(except), strength };
    if (suite.trim()) body.suite = suite.trim();
    // A rule that already exists and would hold less tightly: shown first, then confirmed.
    const p = await preview(id, body);
    if (!p) return;
    if (p.needsConfirm) { setPending({ kind: 'set', id, body, words: p.words, allowed: p.change?.allowed.length ?? 0 }); return; }
    const ok = await call('PUT', id, body);
    if (ok) { clearForm(); setOpen(id); }
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
          {pending.kind === 'stop' ? 'Stop it, signed as you' : pending.kind === 'proposal' ? 'Accept it, signed as you' : 'Loosen it, signed as you'}
        </button>
        <button type="button" onClick={() => setPending(null)} data-testid="rule-cancel"
          className="px-2.5 py-0.5 rounded text-[11.5px] bg-white/[0.06] text-foreground hover:bg-white/[0.1]">
          Keep it as it is
        </button>
      </div>
    </div>
  );

  const listed = shownSuite === null ? rules : rules.filter((v) => (v.rule.suite ?? 'config.json') === shownSuite);

  return (
    <div className="h-full flex flex-col" data-testid="rules-view">
      <header className="shrink-0 border-b border-border px-6 py-3 flex items-baseline gap-4">
        <h2 className="flex items-center gap-2 text-[14px] font-semibold text-foreground"><ShieldCheck size={15} /> Rules</h2>
        {/* G9 — one place, two tabs: what the rules are, and what the checks say. */}
        <div role="tablist" className="flex gap-1 shrink-0" aria-label="Rules view">
          {(['rules', 'checks'] as const).map((t) => (
            <button key={t} type="button" role="tab" onClick={() => setTab(t)} aria-selected={tab === t} data-testid={`rules-tab-${t}`}
              className={`px-2.5 py-0.5 rounded text-[12px] ${tab === t ? 'bg-accent/15 text-foreground' : 'text-foreground-muted hover:bg-white/[0.04]'}`}>
              {t === 'rules' ? 'Rules' : 'Checks'}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-foreground-muted min-w-0">
          Where one part of the code may not reach into another, and why. Kept in <span className="font-mono">.codetrellis/rules/</span>, committed with the
          code: the team, every agent and the pipeline check the same ones, and a pull request shows any change to them.
        </p>
        <button type="button" onClick={() => setWorkspaceMode('graph')} className="ml-auto shrink-0 text-[11px] text-foreground-muted hover:text-foreground" data-testid="rules-view-close">
          Back to graph
        </button>
      </header>
      {tab === 'checks' ? <ChecksView /> : <div className="flex-1 min-h-0 flex">
        <aside className="w-64 shrink-0 border-r border-border overflow-y-auto p-3 space-y-1 text-[12px]" data-testid="rules-suites">
          <div className="text-[10px] uppercase tracking-wide text-foreground-subtle px-2 pb-1">Suites</div>
          <button type="button" onClick={() => setShownSuite(null)} data-testid="rules-suite-all"
            className={`w-full text-left rounded px-2 py-1 ${shownSuite === null ? 'bg-accent/10 text-foreground' : 'text-foreground-muted hover:bg-white/[0.04]'}`}>
            All rules <span className="text-foreground-subtle">· {rules.length}</span>
          </button>
          {suites.map((x) => {
            const g = SUITE_GLYPH[x.status];
            return (
              <button key={x.suite} type="button" onClick={() => setShownSuite(x.suite)} data-testid="rules-suite" title={x.where}
                className={`w-full text-left rounded px-2 py-1.5 ${shownSuite === x.suite ? 'bg-accent/10' : 'hover:bg-white/[0.04]'}`}>
                <div className="flex items-baseline gap-1.5">
                  <span className={g.tone} aria-hidden>{g.glyph}</span>
                  <span className="text-foreground font-medium" data-testid="rules-suite-name">{x.suite}</span>
                  <span className={`ml-auto text-[10.5px] ${g.tone}`} data-testid="rules-suite-status">{g.word}</span>
                </div>
                <div className="text-[11px] text-foreground-muted leading-snug" data-testid="rules-suite-words">{x.words}</div>
              </button>
            );
          })}
        </aside>
        <main className="flex-1 min-w-0 overflow-y-auto p-6 space-y-4" data-testid="rules-section">
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

      {proposals.length > 0 && (
        <div className="rounded border border-violet-300/25 bg-violet-500/[0.05] px-3 py-2 text-[12px] space-y-2" data-testid="rule-proposals">
          <p className="text-foreground font-medium">Proposed by agents ({proposals.length})</p>
          <p className="text-[11px] text-foreground-muted">Nothing changes until you accept. Each says what it would do against the code now.</p>
          {proposals.map((p) => (
            <div key={p.uid} className="space-y-1 border-t border-white/[0.05] pt-2" data-testid="rule-proposal">
              <p className="text-foreground" data-testid="rule-proposal-words">{p.now?.words ?? ''}</p>
              <p className="text-[11px] text-foreground-muted">{p.author}: “{p.why}”</p>
              {pending?.kind === 'proposal' && pending.uid === p.uid ? confirmPanel : (
                <div className="flex gap-2">
                  <button type="button" disabled={busy} onClick={() => accept(p)} data-testid="rule-proposal-accept"
                    className="px-2.5 py-0.5 rounded text-[11.5px] bg-accent/20 text-foreground hover:bg-accent/30 disabled:opacity-40">Accept</button>
                  <button type="button" disabled={busy} onClick={() => { void decide(p.uid, 'reject'); }} data-testid="rule-proposal-reject"
                    className="px-2.5 py-0.5 rounded text-[11.5px] bg-white/[0.06] text-foreground hover:bg-white/[0.1] disabled:opacity-40">Reject</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {problems.length > 0 && (
        <ul className="rounded border border-red-300/25 bg-red-500/[0.06] px-3 py-2 text-[12px] text-foreground space-y-1" data-testid="rules-problems">
          {problems.map((p) => <li key={p}>✗ {p}</li>)}
        </ul>
      )}

          {listed.length > 0 ? (
            <div className="rounded border border-white/[0.06] bg-white/[0.02] divide-y divide-white/[0.05] text-[12px]" data-testid="rules-list">
          {listed.map((v) => (
              <div key={v.rule.id} className="px-3 py-2" data-testid="rule">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-foreground font-mono" data-testid="rule-words">{v.words}</span>
                      <span className="shrink-0 text-[10.5px] text-foreground-muted" data-testid="rule-strength" title={STRENGTH_WORDS[v.rule.strength]}>
                        {STRENGTH_GLYPH[v.rule.strength]} {v.rule.strength}
                      </span>
                    </div>
                    {v.rule.guide && <p className="text-[11.5px] text-foreground-muted italic" data-testid="rule-guide">{v.rule.guide}</p>}
                    <div className="text-[11px] text-foreground-muted">
                      {v.breaches && v.breaches.length > 0 ? (
                        <button type="button" className="text-amber-300 hover:underline" onClick={() => setOpen(open === v.rule.id ? null : v.rule.id)} data-testid="rule-breach-words">
                          {v.breachWords}
                        </button>
                      ) : (
                        <span className={v.breaches ? 'text-emerald-300' : ''} data-testid="rule-breach-words">{v.breachWords}</span>
                      )}
                      {v.debt ? <span data-testid="rule-debt"> · {v.debt} old {v.debt === 1 ? 'breach' : 'breaches'} in the baseline</span> : null}
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
          ) : (
            <p className="text-[12px] text-foreground-muted" data-testid="rules-empty">
              {rules.length === 0 ? 'No rules yet. Write the first below: a boundary between two parts of the code, or who alone may import an outside package.' : 'No rules in this suite.'}
            </p>
          )}

          <section className="rounded border border-white/[0.06] bg-white/[0.02] p-3 space-y-3 text-[12px]" data-testid="rule-form">
            <h3 className="text-[11px] uppercase tracking-wide text-foreground-subtle">New rule</h3>
            <fieldset className="flex flex-wrap gap-x-4 gap-y-1" data-testid="rule-kind">
              <label className="flex items-baseline gap-1.5">
                <input type="radio" name="rule-kind" checked={kind === 'imports'} onChange={() => setKind('imports')} data-testid="rule-kind-imports" />
                <span className="text-foreground">A boundary</span><span className="text-[11px] text-foreground-subtle">files that may not import others</span>
              </label>
              <label className="flex items-baseline gap-1.5">
                <input type="radio" name="rule-kind" checked={kind === 'package'} onChange={() => setKind('package')} data-testid="rule-kind-package" />
                <span className="text-foreground">A package</span><span className="text-[11px] text-foreground-subtle">who alone may import it</span>
              </label>
              <label className="flex items-baseline gap-1.5">
                <input type="radio" name="rule-kind" checked={kind === 'symbol'} onChange={() => setKind('symbol')} data-testid="rule-kind-symbol" />
                <span className="text-foreground">An export</span><span className="text-[11px] text-foreground-subtle">who alone may import one function or name</span>
              </label>
              <label className="flex items-baseline gap-1.5">
                <input type="radio" name="rule-kind" checked={kind === 'calls'} onChange={() => setKind('calls')} data-testid="rule-kind-calls" />
                <span className="text-foreground">A call</span><span className="text-[11px] text-foreground-subtle">who alone may call a host or use a table</span>
              </label>
              <label className="flex items-baseline gap-1.5">
                <input type="radio" name="rule-kind" checked={kind === 'folder'} onChange={() => setKind('folder')} data-testid="rule-kind-folder" />
                <span className="text-foreground">A folder</span><span className="text-[11px] text-foreground-subtle">what its files are named and export</span>
              </label>
              <label className="flex items-baseline gap-1.5">
                <input type="radio" name="rule-kind" checked={kind === 'grep'} onChange={() => setKind('grep')} data-testid="rule-kind-grep" />
                <span className="text-foreground">Text</span><span className="text-[11px] text-foreground-subtle">what files may not, or must, contain</span>
              </label>
              <label className="flex items-baseline gap-1.5">
                <input type="radio" name="rule-kind" checked={kind === 'agent'} onChange={() => setKind('agent')} data-testid="rule-kind-agent" />
                <span className="text-foreground">Words</span><span className="text-[11px] text-foreground-subtle">a rule an agent review judges</span>
              </label>
            </fieldset>
            {kind === 'imports' ? (
              <>
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
              </>
            ) : kind === 'folder' ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <label className="block space-y-1">
                    <span className="text-foreground-muted">Files in</span>
                    <input className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} placeholder="src/backend/services/" data-testid="rule-folder" />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-foreground-muted">are named (comma-separated)</span>
                    <input className={inputCls} value={fileNames} onChange={(e) => setFileNames(e.target.value)} placeholder="*-service.ts" data-testid="rule-files" />
                  </label>
                </div>
                <label className="flex items-baseline gap-2">
                  <input type="checkbox" checked={oneExport} onChange={(e) => setOneExport(e.target.checked)} data-testid="rule-one-export" />
                  <span className="text-foreground-muted">and export one thing each</span>
                </label>
                <label className="block space-y-1">
                  <span className="text-foreground-muted">Guide (optional): what a person or an agent should know, never checked</span>
                  <input className={inputCls} value={guide} onChange={(e) => setGuide(e.target.value)} placeholder="One service per file, named for its domain; pure helpers go in lib/." data-testid="rule-guide-input" />
                </label>
              </div>
            ) : kind === 'agent' ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <label className="block space-y-1">
                    <span className="text-foreground-muted">About the files in (comma-separated)</span>
                    <input className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} placeholder="src/" data-testid="rule-agent-in" />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-foreground-muted">Except (optional, comma-separated)</span>
                    <input className={inputCls} value={except} onChange={(e) => setExcept(e.target.value)} placeholder="**/*.test.ts" data-testid="rule-except" />
                  </label>
                </div>
                <label className="block space-y-1">
                  <span className="text-foreground-muted">The rule, in words</span>
                  <textarea className={`${inputCls.replace(' font-mono', '')} min-h-[3.5rem]`} value={agentWords} onChange={(e) => setAgentWords(e.target.value)}
                    placeholder="Code that moves money records it through services/ledger, never by writing balances directly." data-testid="rule-agent-words" />
                </label>
              </div>
            ) : kind === 'grep' ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <label className="block space-y-1">
                    <span className="text-foreground-muted">Files in (comma-separated)</span>
                    <input className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} placeholder="src/backend/" data-testid="rule-grep-in" />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-foreground-muted">Except (optional, comma-separated)</span>
                    <input className={inputCls} value={except} onChange={(e) => setExcept(e.target.value)} placeholder="**/*.test.ts" data-testid="rule-except" />
                  </label>
                </div>
                <div className="grid grid-cols-[10rem_1fr_9rem] gap-3 items-end">
                  <label className="block space-y-1">
                    <span className="sr-only">May not or must</span>
                    <select className={inputCls.replace(' font-mono', '')} value={grepMust ? 'must' : 'mustNot'} onChange={(e) => setGrepMust(e.target.value === 'must')} data-testid="rule-grep-must">
                      <option value="mustNot">may not contain</option>
                      <option value="must">must each contain</option>
                    </select>
                  </label>
                  <label className="block space-y-1">
                    <span className="text-foreground-muted">The text</span>
                    <input className={inputCls} value={grepText} onChange={(e) => setGrepText(e.target.value)} placeholder="console.log(" data-testid="rule-grep-text" />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-foreground-muted">Read as</span>
                    <select className={inputCls.replace(' font-mono', '')} value={grepMatch} onChange={(e) => setGrepMatch(e.target.value as 'exact' | 'glob' | 'regex')} data-testid="rule-grep-match">
                      <option value="exact">the text itself</option>
                      <option value="glob">a glob (* is anything)</option>
                      <option value="regex">a regex</option>
                    </select>
                  </label>
                </div>
              </div>
            ) : kind === 'calls' ? (
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-foreground-muted">The call</span>
                  <input className={inputCls} value={callTarget} onChange={(e) => setCallTarget(e.target.value)} placeholder="http:api.stripe.com" data-testid="rule-calls" />
                </label>
                <label className="block space-y-1">
                  <span className="text-foreground-muted">may be made only by (comma-separated)</span>
                  <input className={inputCls} value={only} onChange={(e) => setOnly(e.target.value)} placeholder="src/payments/" data-testid="rule-only" />
                </label>
              </div>
            ) : kind === 'symbol' ? (
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-foreground-muted">The export (file#name)</span>
                  <input className={inputCls} value={sym} onChange={(e) => setSym(e.target.value)} placeholder="src/payments/charge.ts#createCharge" data-testid="rule-symbol" />
                </label>
                <label className="block space-y-1">
                  <span className="text-foreground-muted">may be imported only by (comma-separated)</span>
                  <input className={inputCls} value={only} onChange={(e) => setOnly(e.target.value)} placeholder="src/payments/" data-testid="rule-only" />
                </label>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-foreground-muted">The package</span>
                  <input className={inputCls} value={pkg} onChange={(e) => setPkg(e.target.value)} placeholder="npm:stripe" data-testid="rule-package" />
                </label>
                <label className="block space-y-1">
                  <span className="text-foreground-muted">may be imported only by (comma-separated)</span>
                  <input className={inputCls} value={only} onChange={(e) => setOnly(e.target.value)} placeholder="src/payments/index.ts" data-testid="rule-only" />
                </label>
              </div>
            )}
            <div className="grid grid-cols-[1fr_12rem] gap-3">
              <label className="block space-y-1">
                <span className="text-foreground-muted">Because</span>
                <input className={inputCls.replace(' font-mono', '')} value={because} onChange={(e) => setBecause(e.target.value)}
                  placeholder={kind === 'package' ? 'the wrapper sets idempotency keys and retries' : kind === 'grep' ? 'the backend logs through services/logger, which redacts' : 'web talks to db through the API'} data-testid="rule-because" />
              </label>
              <label className="block space-y-1">
                <span className="text-foreground-muted">Suite (optional)</span>
                <input className={inputCls} value={suite} onChange={(e) => setSuite(e.target.value)} placeholder={shownSuite && shownSuite !== 'config.json' ? shownSuite : 'architecture'} data-testid="rule-suite" />
              </label>
            </div>
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
            <p className="text-[11px] text-foreground-subtle">
              {kind === 'package'
                ? 'A package is its ecosystem and name: npm:stripe, pypi:requests, go:github.com/stripe/stripe-go, maven:com.stripe.'
                : kind === 'symbol'
                  ? 'An export is the file that defines it and its name. Importing it through a barrel (an index file that passes it on) counts too.'
                  : kind === 'calls'
                    ? 'A call is http: and a host or a path (http:api.stripe.com, http:/api/admin), or sql: and a table (sql:invoices).'
                    : kind === 'folder'
                      ? 'A name pattern uses * within the name: *-service.ts. Files already there that break it are its debt; a change is judged on the files it adds or renames.'
                    : kind === 'grep'
                      ? 'Every file under those paths is read line by line, in any language. Lines already there that break it are its debt; a change is judged on the lines it adds.'
                    : kind === 'agent'
                      ? 'No code checks it: an agent review judges each change against these words, and a finding must quote the change. With no review run it is a guide. It fails a check only at block.'
                  : 'A folder ends in /; a pattern may use * within a name and ** across folders, like src/**/ui/**.'}
              {' '}You see what it does against the code before it is saved.
            </p>
            <button type="button" onClick={() => { void save(); }} disabled={busy || !ready} data-testid="rule-save"
              className="px-3 py-1 rounded text-[12px] bg-accent/20 text-foreground hover:bg-accent/30 disabled:opacity-40">
              Add rule
            </button>
          </section>
          {pending?.kind === 'set' && confirmPanel}
          {error && <p className="text-[12px] text-red-300" role="alert" data-testid="rule-error">{error}</p>}

          <section className="space-y-1 text-[12px]" data-testid="rules-history">
            <h3 className="text-[11px] uppercase tracking-wide text-foreground-subtle">History</h3>
            {history.length === 0
              ? <p className="text-foreground-muted">No change to the rules has been made in this app yet.</p>
              : history.map((h) => (
                <div key={`${h.at}-${h.words}`} className="flex gap-3" data-testid="rules-history-entry">
                  <span className="shrink-0 w-36 text-foreground-subtle">{new Date(h.at).toLocaleString()}</span>
                  <span className="text-foreground-muted min-w-0">{h.words}</span>
                </div>
              ))}
          </section>
        </main>
      </div>}
    </div>
  );
}
