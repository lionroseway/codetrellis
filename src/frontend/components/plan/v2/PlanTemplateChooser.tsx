/**
 * "Start from a template", on an empty plan.
 *
 * Phase 17.E built this with its own client-only list of templates, which
 * shared nothing with the backend's `PLAN_TEMPLATES`. So a template existed
 * in one picker and not the other — the Phase 20–28 failure mode exactly —
 * and a team's published templates and the playbooks Phase 31 added never
 * reached an empty plan at all.
 *
 * Phase 31 §14: one registry. This lists `/api/plan-templates` (built-ins,
 * the user's, and the project's own) and fills THIS plan through
 * `/api/plans/:uid/apply-template`, which takes the project from the plan
 * and seeds each item's acceptance criteria with it. A template with
 * placeholders asks for them first.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowRightLeft, BarChart3, Bug, Layers, PackagePlus, Rocket, Ticket, Wand2, Zap, type LucideIcon,
} from 'lucide-react';
import { usePlanStore } from '../../../stores/plan-store';
import { usePlanItemsStore } from '../../../stores/plan-items-store';
import { useProjectStore } from '../../../stores/project-store';
import { describeTemplateShape, type PlanTemplateSummary } from '../PlanTemplatePicker';

/** Built-ins have their own icon; anything else — a team's own — gets the wand. */
const ICONS: Record<string, { Icon: LucideIcon; tint: string }> = {
  'analysis-report': { Icon: BarChart3, tint: 'text-sky-300' },
  refactor: { Icon: ArrowRightLeft, tint: 'text-purple-400' },
  'mass-refactor': { Icon: ArrowRightLeft, tint: 'text-purple-300' },
  'new-feature': { Icon: Rocket, tint: 'text-accent' },
  'bug-fix': { Icon: Bug, tint: 'text-red-400' },
  'library-migration': { Icon: PackagePlus, tint: 'text-emerald-400' },
  'api-change': { Icon: Layers, tint: 'text-cyan-400' },
  'perf-pass': { Icon: Zap, tint: 'text-amber-400' },
  'from-ticket': { Icon: Ticket, tint: 'text-foreground-muted' },
};

export function PlanTemplateChooser() {
  const plan = usePlanStore((s) => s.activePlan);
  const fetchPlans = usePlanStore((s) => s.fetchPlans);
  const projectRoot = useProjectStore((s) => s.root);
  const hydratePlan = usePlanItemsStore((s) => s.hydratePlan);
  const selectItem = usePlanItemsStore((s) => s.selectItem);

  const [templates, setTemplates] = useState<PlanTemplateSummary[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [asking, setAsking] = useState<PlanTemplateSummary | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [applying, setApplying] = useState<string | null>(null);
  const [applyError, setApplyError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const url = projectRoot ? `/api/plan-templates?project=${encodeURIComponent(projectRoot)}` : '/api/plan-templates';
    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
        return res.json() as Promise<PlanTemplateSummary[]>;
      })
      .then((list) => { if (!cancelled) setTemplates(Array.isArray(list) ? list : []); })
      .catch((err) => { if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [projectRoot]);

  const apply = useCallback(async (template: PlanTemplateSummary, placeholderValues?: Record<string, string>) => {
    if (!plan) return;
    setApplying(template.id);
    setApplyError('');
    try {
      const res = await fetch(`/api/plans/${plan.uid}/apply-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: template.id, placeholderValues }),
      });
      const data = await res.json().catch(() => null) as { items?: Array<{ uid: string }>; error?: string } | null;
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setAsking(null);
      await hydratePlan(plan.uid);
      fetchPlans(projectRoot ?? undefined);
      const first = data?.items?.[0]?.uid;
      if (first) selectItem(first);
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(null);
    }
  }, [plan, hydratePlan, fetchPlans, projectRoot, selectItem]);

  const choose = useCallback((t: PlanTemplateSummary) => {
    if ((t.placeholders ?? []).length === 0) { void apply(t); return; }
    const init: Record<string, string> = {};
    for (const p of t.placeholders ?? []) init[p.key] = p.default ?? '';
    setValues(init);
    setApplyError('');
    setAsking(t);
  }, [apply]);

  return (
    <div className="space-y-3" data-testid="plan-template-chooser">
      <div className="flex items-center gap-2">
        <Wand2 size={13} className="text-accent" />
        <span className="text-[12px] font-semibold text-foreground-muted uppercase tracking-wider">
          Start from a template
        </span>
      </div>

      {loadError && <p className="text-[11.5px] text-red-300">Could not load templates: {loadError}</p>}
      {!templates && !loadError && <p className="text-[11.5px] text-foreground-subtle">Loading templates…</p>}

      {asking ? (
        <form
          className="rounded-lg border border-accent/20 bg-white/[0.02] p-3 space-y-2"
          onSubmit={(e) => { e.preventDefault(); void apply(asking, values); }}
        >
          <div className="text-[13px] text-foreground font-medium">{asking.label}</div>
          {(asking.placeholders ?? []).map((p) => (
            <label key={p.key} className="block">
              <span className="text-[11px] text-foreground-subtle">{p.label ?? p.key}</span>
              <input
                value={values[p.key] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [p.key]: e.target.value }))}
                placeholder={p.default}
                className="mt-0.5 w-full rounded-md border border-white/[0.08] bg-black/20 px-2 py-1 text-[12.5px] text-foreground outline-none focus:border-accent/40"
              />
            </label>
          ))}
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={!!applying}
              className="px-3 py-1 rounded-md bg-accent/80 hover:bg-accent text-[12px] text-white disabled:opacity-50"
            >
              {applying ? 'Applying…' : 'Use this template'}
            </button>
            <button
              type="button"
              onClick={() => setAsking(null)}
              disabled={!!applying}
              className="px-3 py-1 rounded-md text-[12px] text-foreground-subtle hover:text-foreground"
            >
              Back
            </button>
          </div>
        </form>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {(templates ?? []).map((t) => {
            const { Icon, tint } = ICONS[t.id] ?? { Icon: Wand2, tint: 'text-foreground-muted' };
            const shape = describeTemplateShape(t);
            return (
              <button
                key={t.id}
                onClick={() => choose(t)}
                disabled={!!applying}
                title={t.longDescription}
                className="flex items-start gap-2.5 p-3 rounded-lg border border-white/[0.06] bg-white/[0.015] hover:bg-white/[0.04] hover:border-accent/20 text-left transition-colors disabled:opacity-50"
              >
                <Icon size={16} className={`${tint} mt-0.5 shrink-0`} />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-foreground font-medium">
                    {applying === t.id ? 'Applying…' : t.label}
                    {t.source !== 'builtin' && (
                      <span className="ml-1.5 text-[10px] text-foreground-subtle font-normal">
                        {t.source === 'project' ? 'this project' : 'yours'}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-foreground-subtle mt-0.5 leading-relaxed">{t.shortDescription}</div>
                  {shape && <div className="text-[10px] text-foreground-subtle/70 mt-0.5">{shape}</div>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {applyError && <p className="text-[11.5px] text-red-300">{applyError}</p>}
    </div>
  );
}
