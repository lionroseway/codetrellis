import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Layers, X, FolderGit2, User, Package, Loader2, AlertTriangle } from 'lucide-react';
import { usePlanStore } from '../../stores/plan-store';
import { useProjectStore } from '../../stores/project-store';
import { useToastStore } from '../../stores/toast-store';

/**
 * Phase 29 §4.10 — "New plan from template" on the desktop.
 *
 * The backend has had three template endpoints since Phase 12/13
 * (`/api/plan-templates`, `/api/plans/from-template`,
 * `/api/plans/:uid/publish-as-template`) and the mobile companion has
 * shipped a screen for them since Phase 22. Desktop had a `<Layers>`
 * button in the plan list header whose entire behaviour was a toast
 * reading "Template picker coming soon — use MCP
 * create_plan_from_template for now." This is that picker.
 *
 * The part that was genuinely unreachable is not the built-ins — it is
 * `source: 'project'` and `source: 'user'`: templates loaded off disk
 * from `<project>/.codetrellis/templates/` and
 * `~/.codetrellis/templates/`. A team could publish one (over MCP) and
 * then have no way to see it. So the grouping by source is not
 * decoration; it is the feature. A project template is a team
 * convention that travels in git, and it reads differently from a
 * built-in — the UI says which is which and where it came from.
 *
 * Note this is a different operation from `PlanTemplateChooser` (Phase
 * 17.E), which scaffolds the *currently open, empty* plan from
 * hard-coded client-side data. That one fills a plan; this one creates
 * one. They overlap on two ids (`new-feature`, `bug-fix`) and that
 * duplication is recorded in the Phase 29 register as a product
 * decision, not resolved here.
 */

export interface PlanTemplatePlaceholder {
  key: string;
  label?: string;
  default?: string;
}

export interface PlanTemplateSummary {
  id: string;
  label: string;
  shortDescription: string;
  longDescription?: string;
  defaultTitle?: string;
  source: 'builtin' | 'project' | 'user';
  placeholders?: PlanTemplatePlaceholder[];
  phaseCount: number;
  docCount: number;
  /** Present only on V2 (item-tree) templates. */
  version?: number;
  itemCount?: number;
}

/**
 * Source groups, in the order they are shown. Project first: if a team
 * has published a convention, that is the one you are most likely to
 * want, and it is the one that was invisible before.
 */
const SOURCE_GROUPS: Array<{
  source: PlanTemplateSummary['source'];
  label: string;
  hint: string;
  Icon: typeof Layers;
  tint: string;
}> = [
  {
    source: 'project',
    label: 'From this project',
    hint: 'Checked into .codetrellis/templates/ — shared with everyone on the repo.',
    Icon: FolderGit2,
    tint: 'text-emerald-400',
  },
  {
    source: 'user',
    label: 'Yours',
    hint: 'From ~/.codetrellis/templates/ — on this machine only.',
    Icon: User,
    tint: 'text-accent',
  },
  {
    source: 'builtin',
    label: 'Built in',
    hint: 'Shipped with CodeTrellis.',
    Icon: Package,
    tint: 'text-foreground-subtle',
  },
];

