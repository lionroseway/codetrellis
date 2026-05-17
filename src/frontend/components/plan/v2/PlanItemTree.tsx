import { useMemo, useState } from 'react';
import {
  ChevronDown, ChevronRight, FileText, Zap, Plus, MoreHorizontal,
  CheckCircle2, Circle, Loader2, Ban, SkipForward, User, History, Trash2,
} from 'lucide-react';
import { usePlanItemsStore, buildItemTree } from '../../../stores/plan-items-store';
import { useToastStore } from '../../../stores/toast-store';
import type { PlanItem, PlanItemKind, TaskStatus } from '@shared/types';

const STATUS_ICON: Record<TaskStatus, { Icon: typeof Circle; tint: string }> = {
  pending: { Icon: Circle, tint: 'text-zinc-500' },
  assigned: { Icon: User, tint: 'text-blue-400' },
  in_progress: { Icon: Loader2, tint: 'text-accent animate-spin' },
  done: { Icon: CheckCircle2, tint: 'text-green-400 drop-shadow-[0_0_3px_rgba(34,197,94,0.5)]' },
  blocked: { Icon: Ban, tint: 'text-red-400' },
  skipped: { Icon: SkipForward, tint: 'text-zinc-500' },
};

/**
 * Phase 15 §15.D — sidebar tree of mixed Objects + Actions.
 *
 * Renders the full tree from `planItemsStore.itemsByUid` keyed by
 * `parentUid`. Click a row → selects in canvas. Click chevron →
 * expand/collapse. Hover → reveals inline `+` (add child) and `⋯`
 * (rename / delete / open history) menu.
 */
export function PlanItemTree({ planUid }: { planUid: string }) {
  const itemsByUid = usePlanItemsStore((s) => s.itemsByUid);
  const selectedItemUid = usePlanItemsStore((s) => s.selectedItemUid);
  const selectItem = usePlanItemsStore((s) => s.selectItem);
  const createItem = usePlanItemsStore((s) => s.createItem);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const { rootUids, childrenByParent } = useMemo(
    () => buildItemTree(itemsByUid),
    [itemsByUid],
  );

  const toggle = (uid: string) =>
    setExpanded((prev) => ({ ...prev, [uid]: !prev[uid] }));

  const renderNode = (uid: string, depth: number): React.ReactNode => {
    const item = itemsByUid[uid];
    if (!item) return null;
    const childUids = childrenByParent[uid] ?? [];
    const isOpen = expanded[uid] ?? true;
    const isSelected = selectedItemUid === uid;
    return (
      <div key={uid}>
        <ItemRow
          item={item}
          depth={depth}
          isSelected={isSelected}
          hasChildren={childUids.length > 0}
          isOpen={isOpen}
          onToggle={() => toggle(uid)}
          onClick={() => selectItem(uid)}
        />
        {isOpen && childUids.length > 0 && (
          <div>{childUids.map((c) => renderNode(c, depth + 1))}</div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col border-r border-white/[0.06] bg-[#080915] min-w-0">
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-white/[0.06]">
        <FileText size={13} className="text-foreground-subtle shrink-0" />
        <span className="text-[12px] font-semibold text-foreground uppercase tracking-wider">
          Items
        </span>
        <span className="text-[11.5px] text-foreground-subtle">
          ({Object.keys(itemsByUid).length})
        </span>
        <div className="flex-1" />
        <NewButton planUid={planUid} parentUid={null} createItem={createItem} />
      </div>

      <div className="flex-1 overflow-y-auto py-1.5">
        {rootUids.length === 0 ? (
          <div className="px-3 py-7 text-center">
            <p className="text-[12.5px] text-foreground-subtle italic leading-relaxed">
              Empty plan. Add an Object (context) or Action (work item) below.
            </p>
            <div className="flex justify-center gap-2 mt-3.5">
              <button
                onClick={() => createItem({ planUid, kind: 'object', title: 'New page' })}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] rounded-md border border-white/[0.06] text-foreground-muted hover:text-foreground hover:bg-white/[0.04]"
              >
                <FileText size={12} /> Object
              </button>
              <button
                onClick={() => createItem({ planUid, kind: 'action', title: 'New action' })}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] rounded-md border border-accent/30 text-accent hover:bg-accent/10"
              >
                <Zap size={12} /> Action
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
}: {
  item: PlanItem;
  depth: number;
  isSelected: boolean;
  hasChildren: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onClick: () => void;
}) {
  const createItem = usePlanItemsStore((s) => s.createItem);
  const deleteItem = usePlanItemsStore((s) => s.deleteItem);
  const openHistoryDrawer = usePlanItemsStore((s) => s.openHistoryDrawer);
  const addToast = useToastStore((s) => s.addToast);
  const [menuOpen, setMenuOpen] = useState(false);

  const KindIcon = item.kind === 'action' ? Zap : FileText;
  const statusMeta = item.kind === 'action' && item.status
    ? STATUS_ICON[item.status]
    : null;

  return (
    <div
      className={`group flex items-center gap-1.5 px-1.5 py-1.5 cursor-pointer rounded-md mx-1.5 ${
        isSelected ? 'bg-accent/10 ring-1 ring-accent/30' : 'hover:bg-white/[0.03]'
      }`}
      style={{ paddingLeft: 6 + depth * 14 }}
      onClick={onClick}
    >
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
      {item.kind === 'action' && typeof item.progressPercent === 'number' && item.progressPercent > 0 && (
        <span className="text-[10.5px] text-foreground-subtle shrink-0">{item.progressPercent}%</span>
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
            <FileText size={13} className="text-foreground-subtle" /> Object (context)
          </button>
          <button
            onClick={async () => {
              setOpen(false);
              const item = await createItem({ planUid, kind: 'action' as PlanItemKind, parentUid, title: 'New action' });
              if (item) usePlanItemsStore.getState().selectItem(item.uid);
            }}
            className="w-full flex items-center gap-2 px-2.5 py-2 text-left rounded hover:bg-white/[0.04]"
          >
            <Zap size={13} className="text-accent" /> Action (work item)
          </button>
        </div>
      )}
    </div>
  );
}
