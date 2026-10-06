import { useMemo, useRef, useState } from 'react';
import {
  ChevronDown, ChevronRight, FileText, Zap, Plus, MoreHorizontal,
  CheckCircle2, Circle, Loader2, Square, SkipForward, User, History, Trash2,
  GripVertical, Eye, EyeOff,
} from 'lucide-react';
import { usePlanItemsStore, buildItemTree } from '../../../stores/plan-items-store';
import { useToastStore } from '../../../stores/toast-store';
import { progressByWorktree, worktreeReadiness } from '../../../lib/section-worktrees';
import { useAwarenessStore } from '../../../stores/awareness-store';
import { useReplayStore } from '../../../stores/replay-store';
import type { PlanItem, PlanItemKind, TaskStatus } from '@shared/types';
import { usePlanGitStates, GIT_STATE_TONE, gitStateTitle, type PlanItemGitState } from '../../../lib/plan-git-state';
import { usePlanStatus } from '../../../lib/plan-status';
import { statusLine, type ItemStatus } from '@shared/lib/item-status';
import { gitStateChip, sourceWords } from '@shared/lib/git-state-words';
import { TASK, TONES } from '../../../lib/visual-language';

// Task states from the visual vocabulary (Phase 33 G1). Assigned is no
// longer a second blue beside in progress; blocked is ■, not the ⊘ a breach uses.
const STATUS_ICON: Record<TaskStatus, { Icon: typeof Circle; tint: string }> = {
  pending: { Icon: Circle, tint: TONES[TASK.pending.tone].text },
  assigned: { Icon: User, tint: TONES[TASK.assigned.tone].text },
  in_progress: { Icon: Loader2, tint: `${TONES[TASK.in_progress.tone].text} animate-spin` },
  done: { Icon: CheckCircle2, tint: `${TONES[TASK.done.tone].text} drop-shadow-[0_0_3px_rgba(34,197,94,0.5)]` },
  blocked: { Icon: Square, tint: `${TONES[TASK.blocked.tone].text} fill-current` },
  skipped: { Icon: SkipForward, tint: TONES[TASK.skipped.tone].text },
};

type DropPosition = 'above' | 'below' | 'inside';

interface DragState {
  draggedUid: string | null;
  overUid: string | null;
  position: DropPosition | null;
}

/**
 * Phase 15 §15.D / Phase 16 — sidebar tree of Pages + Tasks.
 *
 * Renders the full tree from `planItemsStore.itemsByUid` keyed by
 * `parentUid`. Click a row → selects in canvas. Click chevron →
 * expand/collapse. Hover → reveals inline `+` (add child) and `⋯`
 * (rename / delete / open history) menu.
 *
 * Phase 16: drag-and-drop reordering and reparenting.
 */
