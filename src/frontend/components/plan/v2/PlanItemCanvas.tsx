import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight, FileText, Zap, Folder, Copy, History,
  CheckCircle2, Circle, Loader2, Ban, SkipForward, User,
  AlertTriangle, MessageSquare, HelpCircle, Activity, Hash,
  X,
} from 'lucide-react';
import { usePlanItemsStore } from '../../../stores/plan-items-store';
import { usePlanStore } from '../../../stores/plan-store';
import { useProjectStore } from '../../../stores/project-store';
import { useToastStore } from '../../../stores/toast-store';
import { fileToBase64 } from '../../../lib/attachment-helpers';
import { useSlashMenu } from './SlashMenu';
import { useMentionPicker } from './MentionPicker';
import { BodyRenderer } from './BodyRenderer';
import { PlanGitContextChip } from './PlanGitContextChip';
import { PlanDiffPanel } from './PlanDiffPanel';
import { ContextRail } from './ContextRail';
import { TargetsStrip } from './TargetsStrip';
import { ItemRoutingPanel } from './ItemRoutingPanel';
import { PlanLevelNudge, ItemLevelNudge } from './PlanQualityNudge';
import type {
  PlanItem, TaskStatus, Comment,
} from '@shared/types';

const STATUS_META: Record<TaskStatus, { label: string; tint: string; Icon: typeof Circle }> = {
  pending: { label: 'Pending', tint: 'text-zinc-400', Icon: Circle },
  assigned: { label: 'Assigned', tint: 'text-blue-400', Icon: User },
  in_progress: { label: 'In progress', tint: 'text-accent', Icon: Loader2 },
  done: { label: 'Done', tint: 'text-green-400', Icon: CheckCircle2 },
  blocked: { label: 'Blocked', tint: 'text-red-400', Icon: Ban },
  skipped: { label: 'Skipped', tint: 'text-zinc-500', Icon: SkipForward },
};

const COMMENT_KIND_META: Record<NonNullable<Comment['kind']>, { Icon: typeof MessageSquare; tint: string; label: string }> = {
  note: { Icon: MessageSquare, tint: 'text-foreground-muted', label: 'Note' },
  blocker: { Icon: AlertTriangle, tint: 'text-red-400', label: 'Blocker' },
  progress: { Icon: Activity, tint: 'text-accent', label: 'Progress' },
  question: { Icon: HelpCircle, tint: 'text-amber-400', label: 'Question' },
};

/**
 * Phase 15 §15.D — page canvas. One item at a time, breadcrumb +
 * body editor + (for Actions) right-rail metadata. Body edits
 * autosave with a 500ms debounce → /api/items/:uid PUT, which writes
 * a `plan_item_versions` row server-side.
 */
