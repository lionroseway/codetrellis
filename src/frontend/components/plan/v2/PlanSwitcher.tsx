import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, FolderOpen, GitBranch, Search } from 'lucide-react';

import { usePlanStore } from '../../../stores/plan-store';
import { usePlanWorktrees } from '../../../hooks/usePlanWorktrees';
import { openWorktreeTab, worktreeLabel, type WorktreePlanSummary } from '../../../lib/plan-worktrees';
import { StatusBadge } from '../StatusBadge';

/**
 * Switch to another plan without leaving the plan page.
 *
 * With a plan open, the only way to another plan was to minimise the
 * workspace, find the Plans tab in the bottom pane, and pick from there.
 * If that pane was hidden, the page gave no hint other plans existed.
 *
 * Grouped by checkout: this one, the repo's other worktrees (with plans
 * that are on that worktree's disk but not imported yet), then other
 * projects. A plan written by an agent in a sibling worktree is the case
 * this exists for.
 */
export function PlanSwitcher() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const activePlanUid = usePlanStore((s) => s.activePlanUid);
  const setActivePlan = usePlanStore((s) => s.setActivePlan);
  const grouped = usePlanWorktrees(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      setOpen(false);
    };
    // Capture: the workspace's own Escape handler minimises the page.
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const match = (title: string) => !q || title.toLowerCase().includes(q);

  const sections = useMemo(() => {
    const out: { key: string; label: string; icon: 'branch' | 'folder'; path?: string; branch?: string | null; plans: { uid: string; title: string; status: string }[]; onDisk: WorktreePlanSummary[] }[] = [];
    const here = grouped.current?.plans ?? grouped.here;
    out.push({
      key: 'here',
      label: grouped.current ? `This checkout · ${worktreeLabel(grouped.current.worktree)}` : 'This project',
      icon: 'branch',
      plans: here,
      onDisk: grouped.current?.onDiskOnly ?? [],
    });
    for (const g of grouped.otherWorktrees) {
      out.push({
        key: g.worktree.path,
        label: `${worktreeLabel(g.worktree)}${g.worktree.isMain ? ' · main checkout' : ''}`,
        icon: 'branch',
        path: g.worktree.path,
        branch: g.worktree.branch,
        plans: g.plans,
        onDisk: g.onDiskOnly,
      });
    }
    if (grouped.otherProjects.length > 0) {
      out.push({ key: 'other', label: 'Other projects', icon: 'folder', plans: grouped.otherProjects, onDisk: [] });
    }
    return out;
  }, [grouped]);

  const total = sections.reduce((n, s) => n + s.plans.length, 0);

  const toggle = () => {
    const r = buttonRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, left: Math.max(8, r.left - 200) });
    setQuery('');
    setOpen((o) => !o);
  };

  return (
    <>
      <button
        ref={buttonRef}
        onClick={toggle}
        className={`shrink-0 flex items-center gap-1 px-1.5 py-1 rounded text-[11.5px] transition-colors ${
          open ? 'bg-white/[0.08] text-foreground' : 'text-foreground-subtle hover:text-foreground hover:bg-white/[0.04]'
        }`}
        title="Switch plan, including plans on this repo's other worktrees"
        data-testid="plan-switcher"
      >
        <ChevronDown size={13} />
        <span className="hidden xl:inline">{total > 1 ? `${total} plans` : 'Plans'}</span>
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          className="fixed z-[300] w-[420px] max-h-[70vh] flex flex-col rounded-lg border border-white/[0.1] bg-[#0b0d18] shadow-2xl"
          style={{ top: pos.top, left: pos.left }}
          data-testid="plan-switcher-panel"
        >
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
            <Search size={12} className="text-foreground-subtle" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a plan…"
              className="flex-1 bg-transparent text-[12px] text-foreground placeholder:text-foreground-subtle focus:outline-none"
            />
          </div>
          <div className="overflow-y-auto py-1">
            {sections.map((s) => {
              const plans = s.plans.filter((p) => match(p.title));
              const onDisk = s.onDisk.filter((p) => match(p.title));
              if (plans.length === 0 && onDisk.length === 0 && (q || s.key !== 'here')) return null;
              return (
                <div key={s.key} className="px-1 pb-1">
                  <div className="flex items-center gap-1.5 px-2 pt-2 pb-1 text-[10px] uppercase tracking-wider text-foreground-subtle">
                    {s.icon === 'branch' ? <GitBranch size={10} /> : <FolderOpen size={10} />}
                    <span className="truncate" title={s.path}>{s.label}</span>
                  </div>
                  {plans.length === 0 && onDisk.length === 0 && (
                    <div className="px-2 py-1 text-[11px] text-foreground-subtle">No plans here yet.</div>
                  )}
                  {plans.map((p) => (
                    <button
                      key={p.uid}
                      onClick={() => { setOpen(false); if (p.uid !== activePlanUid) void setActivePlan(p.uid); }}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors ${
                        p.uid === activePlanUid ? 'bg-accent/10 text-accent' : 'text-foreground-muted hover:bg-white/[0.05] hover:text-foreground'
                      }`}
                    >
                      <span className="w-3 shrink-0">{p.uid === activePlanUid && <Check size={12} />}</span>
                      <span className="flex-1 truncate text-[12px]">{p.title}</span>
                      <StatusBadge status={p.status} />
                    </button>
                  ))}
                  {onDisk.map((p) => (
                    <div key={p.uid} className="flex items-center gap-2 px-2 py-1.5 text-foreground-subtle">
                      <span className="w-3 shrink-0" />
                      <span className="flex-1 truncate text-[12px]" title="On this worktree's disk, not imported yet">{p.title}</span>
                      <span className="text-[10px]">on disk</span>
                    </div>
                  ))}
                  {s.path && (plans.length > 0 || onDisk.length > 0) && (
                    <button
                      onClick={() => { setOpen(false); void openWorktreeTab(s.path!, s.branch ?? null); }}
                      className="ml-7 mt-0.5 flex items-center gap-1 text-[10.5px] text-accent hover:underline"
                      title={s.path}
                    >
                      <FolderOpen size={10} /> Open this worktree{onDisk.length > 0 ? ' to import its plans' : ''}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