/** "3 phases · 7 docs", skipping whichever is zero. Never "0 phases". */
export function describeTemplateShape(t: PlanTemplateSummary): string {
  const parts: string[] = [];
  if (t.itemCount) parts.push(`${t.itemCount} item${t.itemCount === 1 ? '' : 's'}`);
  if (t.phaseCount) parts.push(`${t.phaseCount} phase${t.phaseCount === 1 ? '' : 's'}`);
  if (t.docCount) parts.push(`${t.docCount} doc${t.docCount === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

export function PlanTemplatePicker({ onClose }: { onClose: () => void }) {
  const root = useProjectStore((s) => s.root);
  const fetchPlans = usePlanStore((s) => s.fetchPlans);
  const setActivePlan = usePlanStore((s) => s.setActivePlan);
  const addToast = useToastStore((s) => s.addToast);

  const [templates, setTemplates] = useState<PlanTemplateSummary[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const url = root
      ? `/api/plan-templates?project=${encodeURIComponent(root)}`
      : '/api/plan-templates';
    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
        return res.json() as Promise<PlanTemplateSummary[]>;
      })
      .then((list) => { if (!cancelled) setTemplates(Array.isArray(list) ? list : []); })
      .catch((err) => { if (!cancelled) setLoadError(String(err instanceof Error ? err.message : err)); });
    return () => { cancelled = true; };
  }, [root]);

  const selected = useMemo(
    () => templates?.find((t) => t.id === selectedId) ?? null,
    [templates, selectedId],
  );

  const select = useCallback((t: PlanTemplateSummary) => {
    if (selectedId === t.id) { setSelectedId(null); return; }
    setSelectedId(t.id);
    setCreateError('');
    // NOT the raw defaultTitle: every built-in carries un-substituted
    // placeholders — `Feature: {{feature}}`, `{{ticket}}: {{summary}}` — and
    // this draft is sent verbatim as the plan's title. Every plan created
    // through this picker was named with template syntax. The raw form is
    // still shown, as the input's placeholder, so the shape is visible while
    // the user types.
    setTitleDraft('');
    const init: Record<string, string> = {};
    for (const p of t.placeholders ?? []) init[p.key] = p.default ?? '';
    setValues(init);
  }, [selectedId]);

  const create = useCallback(async () => {
    if (!selected || !root) return;
    setCreating(true);
    setCreateError('');
    try {
      const res = await fetch('/api/plans/from-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: selected.id,
          projectPath: root,
          title: titleDraft.trim() || undefined,
          placeholderValues: values,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      await fetchPlans();
      await setActivePlan(data.plan.uid);
      addToast({
        type: 'success',
        title: 'Plan created',
        message: `${selected.label} — ${describeTemplateShape(selected) || 'empty scaffold'}.`,
      });
      onClose();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }, [selected, root, titleDraft, values, fetchPlans, setActivePlan, addToast, onClose]);

  const grouped = useMemo(() => {
    if (!templates) return [];
    return SOURCE_GROUPS
      .map((g) => ({ ...g, items: templates.filter((t) => t.source === g.source) }))
      .filter((g) => g.items.length > 0);
  }, [templates]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[80vh] rounded-2xl border border-white/[0.08] bg-[#0b1020] shadow-[0_24px_80px_rgba(0,0,0,0.6)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06] shrink-0">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
            <Layers size={13} className="text-accent" />
            New plan from template
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded text-foreground-subtle hover:text-foreground hover:bg-white/[0.05]"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {!root && (
            <div className="flex items-start gap-2 text-[11.5px] text-amber-300/90 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>
                No project is open. Built-in and personal templates are listed, but a plan
                belongs to a project — open one to create from a template.
              </span>
            </div>
          )}

          {templates === null && !loadError && (
            <div className="flex items-center gap-2 py-8 justify-center text-[12px] text-foreground-subtle">
              <Loader2 size={14} className="animate-spin" />
              Loading templates…
            </div>
          )}

          {loadError && (
            <div className="flex items-start gap-2 text-[11.5px] text-red-300 rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3 py-2.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>Could not load templates — {loadError}</span>
            </div>
          )}

          {templates !== null && templates.length === 0 && !loadError && (
            <p className="py-8 text-center text-[12px] text-foreground-subtle leading-relaxed">
              No templates available.
            </p>
          )}

          {grouped.map((group) => {
            const GroupIcon = group.Icon;
            return (
              <section key={group.source} className="space-y-2">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <GroupIcon size={11} className={group.tint} />
                    <span className="text-[10px] uppercase tracking-wider text-foreground-muted font-semibold">
                      {group.label}
                    </span>
                  </div>
                  <p className="text-[10px] text-foreground-subtle leading-relaxed pl-[18px]">
                    {group.hint}
                  </p>
                </div>

                <div className="space-y-1.5">
                  {group.items.map((t) => {
                    const isSelected = selectedId === t.id;
                    const shape = describeTemplateShape(t);
                    return (
                      <div key={`${t.source}:${t.id}`}>
                        <button
                          onClick={() => select(t)}
                          className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
                            isSelected
                              ? 'border-accent/40 bg-accent/[0.08]'
                              : 'border-white/[0.06] bg-white/[0.015] hover:bg-white/[0.04] hover:border-accent/20'
                          }`}
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-[12.5px] text-foreground font-medium truncate">
                              {t.label}
                            </span>
                            {shape && (
                              <span className="text-[10px] text-foreground-subtle shrink-0 font-mono">
                                {shape}
                              </span>
                            )}
                          </div>
                          {t.shortDescription && (
                            <p className="text-[11px] text-foreground-subtle mt-0.5 leading-relaxed">
                              {t.shortDescription}
                            </p>
                          )}
                        </button>

                        {isSelected && (
                          <div className="mt-2 ml-3 pl-3 border-l border-accent/20 space-y-2.5">
                            {t.longDescription && t.longDescription !== t.shortDescription && (
                              <p className="text-[11px] text-foreground-muted leading-relaxed">
                                {t.longDescription}
                              </p>
                            )}

                            <div>
                              <label className="block text-[10px] uppercase tracking-wider text-foreground-subtle mb-1">
                                Plan title
                              </label>
                              <input
                                type="text"
                                value={titleDraft}
                                onChange={(e) => setTitleDraft(e.target.value)}
                                placeholder={t.defaultTitle ?? t.label}
                                className="w-full bg-white/[0.02] border border-white/[0.08] rounded-md px-3 py-1.5 text-[12px] text-foreground focus:outline-none focus:border-accent/40"
                              />
                            </div>

                            {(t.placeholders ?? []).map((p) => (
                              <div key={p.key}>
                                <label className="block text-[10px] uppercase tracking-wider text-foreground-subtle mb-1">
                                  {p.label ?? p.key}
                                </label>
                                <input
                                  type="text"
                                  value={values[p.key] ?? ''}
                                  onChange={(e) => setValues((v) => ({ ...v, [p.key]: e.target.value }))}
                                  placeholder={p.default ?? `{{${p.key}}}`}
                                  className="w-full bg-white/[0.02] border border-white/[0.08] rounded-md px-3 py-1.5 text-[12px] font-mono text-foreground focus:outline-none focus:border-accent/40"
                                />
                              </div>
                            ))}

                            {(t.placeholders?.length ?? 0) > 0 && (
                              <p className="text-[9.5px] text-foreground-subtle leading-relaxed">
                                Substituted everywhere the template writes{' '}
                                <code className="font-mono">{`{{key}}`}</code> — titles, descriptions and doc bodies.
                              </p>
                            )}

                            {createError && (
                              <p className="text-[10.5px] text-red-300">{createError}</p>
                            )}

                            <button
                              onClick={create}
                              disabled={creating || !root}
                              title={root ? undefined : 'Open a project first'}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-[11.5px] rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                              {creating ? <Loader2 size={12} className="animate-spin" /> : <Layers size={12} />}
                              {creating ? 'Creating…' : 'Create plan'}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t border-white/[0.06] shrink-0">
          <p className="text-[10px] text-foreground-subtle leading-relaxed">
            Open a plan and use <span className="text-foreground-muted">Save as template</span> to
            add your own. Project templates live in the repo, so committing one shares it.
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