export function PlanItemCanvas() {
  const selectedItemUid = usePlanItemsStore((s) => s.selectedItemUid);
  const itemsByUid = usePlanItemsStore((s) => s.itemsByUid);
  const contextByUid = usePlanItemsStore((s) => s.contextByUid);
  const projectRoot = useProjectStore((s) => s.root);
  const addToast = useToastStore((s) => s.addToast);

  // Canvas-level ⌘V paste — when the user pastes while focused
  // anywhere in the canvas (other than text inputs), attach any
  // image / video bytes from the clipboard. Plain text paste in
  // textareas is unaffected because the textarea consumes the
  // event before it bubbles here.
  useEffect(() => {
    if (!selectedItemUid) return;
    const handler = async (e: ClipboardEvent) => {
      // Don't fight a textarea / input that owns the focus.
      const target = document.activeElement;
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || (target as HTMLElement).isContentEditable)) {
        return;
      }
      const items = e.clipboardData?.items ?? [];
      for (const item of Array.from(items)) {
        if (item.kind !== 'file') continue;
        const file = item.getAsFile();
        if (!file) continue;
        const isImage = file.type.startsWith('image/');
        const isVideo = file.type.startsWith('video/');
        if (!isImage && !isVideo) continue;
        e.preventDefault();
        try {
          const dataBase64 = await fileToBase64(file);
          await fetch(`/api/items/${selectedItemUid}/attachments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              kind: isImage ? 'image' : 'video',
              value: file.name || (isImage ? 'pasted-image.png' : 'pasted-video.mp4'),
              label: file.name || (isImage ? 'Pasted image' : 'Pasted video'),
              contentType: file.type,
              dataBase64,
              projectRoot: projectRoot ?? undefined,
            }),
          });
          addToast({
            type: 'success',
            title: `Pasted ${isImage ? 'image' : 'video'} attached`,
            message: file.name || 'from clipboard',
            duration: 3000,
          });
        } catch (err) {
          addToast({ type: 'error', title: 'Paste failed', message: String(err) });
        }
      }
    };
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, [selectedItemUid, projectRoot, addToast]);

  // No item selected → render the plan itself as a Notion-style home
  // page (hero title, metadata chips, body, child list). Phase 15 §15.D
  // shift: a plan IS a page, not just a container of items.
  if (!selectedItemUid) {
    return <PlanHomePage />;
  }
  const item = itemsByUid[selectedItemUid];
  if (!item) {
    return <PlanHomePage />;
  }
  const ctx = contextByUid[selectedItemUid];

  return (
    <div className="h-full flex flex-col bg-[#06070d] min-w-0">
      <Breadcrumb item={item} />
      <div className="flex-1 overflow-y-auto">
        {/* Single-column content flow — body up top, supporting context
            (attachments, comments, children) below. Reads like a
            research page rather than a metadata-stuffed admin panel. */}
        <div className="max-w-[42rem] mx-auto px-10 py-10 space-y-10">
          <ItemHeaderProperties item={item} />
          <BodyEditor key={item.uid} item={item} />
          <TargetsStrip item={item} />
          <ItemRoutingPanel item={item} />
          <ItemLevelNudge item={item} attachments={ctx?.attachments ?? []} />
          <ContextRail item={item} attachments={ctx?.attachments ?? []} />
          <ChildrenList ctx={ctx} />
          <CommentsBlock
            itemUid={item.uid}
            isAction={item.kind === 'action'}
            comments={ctx?.comments ?? []}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Top-of-page property chip row — replaces the cramped right-rail
 * key/value table. Only renders for Actions (Objects don't have
 * status / scope / fileSpecs). Each chip is a popover trigger so
 * editing stays inline without leaving the canvas.
 */
function ItemHeaderProperties({ item }: { item: PlanItem }) {
  const updateItem = usePlanItemsStore((s) => s.updateItem);
  const openHistoryDrawer = usePlanItemsStore((s) => s.openHistoryDrawer);
  const addToast = useToastStore((s) => s.addToast);

  const isAction = item.kind === 'action';

  const copyContext = async () => {
    const lines: string[] = [`# ${item.title}`, ''];
    if (item.scopePath) lines.push(`**Scope:** \`${item.scopePath}\``);
    if (item.body?.trim()) {
      lines.push('', '## Context', item.body.trim());
    }
    if (isAction && item.fileSpecs && item.fileSpecs.length > 0) {
      lines.push('', '## Files');
      for (const fs of item.fileSpecs) {
        const path = fs.action === 'move' && fs.moveTo ? `${fs.path} → ${fs.moveTo}` : fs.path;
        const desc = fs.description ? ` — ${fs.description}` : '';
        lines.push(`- **${fs.action}** \`${path}\`${desc}`);
      }
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      addToast({ type: 'success', title: 'Item context copied', message: 'Paste at any agent.', duration: 3000 });
    } catch {
      addToast({ type: 'error', title: 'Copy failed', message: 'Browser denied clipboard access.' });
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap text-[13px] text-foreground-subtle">
      <span className="text-[11.5px] uppercase tracking-wider font-medium px-2.5 py-1 rounded-full border border-white/[0.08] bg-white/[0.02]">
        {isAction ? 'Task' : 'Page'}
      </span>

      {isAction && (
        <>
          <select
            value={item.status ?? 'pending'}
            onChange={(e) => updateItem(item.uid, { status: e.target.value as TaskStatus })}
            className="bg-white/[0.02] border border-white/[0.08] rounded-full px-3 py-1 text-[12.5px] text-foreground focus:outline-none focus:border-accent/40 hover:border-white/[0.16]"
            title="Change status"
          >
            {(Object.keys(STATUS_META) as TaskStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_META[s].label}</option>
            ))}
          </select>

          {item.assignee && (
            <span className="px-2.5 py-1 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-300 text-[12px]">
              👤 {item.assignee}
            </span>
          )}

          {typeof item.progressPercent === 'number' && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-white/[0.08] bg-white/[0.02]">
              <span className="w-14 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                <span className="block h-full bg-accent/60" style={{ width: `${item.progressPercent}%` }} />
              </span>
              <span className="text-[11.5px]">{item.progressPercent}%</span>
            </span>
          )}

          {item.scopePath && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-white/[0.08] bg-white/[0.02] font-mono text-[12px]">
              <Folder size={11} className="opacity-70" />
              {item.scopePath}
            </span>
          )}

          {item.fileSpecs && item.fileSpecs.length > 0 && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-white/[0.08] bg-white/[0.02] text-[12px]">
              <FileText size={11} className="opacity-70" />
              {item.fileSpecs.length} file{item.fileSpecs.length === 1 ? '' : 's'}
            </span>
          )}

          {/* Phase 17.K — Approval gate toggle */}
          <button
            onClick={() => updateItem(item.uid, { requiresApproval: !item.requiresApproval })}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12px] transition-colors ${
              item.requiresApproval
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                : 'border-white/[0.08] bg-white/[0.02] text-foreground-subtle hover:text-foreground-muted'
            }`}
            title={item.requiresApproval
              ? 'Approval gate ON — agent must wait for human approval after completing this item'
              : 'No approval gate — click to require human approval before next task starts'}
          >
            {item.requiresApproval ? '🔒' : '🔓'}
            Gate
          </button>
        </>
      )}

      <div className="flex-1" />

      <button
        onClick={copyContext}
        className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] hover:text-foreground text-[12.5px]"
        title="Copy item context as a markdown block ready to paste at any agent"
      >
        <Copy size={12} />
        Copy context
      </button>
      <button
        onClick={() => openHistoryDrawer(item.uid)}
        className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] hover:text-foreground text-[12.5px]"
        title="History (versions + events)"
      >
        <History size={12} />
        History
      </button>

      {item.blockedReason && (
        <div className="basis-full mt-1.5 rounded-md bg-red-500/[0.08] border border-red-500/30 p-2.5 text-[13px] text-red-300">
          <strong className="block mb-0.5">Blocked:</strong>
          {item.blockedReason}
        </div>
      )}
    </div>
  );
}

/**
 * Phase 15 §15.D — plan home page.
 *
 * Rendered when no item is selected. The plan IS a page:
 *   - Hero title (in-place editable, autosave)
 *   - Metadata chips (status, link-to-disk, V2)
 *   - Body editor — full-width markdown, Notion-style
 *   - Sub-pages list at the bottom (top-level items in the tree)
 *
 * The plan's `description` field carries the body. There's no
 * separate "plan body" column today — `description` is the right
 * place because it's always shipped with the plan in YAML round-trip.
 * Slash menu inside the body editor creates sub-Objects / sub-Actions
 * inline.
 */
function PlanHomePage() {
  const plan = usePlanStore((s) => s.activePlan);
  const fetchPlans = usePlanStore((s) => s.fetchPlans);
  const projectRoot = useProjectStore((s) => s.root);
  const itemsByUid = usePlanItemsStore((s) => s.itemsByUid);
  const selectItem = usePlanItemsStore((s) => s.selectItem);
  const createItem = usePlanItemsStore((s) => s.createItem);

  const [title, setTitle] = useState(plan?.title ?? '');
  const [description, setDescription] = useState(plan?.description ?? '');
  const titleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local state when the active plan flips (different plan opens).
  useEffect(() => {
    if (!plan) return;
    setTitle(plan.title ?? '');
    setDescription(plan.description ?? '');
  }, [plan?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveTitle = (next: string) => {
    setTitle(next);
    if (!plan) return;
    if (titleDebounceRef.current) clearTimeout(titleDebounceRef.current);
    titleDebounceRef.current = setTimeout(async () => {
      await fetch(`/api/plans/${plan.uid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: next.trim() || 'Untitled plan' }),
      });
      fetchPlans(projectRoot ?? undefined);
    }, 500);
  };

  const saveDescription = (next: string) => {
    setDescription(next);
    if (!plan) return;
    if (bodyDebounceRef.current) clearTimeout(bodyDebounceRef.current);
    bodyDebounceRef.current = setTimeout(async () => {
      await fetch(`/api/plans/${plan.uid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: next }),
      });
    }, 600);
  };

  // Top-level items in the tree (no parent).
  const topLevel = useMemo(() => {
    return Object.values(itemsByUid)
      .filter((i) => i.parentUid === null)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [itemsByUid]);

  if (!plan) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-[#06070d] text-foreground-subtle text-[14px] gap-2.5">
        <FileText size={32} className="opacity-40" />
        <p>No plan selected.</p>
      </div>
    );
  }

  const isEmpty = topLevel.length === 0 && !description.trim();

  return (
    <div className="h-full flex flex-col bg-[#06070d] min-w-0">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[42rem] mx-auto px-10 py-12 space-y-8">
          {/* Hero */}
          <div className="space-y-3">
            <input
              type="text"
              value={title}
              onChange={(e) => saveTitle(e.target.value)}
              placeholder="Untitled plan"
              className="w-full bg-transparent border-0 text-[40px] font-bold text-foreground placeholder:text-foreground-subtle focus:outline-none focus:ring-0 px-0 leading-tight"
            />
            <div className="flex items-center gap-2 flex-wrap text-[13px] text-foreground-subtle">
              <span className="px-2.5 py-1 rounded-full border border-white/[0.08] bg-white/[0.02] uppercase tracking-wider text-[11.5px] font-medium">
                Plan
              </span>
              <span className={`px-2.5 py-1 rounded-full border text-[12.5px] ${
                plan.status === 'approved' ? 'border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-300' :
                plan.status === 'in_progress' ? 'border-accent/30 bg-accent/[0.08] text-accent' :
                plan.status === 'completed' ? 'border-green-500/30 bg-green-500/[0.08] text-green-400' :
                'border-white/[0.08] bg-white/[0.02]'
              }`}>
                {plan.status}
              </span>
              <span className="px-2.5 py-1 rounded-full border border-white/[0.08] bg-white/[0.02] text-[12.5px]">
                {plan.completedTaskCount ?? 0}/{plan.taskCount ?? 0} actions
              </span>
              <PlanGitContextChip plan={plan} />
            </div>
          </div>

          {/* Progress summary — shows task breakdown when there are actions */}
          <PlanProgressSummary items={Object.values(itemsByUid)} />

          {/* Body — click-to-edit. Read mode shows the chip-aware
              renderer; edit mode opens a textarea with the slash
              menu. Same pattern as the item body editor. */}
          <PlanBodyArea
            value={description}
            onChange={saveDescription}
            placeholder="Write what this plan is about. Paste a transcript, drop a Figma link, sketch a strategy. Press '/' for sub-pages, todos, code blocks…"
          />

          {/* Plan-level nudge — surfaces when the plan looks vague.
              Friendly coach, dismissible, never blocks anything. */}
          <PlanLevelNudge plan={plan} topLevelCount={topLevel.length} />

          {/* Plan diff — what's planned vs what's landed. Shown
              when there's something to diff (any Action with intent). */}
          <PlanDiffPanel planUid={plan.uid} />

          {/* Children */}
          {topLevel.length > 0 && (
            <section>
              <h3 className="text-[12px] uppercase tracking-[0.1em] text-foreground-subtle font-semibold mb-3">
                Pages in this plan · {topLevel.length}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {topLevel.map((c) => (
                  <button
                    key={c.uid}
                    onClick={() => selectItem(c.uid)}
                    className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-accent/30 text-left transition-colors"
                  >
                    {c.kind === 'action'
                      ? <Zap size={14} className="text-accent shrink-0" />
                      : <FileText size={14} className="text-foreground-subtle shrink-0" />}
                    <span className="text-[14px] truncate flex-1 text-foreground">
                      {c.title || 'untitled'}
                    </span>
                    {c.kind === 'action' && c.status && (
                      <span className="text-[10.5px] uppercase tracking-wider text-foreground-subtle">
                        {c.status}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Quick add — visible when the plan has nothing yet, hidden
              after content lands so it doesn't compete with the body. */}
          {isEmpty && (
            <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.015] p-7 text-center space-y-4">
              <p className="text-[14px] text-foreground-muted leading-relaxed">
                Empty plan. Start with a thought (just type above) or seed structure with sub-pages.
              </p>
              <div className="flex justify-center gap-2.5">
                <button
                  onClick={async () => {
                    const item = await createItem({ planUid: plan.uid, kind: 'object', title: 'New page' });
                    if (item) selectItem(item.uid);
                  }}
                  className="flex items-center gap-2 px-4 py-2 text-[13px] rounded-md border border-white/[0.08] text-foreground-muted hover:text-foreground hover:bg-white/[0.04]"
                >
                  <FileText size={13} /> New page
                </button>
                <button
                  onClick={async () => {
                    const item = await createItem({ planUid: plan.uid, kind: 'action', title: 'New task' });
                    if (item) selectItem(item.uid);
                  }}
                  className="flex items-center gap-2 px-4 py-2 text-[13px] rounded-md bg-accent text-white hover:bg-accent-hover shadow-[0_0_10px_rgba(59,130,246,0.2)]"
                >
                  <Zap size={13} /> New task
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Phase 15 §15.D — plan body area (used on plan home).
 *
 * Click-to-edit toggle: rendered chip-aware view by default, textarea
 * with slash menu when focused. Slash-menu sub-pages land at the
 * plan root (parentItemUid is null implicitly).
 */
function PlanBodyArea({
  value, onChange, placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  // Start in edit mode when the body is empty — just start typing.
  const [editing, setEditing] = useState(!value.trim());
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  const slash = useSlashMenu({ textareaRef: ref, onChange: setDraft, parentItemUid: null });
  const mention = useMentionPicker({ textareaRef: ref, onChange: setDraft });

  // Sync from prop when not editing (e.g. WS push, plan switch).
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onChange(draft);
  };

  if (editing) {
    return (
      <div className="relative">
        <textarea
          autoFocus
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            slash.textareaProps.onKeyDown(e);
            if (e.defaultPrevented) return;
            mention.textareaProps.onKeyDown(e);
            if (e.defaultPrevented) return;
            if (e.key === 'Escape') {
              setDraft(value);
              setEditing(false);
            }
            if ((e.metaKey || e.ctrlKey) && e.key === 's') {
              e.preventDefault();
              commit();
            }
          }}
          onInput={(e) => {
            slash.textareaProps.onInput(e);
            mention.textareaProps.onInput(e);
          }}
          placeholder={placeholder}
          className="w-full min-h-[260px] bg-transparent border-0 text-[16px] text-foreground placeholder:text-foreground-subtle focus:outline-none focus:ring-0 resize-y leading-[1.75] px-0"
        />
        {slash.picker}
        {mention.picker}
      </div>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="w-full text-left rounded-lg p-3 -ml-3 min-h-[180px] hover:bg-white/[0.02] transition-colors"
    >
      {value.trim() ? (
        <div className="text-[16px] leading-[1.75] text-foreground">
          <BodyRenderer source={value} />
        </div>
      ) : (
        <p className="text-foreground-subtle italic text-[15px] leading-relaxed">
          {placeholder ?? 'Click to write…'}
        </p>
      )}
    </button>
  );
}

function Breadcrumb({ item }: { item: PlanItem }) {
  const itemsByUid = usePlanItemsStore((s) => s.itemsByUid);
  const selectItem = usePlanItemsStore((s) => s.selectItem);

  // Walk up parent chain (typical depth < 5; cheap).
  const chain = useMemo(() => {
    const out: PlanItem[] = [];
    let cur: PlanItem | undefined = item;
    while (cur) {
      out.unshift(cur);
      cur = cur.parentUid ? itemsByUid[cur.parentUid] : undefined;
    }
    return out;
  }, [item, itemsByUid]);

  return (
    <div className="border-b border-white/[0.06] px-6 py-2.5 flex items-center gap-1.5 bg-[#0a0b14] text-[13px] text-foreground-subtle">
      {chain.map((c, i) => (
        <span key={c.uid} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight size={12} className="opacity-50" />}
          <button
            onClick={() => selectItem(c.uid)}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-white/[0.04] transition-colors ${
              c.uid === item.uid ? 'text-foreground font-medium' : 'hover:text-foreground-muted'
            }`}
          >
            {c.kind === 'action' ? (
              <Zap size={12} className="text-accent" />
            ) : (
              <FileText size={12} className="text-foreground-subtle" />
            )}
            <span className="max-w-[260px] truncate">{c.title || 'untitled'}</span>
          </button>
        </span>
      ))}
    </div>
  );
}