export function PlanItemTree({ planUid }: { planUid: string }) {
  const itemsByUid = usePlanItemsStore((s) => s.itemsByUid);
  // Busy until this plan's items are in: says so to assistive tech, and
  // gives tests something to wait on besides a fixed delay (Phase 32 §0.6).
  const loading = usePlanItemsStore((s) => s.hydratedFor !== s.activePlanUid);
  const selectedItemUid = usePlanItemsStore((s) => s.selectedItemUid);
  const selectItem = usePlanItemsStore((s) => s.selectItem);
  const createItem = usePlanItemsStore((s) => s.createItem);
  const updateItem = usePlanItemsStore((s) => s.updateItem);
  const moveItem = usePlanItemsStore((s) => s.moveItem);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [drag, setDrag] = useState<DragState>({ draggedUid: null, overUid: null, position: null });

  const { rootUids, childrenByParent } = useMemo(
    () => buildItemTree(itemsByUid),
    [itemsByUid],
  );

  // Phase 5.2 — count local items for the bulk-toggle affordance.
  // Phase 32 C5.3 — how far each worktree this plan is split across has got.
  const worktreeProgress = useMemo(() => progressByWorktree(itemsByUid), [itemsByUid]);
  // C5.3b — and whether each is ready to merge.
  const workstreams = useAwarenessStore((s) => s.workstreams);
  const signals = useAwarenessStore((s) => s.signals);
  // C2.1 — what git proves about each section's branch; C2.4 — and every
  // item's state with its source (git, a review host, or the plan itself).
  const branchesNonce = useMemo(() => Object.values(itemsByUid).map((i) => `${i.uid}:${i.workstream ?? ''}`).join('|'), [itemsByUid]);
  const gitStates = usePlanGitStates(planUid, branchesNonce);
  const statusNonce = useMemo(() => Object.values(itemsByUid).map((i) => `${i.uid}:${i.status ?? ''}:${i.workstream ?? ''}:${i.updatedAt ?? ''}`).join('|'), [itemsByUid]);
  const planStatus = usePlanStatus(planUid, statusNonce);
  const statuses = useMemo(() => Object.fromEntries((planStatus?.items ?? []).map((s) => [s.itemUid, s])), [planStatus]);
  const localCount = useMemo(
    () => Object.values(itemsByUid).filter((i) => i.visibility === 'local').length,
    [itemsByUid],
  );

  const bulkSetVisibility = async (visibility: 'shared' | 'local') => {
    const targets = Object.values(itemsByUid).filter(
      (i) => i.visibility !== visibility,
    );
    // Fire updates in parallel — the store handles optimistic patching.
    await Promise.all(targets.map((i) => updateItem(i.uid, { visibility })));
  };

  const toggle = (uid: string) =>
    setExpanded((prev) => ({ ...prev, [uid]: !prev[uid] }));

  // Compute sorted sibling uids for a given parentUid
  const getSiblingUids = (parentUid: string | null): string[] => {
    if (!parentUid) return rootUids;
    return childrenByParent[parentUid] ?? [];
  };

  const handleDrop = (targetUid: string, position: DropPosition) => {
    const { draggedUid } = drag;
    if (!draggedUid || draggedUid === targetUid) return;

    const draggedItem = itemsByUid[draggedUid];
    const targetItem = itemsByUid[targetUid];
    if (!draggedItem || !targetItem) return;

    // Prevent dropping onto own descendants
    const isDescendant = (parentUid: string, childUid: string): boolean => {
      const children = childrenByParent[parentUid] ?? [];
      for (const c of children) {
        if (c === childUid) return true;
        if (isDescendant(c, childUid)) return true;
      }
      return false;
    };
    if (isDescendant(draggedUid, targetUid)) return;

    let newParentUid: string | null;
    let newSortOrder: number;

    if (position === 'inside') {
      // Drop as child of target
      newParentUid = targetUid;
      const existingChildren = childrenByParent[targetUid] ?? [];
      newSortOrder = existingChildren.length > 0
        ? Math.max(...existingChildren.map((u) => itemsByUid[u]?.sortOrder ?? 0)) + 1
        : 0;
      // Auto-expand the target
      setExpanded((prev) => ({ ...prev, [targetUid]: true }));
    } else {
      // Drop as sibling (above or below target)
      newParentUid = targetItem.parentUid;
      const siblings = getSiblingUids(targetItem.parentUid);
      const targetIndex = siblings.indexOf(targetUid);
      const insertIndex = position === 'above' ? targetIndex : targetIndex + 1;

      // Compute sort order: midpoint between neighbors
      const prevItem = insertIndex > 0 ? itemsByUid[siblings[insertIndex - 1]] : null;
      const nextItem = insertIndex < siblings.length ? itemsByUid[siblings[insertIndex]] : null;
      const prevOrder = prevItem?.sortOrder ?? -1;
      const nextOrder = nextItem?.sortOrder ?? prevOrder + 2;
      newSortOrder = (prevOrder + nextOrder) / 2;
    }

    moveItem(draggedUid, { newParentUid, newSortOrder });
  };

  const renderNode = (uid: string, depth: number): React.ReactNode => {
    const item = itemsByUid[uid];
    if (!item) return null;
    const childUids = childrenByParent[uid] ?? [];
    const isOpen = expanded[uid] ?? true;
    const isSelected = selectedItemUid === uid;
    const isDragged = drag.draggedUid === uid;
    const isDropTarget = drag.overUid === uid;
    return (
      <div key={uid} className={isDragged ? 'opacity-40' : ''}>
        <ItemRow
          item={item}
          depth={depth}
          isSelected={isSelected}
          hasChildren={childUids.length > 0}
          isOpen={isOpen}
          onToggle={() => toggle(uid)}
          onClick={() => selectItem(uid)}
          drag={drag}
          setDrag={setDrag}
          isDropTarget={isDropTarget}
          onDrop={handleDrop}
          gitState={gitStates[uid]}
          status={statuses[uid]}
        />
        {isOpen && childUids.length > 0 && (
          <div>{childUids.map((c) => renderNode(c, depth + 1))}</div>
        )}
      </div>
    );
  };

  return (
    <div data-testid="plan-item-tree" aria-busy={loading} className="h-full flex flex-col border-r border-white/[0.06] bg-[#080915] min-w-0">
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-white/[0.06]">
        <FileText size={13} className="text-foreground-subtle shrink-0" />
        <span className="text-[12px] font-semibold text-foreground uppercase tracking-wider">
          Pages
        </span>
        <span className="text-[11.5px] text-foreground-subtle">
          ({Object.keys(itemsByUid).length})
        </span>
        <div className="flex-1" />

        {/* Phase 5.2 — bulk visibility indicator / toggle. Shows when
            any items are local so the user can batch-share them. */}
        {localCount > 0 && (
          <button
            onClick={() => bulkSetVisibility('shared')}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-violet-400/80 hover:text-violet-300 hover:bg-violet-500/10 transition-colors"
            title={`${localCount} local item${localCount > 1 ? 's' : ''} — click to share all`}
          >
            <EyeOff size={10} />
            {localCount}
          </button>
        )}

        <NewButton planUid={planUid} parentUid={null} createItem={createItem} />
      </div>

      {/* Phase 32 C5.3 — one plan across worktrees: done of to-do, per worktree. */}
      {worktreeProgress.length > 0 && (
        <div
          data-testid="worktree-progress"
          className="flex flex-wrap gap-x-3 gap-y-0.5 px-3.5 py-1.5 border-b border-white/[0.06] text-[10.5px] text-foreground-subtle"
          title="Tasks done, of those to do, in each worktree this plan is split across"
        >
          {worktreeProgress.map((g) => {
            const readiness = g.branch
              ? worktreeReadiness(workstreams.find((w) => w.branch === g.branch && !w.root.startsWith('branch:')), signals)
              : null;
            return (
              <span key={g.branch ?? '(any)'} data-testid="worktree-progress-entry" className="whitespace-nowrap">
                <span className={g.branch ? 'font-mono text-sky-300/90' : 'italic'}>{g.branch ?? 'any worktree'}</span>
                {': '}
                <span className="text-foreground-muted">{g.done} of {g.total}</span>
                {readiness && (
                  <span
                    data-testid="worktree-readiness"
                    data-ready={readiness.ready ? 'true' : 'false'}
                    title={readiness.lines.join('\n')}
                    className={readiness.ready ? 'text-success' : 'text-warning/90'}
                  >
                    {' · '}{readiness.ready ? '✓ ' : ''}{readiness.short}
                  </span>
                )}
              </span>
            );
          })}
        </div>
      )}

      <div
        className="flex-1 overflow-y-auto py-1.5"
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => setDrag({ draggedUid: null, overUid: null, position: null })}
      >
        {rootUids.length === 0 ? (
          <div className="px-3 py-7 text-center">
            <p className="text-[12.5px] text-foreground-subtle italic leading-relaxed">
              Empty plan. Add a page or task below.
            </p>
            <div className="flex justify-center gap-2 mt-3.5">
              <button
                onClick={() => createItem({ planUid, kind: 'object', title: 'New page' })}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] rounded-md border border-white/[0.06] text-foreground-muted hover:text-foreground hover:bg-white/[0.04]"
              >
                <FileText size={12} /> Page
              </button>
              <button
                onClick={() => createItem({ planUid, kind: 'action', title: 'New task' })}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] rounded-md border border-accent/30 text-accent hover:bg-accent/10"
              >
                <Zap size={12} /> Task
              </button>
            </div>
          </div>
        ) : (
          rootUids.map((uid) => renderNode(uid, 0))
        )}
      </div>
    </div>
  );
}

