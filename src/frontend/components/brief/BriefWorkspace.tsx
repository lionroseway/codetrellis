/**
 * Phase 31 §10 — the Brief: the same plan, read as a piece of work
 * rather than a codebase.
 *
 *   Tasks │ the task: goal, guide, materials, outputs │ what good looks like
 *         │                                           │ what Claude is doing
 *
 * A peer of the code mode, not a panel over the graph: in this mode the
 * graph is not mounted (App.tsx). Everything shown is what the plan
 * already holds — items, criteria, recorded files, agent events — in the
 * Brief's words (lib/brief-vocabulary.ts). Left out on purpose, because
 * they are about code: targets, routing, drift, the readiness ring and the
 * review comparand.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown, ChevronRight, FileSpreadsheet, FileText, FileImage, FileVideo, File as FileIcon, Presentation,
} from 'lucide-react';
import { usePlanStore } from '../../stores/plan-store';
import { usePlanItemsStore } from '../../stores/plan-items-store';
import { useProjectStore } from '../../stores/project-store';
import { useAgentStore } from '../../stores/agent-store';
import { BodyRenderer } from '../plan/v2/BodyRenderer';
import { CriteriaBlock } from '../plan/v2/CriteriaBlock';
import { AgentTurnList, useAgentTurns } from '../layout/AgentTurns';
import { openArtefactAt } from '../../lib/open-artefact-at';
import { BRIEF_WORDS, briefState } from '../../lib/brief-vocabulary';
import { SignoffPackControls } from './SignoffPackControls';
import type { ItemCriterion, PlanItem, TaskAttachment } from '@shared/types';

/** The plan's items depth-first, siblings in order — the order the tree shows. */
function inTreeOrder(items: PlanItem[]): PlanItem[] {
  const byParent = new Map<string | null, PlanItem[]>();
  const known = new Set(items.map((i) => i.uid));
  for (const it of items) {
    const key = it.parentUid && known.has(it.parentUid) ? it.parentUid : null;
    (byParent.get(key) ?? byParent.set(key, []).get(key)!).push(it);
  }
  const out: PlanItem[] = [];
  const walk = (parent: string | null) => {
    for (const it of (byParent.get(parent) ?? []).sort((a, b) => a.sortOrder - b.sortOrder)) {
      out.push(it);
      walk(it.uid);
    }
  };
  walk(null);
  return out;
}

function fileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['xlsx', 'xls', 'xlsm', 'csv'].includes(ext)) return FileSpreadsheet;
  if (ext === 'pptx') return Presentation;
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return FileImage;
  if (['mp4', 'webm', 'mov'].includes(ext)) return FileVideo;
  if (['pdf', 'docx', 'md', 'txt', 'html', 'htm'].includes(ext)) return FileText;
  return FileIcon;
}

