import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Layers, Crosshair, ExternalLink } from 'lucide-react';
import { useProjectStore } from '../../stores/project-store';
import { useGraphStore } from '../../stores/graph-store';
import { usePlanStore } from '../../stores/plan-store';
import { revealPlanItem } from '../../lib/open-plan-item';
import type { Stack, StackPlan, StackTask, StackDependency } from '@shared/types';

/**
 * The Stack tab (Phase 32 B6.4, observability spec §5, JOURNEYS H1): every
 * active plan in the project at once. One row per plan, called by its ticket
 * key when it has one, with its tasks nested under it: who is on each, the
 * branch it is worked on, what it waits on (a task in another plan is a link
 * to it), and where the plan meets another, in words.
 *
 * "Follow" is one selection across the window: it draws a plan's footprint
 * (the files its tasks name) on the graph, whatever plan is open, and
 * narrows the Timeline to its work (B6.4b). The stack is the same answer an
 * agent gets from `get_stack`.
 */

const REFRESH_MS = 30_000;

const STATUS_DOT: Record<string, string> = {
  done: 'bg-green-400',
  skipped: 'bg-foreground-subtle',
  in_progress: 'bg-accent',
  assigned: 'bg-accent/60',
  blocked: 'bg-red-400',
  pending: 'bg-white/20',
};