function ItemRow({
  item, depth, isSelected, hasChildren, isOpen, onToggle, onClick,
  drag, setDrag, isDropTarget, onDrop, gitState, status,
}: {
  item: PlanItem;
  depth: number;
  isSelected: boolean;
  hasChildren: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onClick: () => void;
  drag: DragState;
  setDrag: (d: DragState) => void;
  isDropTarget: boolean;
  onDrop: (targetUid: string, position: DropPosition) => void;
  gitState?: PlanItemGitState;
  /** C2.4 — the item's state with its source. */
  status?: ItemStatus;
}) {
  const createItem = usePlanItemsStore((s) => s.createItem);
  const updateItem = usePlanItemsStore((s) => s.updateItem);
  const deleteItem = usePlanItemsStore((s) => s.deleteItem);
  const openHistoryDrawer = usePlanItemsStore((s) => s.openHistoryDrawer);
  const addToast = useToastStore((s) => s.addToast);
  const [menuOpen, setMenuOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const isLocal = item.visibility === 'local';

  const KindIcon = item.kind === 'action' ? Zap : FileText;
  // B5.3: while replaying, the task's status at the cursor's moment; a task
  // made after it is shown faded, since it did not exist yet.
  const replaying = useReplayStore((st) => st.active && st.state !== null);
  const replayStatus = useReplayStore((st) => (st.active && st.state ? st.statuses[item.uid] : undefined));
  const notYet = replaying && item.kind === 'action' && replayStatus === undefined;
  const shownStatus = replaying && item.kind === 'action' ? replayStatus ?? null : item.status;
  const statusMeta = item.kind === 'action' && shownStatus
    ? STATUS_ICON[shownStatus as keyof typeof STATUS_ICON] ?? null
    : null;

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.uid);
    setDrag({ draggedUid: item.uid, overUid: null, position: null });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (drag.draggedUid === item.uid) return;

    const rect = rowRef.current?.getBoundingClientRect();
    if (!rect) return;

    const y = e.clientY - rect.top;
    const third = rect.height / 3;
    let position: DropPosition;
    if (y < third) position = 'above';
    else if (y > third * 2) position = 'below';
    else position = 'inside';

    if (drag.overUid !== item.uid || drag.position !== position) {
      setDrag({ ...drag, overUid: item.uid, position });
    }
  };

  const handleDragLeave = () => {
    if (drag.overUid === item.uid) {
      setDrag({ ...drag, overUid: null, position: null });
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (drag.draggedUid && drag.position) {
      onDrop(item.uid, drag.position);
    }
    setDrag({ draggedUid: null, overUid: null, position: null });
  };

  const handleDragEnd = () => {
    setDrag({ draggedUid: null, overUid: null, position: null });
  };

  // Visual indicators for drop position
  const dropIndicator = isDropTarget && drag.position && drag.draggedUid !== item.uid;

  return (
    <div
      ref={rowRef}
      aria-current={isSelected ? 'true' : undefined}
      data-replay-status={replaying && item.kind === 'action' ? (notYet ? 'not-yet' : shownStatus ?? 'none') : undefined}
      data-state={status?.state}
      data-state-source={status?.source}
      title={notYet ? 'Made after the moment being replayed' : status ? statusLine(status) : undefined}
      className={[
        'group relative flex items-center gap-1.5 px-1.5 py-1.5 cursor-pointer rounded-md mx-1.5',
        notYet ? 'opacity-40' : '',
        isSelected ? 'bg-accent/10 ring-1 ring-accent/30' : 'hover:bg-white/[0.03]',
        dropIndicator && drag.position === 'inside' ? 'ring-1 ring-accent/50 bg-accent/5' : '',
      ].join(' ')}
      style={{ paddingLeft: 6 + depth * 14 }}
      onClick={onClick}
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onDragEnd={handleDragEnd}
    >
      {/* Drop position indicators */}
      {dropIndicator && drag.position === 'above' && (
        <div className="absolute left-2 right-2 top-0 h-0.5 bg-accent rounded-full" />
      )}
      {dropIndicator && drag.position === 'below' && (
        <div className="absolute left-2 right-2 bottom-0 h-0.5 bg-accent rounded-full" />
      )}

      {/* Drag handle (visible on hover) */}
      <div className="opacity-0 group-hover:opacity-60 shrink-0 cursor-grab active:cursor-grabbing -ml-0.5 mr-0">
        <GripVertical size={10} className="text-foreground-subtle" />
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        className={`shrink-0 w-3.5 h-3.5 flex items-center justify-center text-foreground-subtle ${hasChildren ? '' : 'invisible'}`}
        aria-label={isOpen ? 'Collapse' : 'Expand'}
      >
        {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      <KindIcon
        size={13}
        className={`shrink-0 ${item.kind === 'action' ? 'text-accent' : 'text-foreground-subtle'}`}
      />
      {statusMeta && (
        <statusMeta.Icon size={12} className={`shrink-0 ${statusMeta.tint}`} />
      )}
      <span className={`text-[13px] truncate flex-1 ${isSelected ? 'text-foreground font-medium' : 'text-foreground-muted'}`}>
        {item.title || <em className="text-foreground-subtle">untitled</em>}
      </span>
      {/* Phase 32 C5.3 — the worktree this section is kept to (set here; its tasks inherit it). */}
      {item.workstream && (
        <span
          data-testid="item-worktree"
          title={`Worked in ${item.workstream}: its tasks are offered only to agents working there`}
          className="shrink-0 max-w-[45%] truncate rounded border border-sky-400/25 bg-sky-500/10 px-1 font-mono text-[10px] text-sky-300"
        >
          ⎇ {item.workstream}
        </span>
      )}
      {/* C2.1 — what git proves about that branch, on the section that names it; C2.2b — and a review host, when turned on. */}
      {item.workstream && gitState && gitState.state !== 'none' && (
        <span
          data-testid="item-git-state"
          data-state={gitState.state}
          data-source={gitState.source}
          title={gitStateTitle(gitState, sourceWords(gitState))}
          className={`shrink-0 rounded border px-1 text-[10px] ${GIT_STATE_TONE[gitState.state] ?? ''}`}
        >
          {gitStateChip(gitState)}
        </span>
      )}
      {item.kind === 'action' && typeof item.progressPercent === 'number' && item.progressPercent > 0 && (
        <span className="text-[10.5px] text-foreground-subtle shrink-0">{item.progressPercent}%</span>
      )}

      {/* Phase 5.2 — visibility indicator. Always visible when local;
          shows on hover when shared (shared is the default, less noisy). */}
      {isLocal && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            updateItem(item.uid, { visibility: 'shared' });
          }}
          className="shrink-0 p-0.5 rounded text-violet-400/70 hover:text-violet-300 hover:bg-violet-500/10 transition-colors"
          title="Local only — not exported to git. Click to share."
        >
          <EyeOff size={11} />
        </button>
      )}

      {/* Hover affordances */}
      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 transition-opacity">
        <NewButton
          planUid={item.planUid}
          parentUid={item.uid}
          createItem={createItem}
          compact
        />
        <button
          onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
          className="p-1 rounded hover:bg-white/[0.06] text-foreground-subtle hover:text-foreground"
          title="More"
        >
          <MoreHorizontal size={13} />
        </button>
      </div>

      {menuOpen && (
        <div
          className="absolute right-3 mt-16 z-30 rounded-md border border-white/[0.08] bg-[#0c0e1a] shadow-lg p-1.5 text-[12.5px] min-w-[180px]"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              updateItem(item.uid, {
                visibility: isLocal ? 'shared' : 'local',
              });
              setMenuOpen(false);
            }}
            className="w-full flex items-center gap-2 px-2.5 py-2 text-left rounded hover:bg-white/[0.04]"
          >
            {isLocal
              ? <><Eye size={13} className="text-foreground-subtle" /> Make shared</>
              : <><EyeOff size={13} className="text-violet-400/70" /> Make local</>}
          </button>
          <button
            onClick={() => { openHistoryDrawer(item.uid); setMenuOpen(false); }}
            className="w-full flex items-center gap-2 px-2.5 py-2 text-left rounded hover:bg-white/[0.04]"
          >
            <History size={13} className="text-foreground-subtle" /> History
          </button>
          <button
            onClick={async () => {
              setMenuOpen(false);
              if (!confirm(`Delete "${item.title}" and its children?`)) return;
              await deleteItem(item.uid, true);
              addToast({ type: 'info', title: 'Item deleted', message: item.title, duration: 3000 });
            }}
            className="w-full flex items-center gap-2 px-2.5 py-2 text-left rounded hover:bg-red-500/10 text-red-300"
          >
            <Trash2 size={13} /> Delete
          </button>
        </div>
      )}
    </div>
  );
}