function BodyEditor({ item }: { item: PlanItem }) {
  const updateItem = usePlanItemsStore((s) => s.updateItem);
  const [title, setTitle] = useState(item.title);
  const [body, setBody] = useState(item.body ?? '');
  // Start in edit mode when the body is empty — no click-to-enter needed.
  const [editingBody, setEditingBody] = useState(!(item.body ?? '').trim());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset local state when the selected item flips.
  useEffect(() => {
    setTitle(item.title);
    setBody(item.body ?? '');
  }, [item.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced autosave for title.
  const saveTitle = (next: string) => {
    setTitle(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateItem(item.uid, { title: next });
    }, 500);
  };

  const saveBody = async () => {
    setEditingBody(false);
    if (body !== (item.body ?? '')) {
      await updateItem(item.uid, { body });
    }
  };

  // Slash menu — sub-pages and Actions land as children of THIS item.
  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);
  const slash = useSlashMenu({
    textareaRef: bodyTextareaRef,
    onChange: setBody,
    parentItemUid: item.uid,
  });
  // 15.D.2 — when user @-mentions a file or symbol, also write to
  // the item's structured data so it appears in TargetsStrip + drift detection.
  const handleFileTarget = (path: string) => {
    const existing = item.fileSpecs ?? [];
    if (existing.some((fs) => fs.path === path)) return;
    updateItem(item.uid, { fileSpecs: [...existing, { path, action: 'modify', edits: [] }] });
  };
  const handleSymbolTarget = (name: string, kind: string, filePath: string) => {
    const existing = item.symbolSpecs ?? [];
    if (existing.some((ss) => ss.name === name && ss.filePath === filePath)) return;
    const validKinds = ['function', 'class', 'interface', 'type', 'method', 'enum'] as const;
    const safeKind = validKinds.includes(kind as typeof validKinds[number])
      ? (kind as typeof validKinds[number])
      : 'function';
    updateItem(item.uid, {
      symbolSpecs: [...existing, { name, kind: safeKind, action: 'modify', filePath }],
    });
  };
  const mention = useMentionPicker({
    textareaRef: bodyTextareaRef,
    onChange: setBody,
    onFileTarget: handleFileTarget,
    onSymbolTarget: handleSymbolTarget,
  });

  return (
    <div className="space-y-4">
      <input
        type="text"
        value={title}
        onChange={(e) => saveTitle(e.target.value)}
        placeholder="Untitled"
        className="w-full bg-transparent border-0 text-[32px] font-bold text-foreground placeholder:text-foreground-subtle focus:outline-none focus:ring-0 px-0 leading-tight"
      />

      {editingBody ? (
        <div className="relative">
          <textarea
            autoFocus
            ref={bodyTextareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onBlur={saveBody}
            onKeyDown={(e) => {
              slash.textareaProps.onKeyDown(e);
              if (e.defaultPrevented) return;
              mention.textareaProps.onKeyDown(e);
              if (e.defaultPrevented) return;
              if (e.key === 'Escape') {
                setBody(item.body ?? '');
                setEditingBody(false);
              }
              if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                e.preventDefault();
                saveBody();
              }
            }}
            onInput={(e) => {
              slash.textareaProps.onInput(e);
              mention.textareaProps.onInput(e);
            }}
            placeholder="Type your notes. Press '/' for sub-pages, '@' to mention items/files/symbols, headings, todos, code…"
            className="w-full min-h-[400px] bg-transparent border-0 text-[16px] text-foreground placeholder:text-foreground-subtle focus:outline-none focus:ring-0 resize-y leading-[1.75] px-0"
          />
          {slash.picker}
          {mention.picker}
        </div>
      ) : (
        <button
          onClick={() => setEditingBody(true)}
          className="w-full text-left rounded-lg p-3 -ml-3 min-h-[160px] hover:bg-white/[0.02] transition-colors"
        >
          {body.trim() ? (
            <div className="text-[16px] leading-[1.75] text-foreground">
              <BodyRenderer source={body} />
            </div>
          ) : (
            <p className="text-foreground-subtle italic text-[15px] leading-relaxed">
              Click to write. Markdown supported — / for slash menu (sub-pages, Actions, headings, todos, code).
            </p>
          )}
        </button>
      )}
    </div>
  );
}


