import { useCallback, useEffect, useState } from 'react';
import { useProjectStore } from '../../stores/project-store';
import { useRecurring } from '../../hooks/useRecurring';

/**
 * Settings → Recurring playbooks (Phase 32 C4.2b; shared-work doc C-4).
 *
 * Make a playbook recur: every day, week or month, at a time in the team's
 * time zone, optionally carrying the last run's open tasks over and naming
 * the skills each run's tasks need. The rule is saved in the project's
 * committed settings, so the whole team sees it and each laptop runs the
 * same series; each run is one plan per period however many laptops start it.
 */

interface TemplateSummary { id: string; label: string; source?: string }

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const inputCls = 'w-full rounded border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[12px] text-foreground placeholder:text-foreground-subtle';
const localZone = (): string => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
const slug = (title: string): string => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);

export function RecurringSection() {
  const root = useProjectStore((s) => s.root);
  const { series, reload } = useRecurring(root);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [playbook, setPlaybook] = useState('');
  const [title, setTitle] = useState('');
  const [every, setEvery] = useState<'day' | 'week' | 'month'>('week');
  const [on, setOn] = useState(1);
  const [at, setAt] = useState('09:00');
  const [timeZone, setTimeZone] = useState(localZone);
  const [carryOver, setCarryOver] = useState(true);
  const [skills, setSkills] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!root) return;
    fetch(`/api/plan-templates?project=${encodeURIComponent(root)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: TemplateSummary[]) => { setTemplates(list); setPlaybook((p) => p || list[0]?.id || ''); })
      .catch(() => setTemplates([]));
  }, [root]);

  const call = useCallback(async (method: 'PUT' | 'DELETE', id: string, body?: unknown, suffix = '') => {
    if (!root) return false;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/recurring/${encodeURIComponent(id)}${suffix}?project=${encodeURIComponent(root)}`, {
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
  }, [root, reload]);

  if (!root) return <p className="text-[12px] text-foreground-muted">Open a project to make one of its playbooks recur.</p>;

  const save = async () => {
    const names = skills.split(',').map((s) => s.trim()).filter(Boolean);
    const ok = await call('PUT', slug(title), {
      playbook, title: title.trim(), every, on: every === 'day' ? 1 : on, at, timeZone: timeZone.trim(), carryOver,
      skills: names.map((name) => ({ name, source: 'skill', required: false })),
    });
    if (ok) { setTitle(''); setSkills(''); }
  };

  return (
    <div className="space-y-4" data-testid="recurring-section">
      <p className="text-[12px] text-foreground leading-relaxed">
        Make a playbook recur, and each period gets a fresh plan from it, with its own tasks and sign-off. The schedule is saved in the
        project&apos;s settings, so the whole team sees it. A run is started when it falls due while the app is open; one that fell due
        while it was closed is asked about in the Awareness tab, never started behind your back. However many laptops start a period&apos;s
        run, it is one plan.
      </p>

      {series.length > 0 && (
        <div className="rounded border border-white/[0.06] bg-white/[0.02] divide-y divide-white/[0.05] text-[12px]" data-testid="recurring-rules">
          {series.map((s) => (
            <div key={s.rule.id} className="flex items-baseline justify-between gap-3 px-3 py-2" data-testid="recurring-rule">
              <div className="min-w-0">
                <div className="text-foreground font-medium">{s.rule.title}</div>
                <div className="text-foreground-muted text-[11px]" data-testid="recurring-rule-words">
                  {s.words} · {s.rule.timeZone} · from the {s.rule.playbook} playbook{s.rule.carryOver ? ' · carries open tasks over' : ''}{s.rule.by ? ` · set by ${s.rule.by}` : ''}
                </div>
                {/* C4.3b — this computer's choice, never the team's: it opens a terminal here. */}
                <label className="mt-1.5 flex items-center gap-2 text-[11px] text-foreground-muted">
                  <span>On this computer, start an agent on each run:</span>
                  <select
                    className="rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-[11px] text-foreground"
                    value={s.agent?.agent ?? ''}
                    disabled={busy}
                    onChange={(e) => { void call('PUT', s.rule.id, { agent: e.target.value || null }, '/agent'); }}
                    data-testid="recurring-rule-agent"
                  >
                    <option value="">Off</option>
                    <option value="claude">Claude Code</option>
                    <option value="codex">Codex</option>
                  </select>
                </label>
                {s.agent && (
                  <div className="mt-0.5 text-[10.5px] text-foreground-subtle" data-testid="recurring-rule-agent-words">
                    A run started here opens a terminal in the project with {s.agent.agent === 'codex' ? 'Codex' : 'Claude Code'} on it. Only on this computer; teammates choose for their own.
                  </div>
                )}
              </div>
              <button type="button" disabled={busy} onClick={() => { void call('DELETE', s.rule.id); }} data-testid="recurring-rule-stop"
                className="shrink-0 px-2 py-0.5 rounded text-[11.5px] bg-white/[0.06] text-foreground hover:bg-white/[0.1] disabled:opacity-40">
                Stop recurring
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="rounded border border-white/[0.06] bg-white/[0.02] p-3 space-y-3 text-[12px]" data-testid="recurring-form">
        <div className="text-foreground-subtle text-[11px] uppercase tracking-wider">Make a playbook recur</div>
        <label className="block space-y-1">
          <span className="text-foreground-muted">Playbook</span>
          <select className={inputCls} value={playbook} onChange={(e) => setPlaybook(e.target.value)} data-testid="recurring-playbook">
            {templates.map((t) => <option key={t.id} value={t.id}>{t.label}{t.source === 'project' ? ' (this project)' : ''}</option>)}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-foreground-muted">Called</span>
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekly security review" data-testid="recurring-title" />
        </label>
        <div className="grid grid-cols-3 gap-2">
          <label className="block space-y-1">
            <span className="text-foreground-muted">Every</span>
            <select className={inputCls} value={every} onChange={(e) => { setEvery(e.target.value as typeof every); setOn(1); }} data-testid="recurring-every">
              <option value="day">day</option>
              <option value="week">week</option>
              <option value="month">month</option>
            </select>
          </label>
          {every === 'week' && (
            <label className="block space-y-1">
              <span className="text-foreground-muted">On</span>
              <select className={inputCls} value={on} onChange={(e) => setOn(Number(e.target.value))} data-testid="recurring-on">
                {WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
              </select>
            </label>
          )}
          {every === 'month' && (
            <label className="block space-y-1">
              <span className="text-foreground-muted">On the</span>
              <input type="number" min={1} max={28} className={inputCls} value={on} onChange={(e) => setOn(Number(e.target.value))} data-testid="recurring-on" />
            </label>
          )}
          <label className="block space-y-1">
            <span className="text-foreground-muted">At</span>
            <input type="time" className={inputCls} value={at} onChange={(e) => setAt(e.target.value)} data-testid="recurring-at" />
          </label>
        </div>
        <label className="block space-y-1">
          <span className="text-foreground-muted">In the time zone (the team&apos;s, so everyone means the same moment)</span>
          <input className={inputCls} value={timeZone} onChange={(e) => setTimeZone(e.target.value)} placeholder="Europe/London" data-testid="recurring-zone" />
        </label>
        <label className="block space-y-1">
          <span className="text-foreground-muted">Skills each run&apos;s tasks need (optional, comma separated)</span>
          <input className={inputCls} value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="security-review" data-testid="recurring-skills" />
        </label>
        <label className="flex items-center gap-2 text-foreground cursor-pointer">
          <input type="checkbox" checked={carryOver} onChange={(e) => setCarryOver(e.target.checked)} data-testid="recurring-carry" />
          Carry the last run&apos;s open tasks into the next
        </label>
        <button type="button" onClick={() => { void save(); }} disabled={busy || !title.trim() || !playbook} data-testid="recurring-save"
          className="px-3 py-1 rounded text-[12px] bg-accent text-white hover:bg-accent-hover disabled:opacity-40">
          Save for the team
        </button>
      </div>
      {error && <p className="text-[12px] text-red-300" role="alert" data-testid="recurring-error">{error}</p>}
    </div>
  );
}