function ArtefactRows({ title, rows, itemUid, testId }: { title: string; rows: TaskAttachment[]; itemUid: string; testId: string }) {
  if (rows.length === 0) return null;
  return (
    <section className="mt-6" data-testid={testId}>
      <h3 className="text-[11px] uppercase tracking-[0.1em] text-foreground-subtle font-semibold mb-2">{title}</h3>
      <ul className="space-y-1">
        {rows.map((a) => {
          const name = a.value.split(/[\\/]/).pop() ?? a.value;
          const folder = a.value.includes('/') ? a.value.slice(0, a.value.lastIndexOf('/')) : '';
          const Icon = fileIcon(name);
          return (
            <li key={a.uid}>
              <button
                onClick={() => openArtefactAt(a.uid, null, { itemUid })}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-white/[0.04] transition-colors"
                title={`Open ${a.value}`}
              >
                <Icon size={14} className="text-foreground-subtle shrink-0" />
                <span className="text-[13px] text-foreground truncate">{a.label || name}</span>
                {folder && <span className="text-[11px] text-foreground-subtle truncate">{folder}</span>}
                <span className="flex-1" />
                <span className="text-[10.5px] text-foreground-subtle shrink-0">
                  added by {a.authorType === 'human' ? 'you' : a.author}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function GuidePage({ page }: { page: PlanItem }) {
  const [open, setOpen] = useState(false);
  // The plan's item list carries no bodies; a page's comes with its bundle.
  const full = usePlanItemsStore((s) => s.contextByUid[page.uid]?.item);
  const fetchItemFull = usePlanItemsStore((s) => s.fetchItemFull);
  useEffect(() => { if (open && !full) void fetchItemFull(page.uid); }, [open, full, page.uid, fetchItemFull]);
  const body = full?.body ?? page.body;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <li>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[13px] text-foreground-muted hover:text-foreground"
        aria-expanded={open}
      >
        <Chevron size={12} /> {page.title}
      </button>
      {open && (
        <div className="mt-1 ml-5 text-[13px]">
          {body?.trim() ? <BodyRenderer source={body} /> : <p className="text-foreground-subtle">{full ? 'This page is empty.' : 'Loading…'}</p>}
        </div>
      )}
    </li>
  );
}

function progressOf(criteria: ItemCriterion[] | undefined): string | null {
  if (!criteria || criteria.length === 0) return null;
  return `${criteria.filter((c) => c.state === 'met').length}/${criteria.length}`;
}

function PickABrief() {
  const plans = usePlanStore((s) => s.plans);
  const fetchPlans = usePlanStore((s) => s.fetchPlans);
  const setActivePlan = usePlanStore((s) => s.setActivePlan);
  const root = useProjectStore((s) => s.root);
  useEffect(() => { void fetchPlans(); }, [fetchPlans]);
  const here = plans.filter((p) => !root || p.projectPath === root);
  return (
    <div className="h-full flex items-center justify-center" data-testid="brief-pick">
      <div className="max-w-md text-center">
        <h2 className="text-[16px] font-semibold mb-2">Pick a brief</h2>
        <p className="text-[13px] text-foreground-muted leading-relaxed mb-4">
          A brief is a piece of work: the tasks in it, the materials you gave, and what good looks like for each.
          Ask Claude to start one from your request, or open one below.
        </p>
        {here.length === 0 ? (
          <p className="text-[12px] text-foreground-subtle">No briefs in this folder yet.</p>
        ) : (
          <ul className="space-y-1 text-left">
            {here.map((p) => (
              <li key={p.uid}>
                <button
                  onClick={() => setActivePlan(p.uid)}
                  className="w-full px-3 py-2 rounded-md border border-white/[0.06] hover:bg-white/[0.04] text-[13px] text-left"
                >
                  {p.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function BriefWorkspace() {
  const plan = usePlanStore((s) => s.activePlan);
  const hydratePlan = usePlanItemsStore((s) => s.hydratePlan);
  const resetForPlan = usePlanItemsStore((s) => s.resetForPlan);
  const storePlanUid = usePlanItemsStore((s) => s.activePlanUid);
  const itemsByUid = usePlanItemsStore((s) => s.itemsByUid);
  const contextByUid = usePlanItemsStore((s) => s.contextByUid);
  const selectedItemUid = usePlanItemsStore((s) => s.selectedItemUid);
  const selectItem = usePlanItemsStore((s) => s.selectItem);
  const fetchItemFull = usePlanItemsStore((s) => s.fetchItemFull);
  const events = useAgentStore((s) => s.events);
  const status = useAgentStore((s) => s.status);
  const turns = useAgentTurns(events, 'brief');
  // Decisions taken here are signed with the desktop's identity; the Brief
  // calls that person "you".
  const [you, setYou] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { identity?: { email?: string } } | null) => setYou(s?.identity?.email || null))
      .catch(() => {});
  }, []);

  const planUid = plan?.uid ?? null;
  useEffect(() => {
    if (!planUid) return;
    if (storePlanUid !== planUid) resetForPlan(planUid);
    void hydratePlan(planUid);
  }, [planUid, storePlanUid, hydratePlan, resetForPlan]);

  const ordered = useMemo(
    () => inTreeOrder(Object.values(itemsByUid).filter((i) => i.planUid === planUid)),
    [itemsByUid, planUid],
  );
  const tasks = ordered.filter((i) => i.kind === 'action');
  const guide = ordered.filter((i) => i.kind === 'object');
  const task = (selectedItemUid && itemsByUid[selectedItemUid]?.kind === 'action' ? itemsByUid[selectedItemUid] : null) ?? tasks[0] ?? null;

  // The task on screen always has its criteria and files loaded — the first
  // one is shown before anyone clicks it.
  const taskUid = task?.uid ?? null;
  useEffect(() => {
    if (taskUid && !contextByUid[taskUid]) void fetchItemFull(taskUid);
  }, [taskUid, contextByUid, fetchItemFull]);
  // Tasks' progress in the list comes from what has been loaded.
  useEffect(() => {
    for (const t of tasks.slice(0, 50)) if (!contextByUid[t.uid]) void fetchItemFull(t.uid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks.length]);

  if (!plan) return <PickABrief />;

  const ctx = task ? contextByUid[task.uid] : undefined;
  const files = ctx?.attachments.filter((a) => a.role) ?? [];
  const goal = ctx?.item.body ?? task?.body ?? '';

  return (
    <div className="h-full grid grid-cols-[240px_minmax(0,1fr)_320px] bg-background" data-testid="brief-workspace">
      <aside className="border-r border-white/[0.06] overflow-y-auto p-3" aria-label={BRIEF_WORDS.actions}>
        <h2 className="text-[11px] uppercase tracking-[0.1em] text-foreground-subtle font-semibold mb-2">Tasks</h2>
        {tasks.length === 0 ? (
          <p className="text-[12px] text-foreground-subtle">This brief has no tasks yet.</p>
        ) : (
          <ul className="space-y-0.5" data-testid="brief-tasks">
            {tasks.map((t) => {
              const criteria = contextByUid[t.uid]?.criteria;
              const waiting = criteria?.some((c) => c.state === 'submitted');
              const progress = progressOf(criteria);
              const active = task?.uid === t.uid;
              return (
                <li key={t.uid}>
                  <button
                    onClick={() => selectItem(t.uid)}
                    aria-current={active ? 'true' : undefined}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-[13px] ${active ? 'bg-accent/10 text-foreground' : 'text-foreground-muted hover:bg-white/[0.04]'}`}
                  >
                    <span aria-hidden className="w-3 text-center">{t.status === 'done' ? '✓' : active ? '●' : '○'}</span>
                    <span className="flex-1 truncate">{t.title}</span>
                    {waiting && <span className="text-[10px] text-amber-300" title={briefState('submitted').words}>◐</span>}
                    {progress && <span className="text-[10.5px] text-foreground-subtle">{progress}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <SignoffPackControls planUid={plan.uid} planTitle={plan.title} />
      </aside>

      <main className="overflow-y-auto px-8 py-6" data-testid="brief-task">
        <p className="text-[11px] text-foreground-subtle mb-1">{plan.title}</p>
        {task ? (
          <>
            <h1 className="text-[20px] font-semibold mb-4">{task.title}</h1>
            <section>
              <h3 className="text-[11px] uppercase tracking-[0.1em] text-foreground-subtle font-semibold mb-2">Goal</h3>
              <div className="text-[14px]">
                {goal.trim() ? <BodyRenderer source={goal} /> : <p className="text-foreground-subtle">{ctx ? 'No goal written yet.' : 'Loading…'}</p>}
              </div>
            </section>
            {guide.length > 0 && (
              <section className="mt-6" data-testid="brief-guide">
                <h3 className="text-[11px] uppercase tracking-[0.1em] text-foreground-subtle font-semibold mb-2">Guide</h3>
                <ul className="space-y-1">{guide.map((p) => <GuidePage key={p.uid} page={p} />)}</ul>
              </section>
            )}
            <ArtefactRows title={BRIEF_WORDS.materials} rows={files.filter((a) => a.role === 'material')} itemUid={task.uid} testId="brief-materials" />
            <ArtefactRows title={BRIEF_WORDS.outputs} rows={files.filter((a) => a.role === 'output')} itemUid={task.uid} testId="brief-outputs" />
            <ArtefactRows title={BRIEF_WORDS.evidence} rows={files.filter((a) => a.role === 'evidence')} itemUid={task.uid} testId="brief-evidence" />
            {files.length === 0 && ctx && (
              <p className="mt-6 text-[12px] text-foreground-subtle">
                No materials yet. Ask Claude to add the files this task needs, or give them in your request.
              </p>
            )}
          </>
        ) : (
          <p className="text-[13px] text-foreground-muted">Pick a task on the left.</p>
        )}
      </main>

      <aside className="border-l border-white/[0.06] overflow-y-auto p-4 space-y-6">
        {task && <CriteriaBlock itemUid={task.uid} criteria={ctx?.criteria ?? []} attachments={ctx?.attachments ?? []} vocabulary="brief" you={you} />}
        <section data-testid="brief-activity">
          <h3 className="text-[11px] uppercase tracking-[0.1em] text-foreground-subtle font-semibold mb-2">What Claude is doing</h3>
          <div className="text-[11px]">
            <AgentTurnList turns={turns} status={status} vocabulary="brief" expandLatest emptyText="Nothing yet. Connect Claude and ask it to start the brief." />
          </div>
        </section>
      </aside>
    </div>
  );
}