/**
 * Compact progress summary on the plan home page. Shows a horizontal
 * bar + status breakdown when the plan has tasks. Hidden when there
 * are no actions (progressive disclosure).
 */
function PlanProgressSummary({ items }: { items: PlanItem[] }) {
  const actions = items.filter((i) => i.kind === 'action');
  if (actions.length === 0) return null;

  const counts: Record<string, number> = {};
  for (const a of actions) {
    const s = a.status ?? 'pending';
    counts[s] = (counts[s] ?? 0) + 1;
  }
  const done = counts['done'] ?? 0;
  const inProgress = counts['in_progress'] ?? 0;
  const blocked = counts['blocked'] ?? 0;
  const pending = (counts['pending'] ?? 0) + (counts['assigned'] ?? 0) + (counts['skipped'] ?? 0);
  const pct = Math.round((done / actions.length) * 100);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-5 py-4">
      <div className="flex items-center gap-3 mb-3">
        <span className="text-[12px] uppercase tracking-[0.1em] text-foreground-subtle font-semibold">
          Progress
        </span>
        <span className="text-[13px] text-foreground font-medium">{pct}%</span>
        <span className="text-[12px] text-foreground-subtle">
          {done}/{actions.length} tasks done
        </span>
      </div>
      {/* Progress bar */}
      <div className="h-2 rounded-full bg-white/[0.05] overflow-hidden flex">
        {done > 0 && (
          <div className="h-full bg-green-500/70 transition-all" style={{ width: `${(done / actions.length) * 100}%` }} />
        )}
        {inProgress > 0 && (
          <div className="h-full bg-accent/60 transition-all" style={{ width: `${(inProgress / actions.length) * 100}%` }} />
        )}
        {blocked > 0 && (
          <div className="h-full bg-red-500/60 transition-all" style={{ width: `${(blocked / actions.length) * 100}%` }} />
        )}
      </div>
      {/* Legend */}
      <div className="flex items-center gap-4 mt-2.5 text-[12px] text-foreground-subtle">
        {done > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-500/70" /> {done} done
          </span>
        )}
        {inProgress > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-accent/60" /> {inProgress} in progress
          </span>
        )}
        {blocked > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500/60" /> {blocked} blocked
          </span>
        )}
        {pending > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-white/[0.15]" /> {pending} pending
          </span>
        )}
      </div>
    </div>
  );
}

