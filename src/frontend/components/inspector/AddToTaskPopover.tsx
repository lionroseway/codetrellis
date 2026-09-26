import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, ListChecks, Sparkles } from 'lucide-react';
import { usePlanStore } from '../../stores/plan-store';
import { useProjectStore } from '../../stores/project-store';

/**
 * "Add to plan" from a code selection, on V2 plan items.
 *
 * This used the V1 task routes: it listed V1 tasks, so a V2 plan's
 * Actions never appeared, and whatever it created was a V1 task that the
 * workspace never shows — the reference was lost (Phase 32 §0.4c, bug 21).
 * The line range is now attached to an Action by
 * `POST /api/items/:uid/code-reference`, which merges it into the
 * Action's fileSpecs on the backend.
 */
interface ActionSummary {
  uid: string;
  title: string;
  kind: string;
  status: string;
}

async function postJson(url: string, body: unknown): Promise<{ uid?: string; error?: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

interface Props {
  filePath: string;
  startLine: number;
  endLine: number;
  codeSnippet: string;
  onClose: () => void;
}

type Mode = 'existing' | 'new-task' | 'new-plan';

export function AddToTaskPopover({ filePath, startLine, endLine, codeSnippet, onClose }: Props) {
  const root = useProjectStore((s) => s.root);
  const plans = usePlanStore((s) => s.plans);
  const fetchPlans = usePlanStore((s) => s.fetchPlans);
  const activePlan = usePlanStore((s) => s.activePlan);

  const [mode, setMode] = useState<Mode>('existing');
  const [selectedPlanUid, setSelectedPlanUid] = useState<string | null>(activePlan?.uid ?? null);
  const [selectedTaskUid, setSelectedTaskUid] = useState<string | null>(null);
  const [planActions, setPlanActions] = useState<ActionSummary[]>([]);
  const [newTaskDesc, setNewTaskDesc] = useState('');
  const [newPlanTitle, setNewPlanTitle] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refresh plans when modal opens
  useEffect(() => {
    if (root) fetchPlans(root);
  }, [root, fetchPlans]);

  // When the active plan switches, default to it
  useEffect(() => {
    if (activePlan?.uid) setSelectedPlanUid(activePlan.uid);
  }, [activePlan?.uid]);

  // The picked plan's Actions (its V2 items of kind 'action').
  useEffect(() => {
    if (!selectedPlanUid) { setPlanActions([]); return; }
    setSelectedTaskUid(null);
    fetch(`/api/plans/${encodeURIComponent(selectedPlanUid)}/items`)
      .then((r) => r.json())
      .then((items) => setPlanActions(Array.isArray(items) ? items.filter((i: ActionSummary) => i.kind === 'action') : []))
      .catch(() => setPlanActions([]));
  }, [selectedPlanUid]);

  const relativePath = useMemo(() => {
    if (!root || !filePath.startsWith(root)) return filePath;
    return filePath.slice(root.length).replace(/^\//, '');
  }, [filePath, root]);

  const lineRangeLabel = startLine === endLine ? `:${startLine}` : `:${startLine}-${endLine}`;

  const attach = (itemUid: string) => postJson(`/api/items/${encodeURIComponent(itemUid)}/code-reference`, {
    filePath: relativePath, startLine, endLine, note, codeSnippet,
  });

  const run = async (work: () => Promise<void>) => {
    setSubmitting(true);
    setError(null);
    try {
      await work();
      onClose();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setSubmitting(false);
    }
  };

  const createAction = async (planUid: string, title: string): Promise<string> => {
    const item = await postJson(`/api/plans/${encodeURIComponent(planUid)}/items`, { kind: 'action', title });
    if (!item.uid) throw new Error('The action was not created');
    return item.uid;
  };

  const submitExisting = async () => {
    if (!selectedPlanUid || !selectedTaskUid) {
      setError('Pick an action');
      return;
    }
    await run(async () => { await attach(selectedTaskUid); });
  };

  const submitNewTask = async () => {
    if (!selectedPlanUid) {
      setError('Pick a plan');
      return;
    }
    if (!newTaskDesc.trim()) {
      setError('Action title is required');
      return;
    }
    await run(async () => { await attach(await createAction(selectedPlanUid, newTaskDesc.trim())); });
  };

  const submitNewPlan = async () => {
    if (!newPlanTitle.trim()) {
      setError('Plan title is required');
      return;
    }
    if (!root) {
      setError('No project open');
      return;
    }
    await run(async () => {
      const plan = await postJson('/api/plans', { title: newPlanTitle.trim(), description: '', projectPath: root });
      if (!plan.uid) throw new Error('The plan was not created');
      await attach(await createAction(plan.uid, newTaskDesc.trim() || `Address ${relativePath}${lineRangeLabel}`));
      await fetchPlans(root);
    });
  };

  const onSubmit = () => {
    if (mode === 'existing') return submitExisting();
    if (mode === 'new-task') return submitNewTask();
    return submitNewPlan();
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[88vh] flex flex-col rounded-2xl border border-white/[0.08] bg-[#0b1020] shadow-[0_24px_80px_rgba(0,0,0,0.6)]"
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
          <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2">
            <Plus size={13} className="text-accent" />
            Add to plan
          </h3>
          <button onClick={onClose} className="p-1 rounded-md text-foreground-subtle hover:text-foreground hover:bg-white/[0.05]">
            <X size={13} />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-white/[0.04]">
          <div className="text-[10px] text-foreground-subtle uppercase tracking-wider mb-1">Reference</div>
          <code className="block text-[11px] font-mono text-foreground bg-black/30 border border-white/[0.06] rounded px-2 py-1.5 break-all">
            {relativePath}{lineRangeLabel}
          </code>
        </div>

        <div className="flex border-b border-white/[0.04]">
          {([
            { value: 'existing' as const, label: 'Existing action', icon: ListChecks },
            { value: 'new-task' as const, label: 'New action', icon: Plus },
            { value: 'new-plan' as const, label: 'New plan', icon: Sparkles },
          ]).map((tab) => (
            <button
              key={tab.value}
              onClick={() => { setMode(tab.value); setError(null); }}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] border-b-2 transition-colors ${
                mode === tab.value
                  ? 'border-accent text-accent'
                  : 'border-transparent text-foreground-subtle hover:text-foreground-muted'
              }`}
            >
              <tab.icon size={11} />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {mode !== 'new-plan' && (
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-foreground-subtle mb-1">Plan</label>
              <select
                value={selectedPlanUid ?? ''}
                onChange={(e) => setSelectedPlanUid(e.target.value || null)}
                className="w-full bg-white/[0.02] border border-white/[0.08] rounded-md px-3 py-2 text-[12px] text-foreground focus:outline-none focus:border-accent/40"
              >
                <option value="" disabled>Pick a plan…</option>
                {plans.map((p) => (
                  <option key={p.uid} value={p.uid} className="bg-[#0b1020]">
                    {p.title}
                  </option>
                ))}
              </select>
              {plans.length === 0 && (
                <p className="text-[10px] text-foreground-subtle mt-1">
                  No plans yet — switch to "New plan" to create one with this reference.
                </p>
              )}
            </div>
          )}

          {mode === 'existing' && selectedPlanUid && (
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-foreground-subtle mb-1">Action</label>
              {planActions.length === 0 ? (
                <p className="text-[11px] text-foreground-subtle italic py-2">This plan has no actions yet — switch to "New action".</p>
              ) : (
                <div className="space-y-1 max-h-[200px] overflow-y-auto pr-1">
                  {planActions.map((task) => (
                    <button
                      key={task.uid}
                      onClick={() => setSelectedTaskUid(task.uid)}
                      className={`w-full text-left px-2.5 py-1.5 rounded-md border text-[11px] transition-all ${
                        selectedTaskUid === task.uid
                          ? 'border-accent/40 bg-accent/10 text-foreground'
                          : 'border-white/[0.05] bg-white/[0.015] text-foreground-muted hover:bg-white/[0.04] hover:border-white/[0.1]'
                      }`}
                    >
                      <div className="truncate">{task.title}</div>
                      <div className="text-[9.5px] text-foreground-subtle truncate mt-0.5">{task.status.replace('_', ' ')}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {mode === 'new-task' && (
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-foreground-subtle mb-1">Action title</label>
              <input
                type="text"
                value={newTaskDesc}
                onChange={(e) => setNewTaskDesc(e.target.value)}
                placeholder={`e.g. Refactor ${relativePath.split('/').pop()}`}
                className="w-full bg-white/[0.02] border border-white/[0.08] rounded-md px-3 py-2 text-[12px] text-foreground focus:outline-none focus:border-accent/40"
                autoFocus
              />
            </div>
          )}

          {mode === 'new-plan' && (
            <>
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-foreground-subtle mb-1">Plan title</label>
                <input
                  type="text"
                  value={newPlanTitle}
                  onChange={(e) => setNewPlanTitle(e.target.value)}
                  placeholder="e.g. Tighten auth middleware"
                  className="w-full bg-white/[0.02] border border-white/[0.08] rounded-md px-3 py-2 text-[12px] text-foreground focus:outline-none focus:border-accent/40"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-foreground-subtle mb-1">First action (optional)</label>
                <input
                  type="text"
                  value={newTaskDesc}
                  onChange={(e) => setNewTaskDesc(e.target.value)}
                  placeholder={`Defaults to "Address ${relativePath.split('/').pop()}${lineRangeLabel}"`}
                  className="w-full bg-white/[0.02] border border-white/[0.08] rounded-md px-3 py-2 text-[12px] text-foreground focus:outline-none focus:border-accent/40"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-foreground-subtle mb-1">Note (optional)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What should change here? Any constraints?"
              rows={3}
              className="w-full bg-white/[0.02] border border-white/[0.08] rounded-md px-3 py-2 text-[12px] text-foreground placeholder:text-foreground-subtle focus:outline-none focus:border-accent/40 resize-none"
            />
          </div>

          {error && (
            <div className="text-[11px] text-red-300 bg-red-500/10 border border-red-500/20 rounded px-2 py-1.5">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-white/[0.06]">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[11px] rounded-md text-foreground-muted hover:text-foreground hover:bg-white/[0.04]"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={submitting}
            className="px-3 py-1.5 text-[11px] rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Saving…' : 'Add reference'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