function NewButton({
  planUid, parentUid, createItem, compact,
}: {
  planUid: string;
  parentUid: string | null;
  createItem: ReturnType<typeof usePlanItemsStore.getState>['createItem'];
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 ${
          compact
            ? 'p-1 rounded hover:bg-white/[0.06] text-foreground-subtle hover:text-foreground'
            : 'px-2 py-1 rounded text-[12px] text-accent hover:bg-accent/10'
        }`}
        title="Add child item"
      >
        <Plus size={compact ? 13 : 12} />
        {!compact && <span>New</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-30 rounded-md border border-white/[0.08] bg-[#0c0e1a] shadow-lg p-1.5 text-[12.5px] min-w-[180px]">
          <button
            onClick={async () => {
              setOpen(false);
              const item = await createItem({ planUid, kind: 'object' as PlanItemKind, parentUid, title: 'New page' });
              if (item) usePlanItemsStore.getState().selectItem(item.uid);
            }}
            className="w-full flex items-center gap-2 px-2.5 py-2 text-left rounded hover:bg-white/[0.04]"
          >
            <FileText size={13} className="text-foreground-subtle" /> Page
          </button>
          <button
            onClick={async () => {
              setOpen(false);
              const item = await createItem({ planUid, kind: 'action' as PlanItemKind, parentUid, title: 'New task' });
              if (item) usePlanItemsStore.getState().selectItem(item.uid);
            }}
            className="w-full flex items-center gap-2 px-2.5 py-2 text-left rounded hover:bg-white/[0.04]"
          >
            <Zap size={13} className="text-accent" /> Task
          </button>
        </div>
      )}
    </div>
  );
}