export function StackTab() {
  const root = useProjectStore((s) => s.root);
  const [stack, setStack] = useState<Stack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const focus = useGraphStore((s) => s.stackFocus);

  const load = useCallback(async () => {
    if (!root) return;
    try {
      const res = await fetch(`/api/stack?project=${encodeURIComponent(root)}`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      setStack((await res.json()) as Stack);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [root]);

  useEffect(() => {
    void load();
    const run = () => { void load(); };
    const events = ['stack-changed', 'awareness-changed', 'workstreams-changed', 'breakpoints-changed'];
    for (const e of events) window.addEventListener(e, run);
    const id = setInterval(run, REFRESH_MS);
    return () => {
      for (const e of events) window.removeEventListener(e, run);
      clearInterval(id);
    };
  }, [load]);

  // A focused plan that left the stack (finished, archived) leaves the graph too.
  useEffect(() => {
    if (focus && stack && !stack.plans.some((p) => p.uid === focus.planUid)) useGraphStore.getState().setStackFocus(null);
  }, [focus, stack]);

  if (!root) return <div className="text-[11px] text-foreground-subtle py-6 text-center">Open a project to see its plans together.</div>;
  if (!stack && !error) return <div className="text-[11px] text-foreground-subtle py-6 text-center">Reading the stack…</div>;

  const toggle = (uid: string) => setCollapsed((c) => {
    const next = new Set(c);
    if (next.has(uid)) next.delete(uid); else next.add(uid);
    return next;
  });

  return (
    <div className="text-[11px] space-y-2" data-testid="stack-tab">
      {error && <div className="text-red-400 px-2">Could not read the stack: {error}</div>}
      {stack && stack.plans.length === 0 && (
        <div className="text-foreground-subtle py-6 px-4 text-center leading-relaxed" data-testid="stack-empty">
          No plan in this project is under way. A plan shows here from when it is created until it is completed or archived.
        </div>
      )}
      {stack && stack.plans.length > 0 && (
        <>
          <div className="flex items-center gap-1.5 px-2 text-foreground-muted">
            <Layers size={12} />
            <span>
              {stack.plans.length} {stack.plans.length === 1 ? 'plan' : 'plans'} under way, with who is on what and where they meet.
            </span>
          </div>
          {stack.plans.map((plan) => (
            <PlanRow
              key={plan.uid}
              plan={plan}
              open={!collapsed.has(plan.uid)}
              onToggle={() => toggle(plan.uid)}
              focused={focus?.planUid === plan.uid}
            />
          ))}
        </>
      )}
    </div>
  );
}

function PlanRow({ plan, open, onToggle, focused }: { plan: StackPlan; open: boolean; onToggle: () => void; focused: boolean }) {
  const paths = useMemo(() => [...new Set(plan.tasks.flatMap((t) => t.files))], [plan.tasks]);
  const pct = plan.progress.total ? Math.round((plan.progress.done / plan.progress.total) * 100) : 0;

  const showOnGraph = () => {
    const graph = useGraphStore.getState();
    if (focused) { graph.setStackFocus(null); return; }
    graph.setStackFocus({
      planUid: plan.uid,
      label: plan.label,
      paths,
      taskUids: plan.tasks.map((t) => t.uid),
      sessions: [...new Set(plan.tasks.map((t) => t.assigneeSession).filter((x): x is string => !!x))],
    });
    if (paths[0]) graph.focusNode(paths[0], false);
  };

  return (
    <div
      data-testid="stack-plan"
      data-plan-uid={plan.uid}
      className={`mx-2 rounded border ${focused ? 'border-accent/40 bg-accent/[0.04]' : 'border-border-subtle'}`}
    >
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button onClick={onToggle} className="text-foreground-subtle hover:text-foreground" aria-label={open ? 'Collapse' : 'Expand'}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <span className={`font-medium text-foreground ${plan.ticketKey ? 'font-mono' : ''}`}>{plan.label}</span>
        {plan.ticketKey && <span className="text-foreground-muted truncate">{plan.title}</span>}
        <span className="flex items-center gap-1.5 shrink-0" title={`${plan.progress.done} of ${plan.progress.total} tasks done`}>
          <span className="block w-16 h-1 rounded-full bg-white/[0.06] overflow-hidden">
            <span className="block h-full bg-accent/60" style={{ width: `${pct}%` }} />
          </span>
          <span className="text-foreground-subtle tabular-nums">{plan.progress.done}/{plan.progress.total}</span>
        </span>
        {plan.needsYou > 0 && (
          <span className="px-1.5 rounded bg-amber-500/10 text-amber-300 shrink-0" data-testid="stack-needs-you">
            {plan.needsYou} {plan.needsYou === 1 ? 'needs' : 'need'} you
          </span>
        )}
        <span className="flex-1" />
        <button
          onClick={showOnGraph}
          disabled={plan.tasks.length === 0}
          data-testid="stack-show-on-graph"
          aria-pressed={focused}
          className={`flex items-center gap-1 px-1.5 rounded border transition-colors disabled:opacity-40 ${focused ? 'border-accent/40 text-accent' : 'border-border-subtle text-foreground-muted hover:text-foreground'}`}
          title={focused
            ? 'Stop following this plan'
            : `Show this plan's work: ${paths.length ? `the ${paths.length} files its tasks name on the graph, and ` : ''}its turns in the Timeline`}
        >
          <Crosshair size={10} /> {focused ? 'Following' : 'Follow'}
        </button>
        <button
          onClick={() => { void usePlanStore.getState().setActivePlan(plan.uid); }}
          className="text-foreground-subtle hover:text-foreground"
          title={`Open ${plan.title}`}
          aria-label={`Open ${plan.title}`}
        >
          <ExternalLink size={11} />
        </button>
      </div>

      {plan.overlaps.length > 0 && (
        <div className="px-7 pb-1.5 flex flex-wrap gap-1.5">
          {plan.overlaps.map((o) => (
            <span
              key={o.withPlanUid}
              data-testid="stack-overlap"
              className={`px-1.5 rounded ${o.high ? 'bg-red-500/10 text-red-300' : 'bg-amber-500/10 text-amber-300'}`}
              title={o.detail}
            >
              {o.words}
            </span>
          ))}
        </div>
      )}

      {open && <TaskTree tasks={plan.tasks} planUid={plan.uid} />}
    </div>
  );
}

function TaskTree({ tasks, planUid }: { tasks: StackTask[]; planUid: string }) {
  const children = useMemo(() => {
    const byParent = new Map<string | null, StackTask[]>();
    const known = new Set(tasks.map((t) => t.uid));
    for (const t of tasks) {
      const parent = t.parentUid && known.has(t.parentUid) ? t.parentUid : null;
      byParent.set(parent, [...(byParent.get(parent) ?? []), t]);
    }
    return byParent;
  }, [tasks]);

  if (tasks.length === 0) return <div className="px-7 pb-2 text-foreground-subtle">No tasks yet.</div>;

  const render = (parent: string | null, depth: number): React.ReactElement[] =>
    (children.get(parent) ?? []).flatMap((t) => [
      <TaskLine key={t.uid} task={t} planUid={planUid} depth={depth} />,
      ...render(t.uid, depth + 1),
    ]);
  return <div className="pb-1.5">{render(null, 0)}</div>;
}

function TaskLine({ task, planUid, depth }: { task: StackTask; planUid: string; depth: number }) {
  const unmet = task.dependencies.filter((d) => !d.met);
  const met = task.dependencies.filter((d) => d.met);
  return (
    <div data-testid="stack-task" className="px-2 py-0.5" style={{ paddingLeft: 28 + depth * 14 }}>
      <div className="flex items-center gap-1.5">
        {task.kind === 'action'
          ? <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[task.status ?? 'pending'] ?? STATUS_DOT.pending}`} title={task.status ?? ''} />
          : <span className="w-1.5 shrink-0 text-foreground-subtle">·</span>}
        <button
          className={`truncate text-left hover:underline ${task.kind === 'action' ? 'text-foreground' : 'text-foreground-muted'}`}
          onClick={() => { void revealPlanItem(planUid, task.uid); }}
        >
          {task.title}
        </button>
        {task.ticketKey && <span className="font-mono text-foreground-subtle">{task.ticketKey}</span>}
        {task.assignee && <span className="px-1 rounded bg-white/[0.05] text-foreground-muted shrink-0" data-testid="stack-assignee">{task.assignee}</span>}
        {task.workstream && <span className="text-sky-300/80 shrink-0" data-testid="stack-workstream">⎇ {task.workstream}</span>}
      </div>
      {(unmet.length > 0 || met.length > 0) && (
        <div className="pl-3 space-y-px">
          {unmet.map((d) => <DependencyLine key={d.uid} dep={d} ownPlan={planUid} />)}
          {met.length > 0 && (
            <div className="text-foreground-subtle" data-testid="stack-dependency-met">
              ✓ after {met.map((d) => `“${d.title ?? d.uid}”${d.planTitle ? ` in ${d.planTitle}` : ''}`).join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A dependency still in the way. One in another plan is a link to it: that is where to look for why. */
function DependencyLine({ dep, ownPlan }: { dep: StackDependency; ownPlan: string }) {
  const canOpen = dep.problem === 'unfinished' && dep.planUid;
  return (
    <div className="text-amber-300/90" data-testid="stack-dependency">
      ↑{' '}
      {canOpen ? (
        <>
          waits on{' '}
          <button
            data-testid="stack-dependency-link"
            className="text-accent hover:underline"
            onClick={() => { void revealPlanItem(dep.planUid!, dep.uid); }}
          >
            “{dep.title}”
          </button>
          {dep.planUid !== ownPlan && dep.planTitle ? <> in plan “{dep.planTitle}”</> : null}
        </>
      ) : dep.words}
    </div>
  );
}