function ChildrenList({ ctx }: { ctx?: { children: PlanItem[] } }) {
  const selectItem = usePlanItemsStore((s) => s.selectItem);
  if (!ctx || ctx.children.length === 0) return null;
  const children = ctx.children;
  return (
    <section>
      <h3 className="text-[12px] uppercase tracking-[0.1em] text-foreground-subtle font-semibold mb-3">
        Children · {children.length}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {children.map((c) => (
          <button
            key={c.uid}
            onClick={() => selectItem(c.uid)}
            className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-accent/30 text-left transition-colors"
          >
            {c.kind === 'action' ? (
              <Zap size={14} className="text-accent shrink-0" />
            ) : (
              <FileText size={14} className="text-foreground-subtle shrink-0" />
            )}
            <span className="text-[14px] truncate flex-1 text-foreground">{c.title || 'untitled'}</span>
            {c.kind === 'action' && c.status && (
              <span className="text-[10.5px] uppercase tracking-wider text-foreground-subtle">
                {c.status}
              </span>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}

function CommentsBlock({
  itemUid, isAction, comments,
}: {
  itemUid: string;
  isAction: boolean;
  comments: Comment[];
}) {
  const addItemComment = usePlanItemsStore((s) => s.addItemComment);
  const removeItemComment = usePlanItemsStore((s) => s.removeItemComment);
  const reportProgress = usePlanItemsStore((s) => s.reportProgress);
  const setItemBlocked = usePlanItemsStore((s) => s.setItemBlocked);
  const [draft, setDraft] = useState('');
  const [kind, setKind] = useState<'note' | 'blocker' | 'progress' | 'question'>('note');
  const [submitting, setSubmitting] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);

  const submit = async () => {
    if (!draft.trim()) return;
    setSubmitting(true);
    try {
      if (isAction && kind === 'progress') {
        const m = draft.match(/(\d{1,3})\s*%/);
        const pct = m ? Math.min(100, Math.max(0, Number(m[1]))) : 50;
        await reportProgress(itemUid, pct, draft.trim());
      } else if (isAction && kind === 'blocker') {
        await setItemBlocked(itemUid, draft.trim());
      } else {
        await addItemComment(itemUid, kind, draft.trim());
      }
      setDraft('');
    } finally {
      setSubmitting(false);
    }
  };

  const sorted = [...comments].sort((a, b) => a.createdAt - b.createdAt);
  const kinds: Array<'note' | 'blocker' | 'progress' | 'question'> = isAction
    ? ['note', 'progress', 'blocker', 'question']
    : ['note', 'question'];

  // Progressive disclosure: if no comments and composer not open, show
  // a single "Add comment" link instead of the full section.
  if (sorted.length === 0 && !composerOpen) {
    return (
      <section>
        <button
          onClick={() => setComposerOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] rounded-md border border-dashed border-white/[0.1] text-foreground-subtle hover:text-foreground hover:border-accent/30 hover:bg-accent/5 transition-colors"
        >
          <MessageSquare size={12} /> Add comment
        </button>
      </section>
    );
  }

  return (
    <section>
      <h3 className="text-[12px] uppercase tracking-[0.1em] text-foreground-subtle font-semibold mb-3">
        Comments {sorted.length > 0 && <span className="opacity-60">· {sorted.length}</span>}
      </h3>

      {/* Composer */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-2.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          {kinds.map((k) => {
            const meta = COMMENT_KIND_META[k];
            const active = kind === k;
            return (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-[12px] rounded-full border transition-colors ${
                  active
                    ? 'bg-accent/15 border-accent/30 text-accent'
                    : 'bg-white/[0.02] border-white/[0.06] text-foreground-subtle hover:text-foreground-muted'
                }`}
              >
                <meta.Icon size={12} className={active ? '' : meta.tint} />
                {meta.label}
              </button>
            );
          })}
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            kind === 'progress' ? 'Heartbeat — include "75%" to set the progress bar' :
            kind === 'blocker' ? 'What\'s blocking you? Be specific so the human can unblock.' :
            kind === 'question' ? 'Ask the team or future you…' : 'Note for the room…'
          }
          className="w-full min-h-[80px] bg-transparent text-[14px] text-foreground placeholder:text-foreground-subtle/70 focus:outline-none resize-y leading-relaxed"
        />
        <div className="flex justify-end">
          <button
            disabled={!draft.trim() || submitting}
            onClick={submit}
            className="px-3.5 py-1.5 text-[12.5px] rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {submitting ? 'Posting…' : `Post ${kind}`}
          </button>
        </div>
      </div>

      {/* Thread */}
      {sorted.length > 0 && (
        <div className="space-y-2.5 mt-3">
          {sorted.map((c) => {
            const meta = COMMENT_KIND_META[c.kind ?? 'note'] ?? COMMENT_KIND_META.note;
            const isAgent = (c.source ?? '') === 'agent' || c.authorType !== 'human';
            return (
              <div key={c.uid} className="group rounded-lg border border-white/[0.05] bg-white/[0.015] px-3.5 py-2.5">
                <div className="flex items-center gap-2 text-[11.5px] text-foreground-subtle">
                  <meta.Icon size={12} className={meta.tint} />
                  <span className={`font-medium ${meta.tint}`}>{meta.label}</span>
                  <span>·</span>
                  <span className={isAgent ? 'text-cyan-300' : 'text-foreground-muted'}>{c.author}</span>
                  <span className="ml-auto opacity-60">{new Date(c.createdAt).toLocaleTimeString()}</span>
                  <button
                    onClick={() => {
                      if (confirm('Delete this comment?')) removeItemComment(itemUid, c.uid);
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-foreground-subtle hover:text-red-300 hover:bg-red-500/10"
                    title="Delete comment"
                  >
                    <X size={12} />
                  </button>
                </div>
                <div className="text-[14px] text-foreground mt-1 whitespace-pre-wrap leading-relaxed">
                  {c.body}
                  {c.metadata && typeof (c.metadata as { progressPercent?: number }).progressPercent === 'number' && (
                    <span className="ml-1.5 text-[11.5px] text-accent">({(c.metadata as { progressPercent: number }).progressPercent}%)</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

