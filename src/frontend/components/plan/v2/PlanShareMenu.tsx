import { useEffect, useRef, useState } from 'react';
import { Share2, Layers, GitBranch, ChevronDown } from 'lucide-react';
import { PublishTemplateModal } from '../PublishTemplateModal';
import { ContributorBranchModal } from '../ContributorBranchModal';
import { useProjectStore } from '../../../stores/project-store';
import type { Plan } from '@shared/types';

/**
 * Phase 29 §4.16 — the two ways a plan leaves this machine.
 *
 * Both produce something for somebody else from the same plan:
 *
 *   - **Save as template** writes `.codetrellis/templates/<id>/`, so
 *     the plan's *shape* can be reused (§4.10).
 *   - **Prepare a contributor branch** writes a git branch carrying the
 *     plan's *shared content*, for an external collaborator (§4.16).
 *
 * They are grouped rather than added as two more chips because the plan
 * header had reached nine, and §3 of this register is explicit that the
 * failure mode of this phase is turning a dense interface into a denser
 * one. Two rare actions behind one menu is a chip fewer than before,
 * and it names the thing they have in common.
 *
 * Both need the plan to be on disk: a template is published from the
 * project's own directory, and a contributor branch is built from the
 * plan's manifest. So the menu is gated on `planDir`, and says why
 * rather than offering actions that would fail.
 */
export function PlanShareMenu({ plan }: { plan: Plan }) {
  const root = useProjectStore((s) => s.root);
  const [open, setOpen] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const [showBranch, setShowBranch] = useState(false);
  const [planDir, setPlanDir] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!root) { setPlanDir(null); return; }
    let cancelled = false;
    fetch(`/api/plans/${plan.uid}/file-status?path=${encodeURIComponent(root)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { linked: boolean; planDir: string | null } | null) => {
        if (!cancelled) setPlanDir(d?.linked ? d.planDir : null);
      })
      .catch(() => { /* unknown — the menu says so */ });
    return () => { cancelled = true; };
  }, [plan.uid, root, open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // The slug is the directory name the backend chose. Deriving it from
  // the title here would be a second implementation of that rule.
  const planSlug = planDir
    ? planDir.split(/[\\/]/).filter(Boolean).pop() ?? null
    : null;

  if (!plan.projectPath) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12.5px] transition-colors ${
          open
            ? 'border-accent/30 bg-accent/[0.08] text-accent'
            : 'border-white/[0.08] bg-white/[0.02] text-foreground-subtle hover:text-foreground hover:border-accent/30 hover:bg-white/[0.04]'
        }`}
        title="Reuse this plan's shape, or share its content with a collaborator"
      >
        <Share2 size={11} />
        Share
        <ChevronDown size={10} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-30 w-72 rounded-xl border border-white/[0.08] bg-[#0b1020] shadow-[0_16px_50px_rgba(0,0,0,0.6)] overflow-hidden">
          <button
            onClick={() => { setOpen(false); setShowTemplate(true); }}
            className="w-full flex items-start gap-2.5 px-3.5 py-2.5 text-left hover:bg-white/[0.04] transition-colors"
          >
            <Layers size={13} className="text-accent mt-0.5 shrink-0" />
            <span className="min-w-0">
              <span className="block text-[12.5px] text-foreground">Save as template</span>
              <span className="block text-[10.5px] text-foreground-subtle leading-relaxed mt-0.5">
                Reuse this plan&apos;s shape. Commit it to share with the team.
              </span>
            </span>
          </button>

          <button
            onClick={() => { setOpen(false); setShowBranch(true); }}
            disabled={!planSlug}
            className="w-full flex items-start gap-2.5 px-3.5 py-2.5 text-left hover:bg-white/[0.04] transition-colors border-t border-white/[0.05] disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            <GitBranch size={13} className="text-emerald-400 mt-0.5 shrink-0" />
            <span className="min-w-0">
              <span className="block text-[12.5px] text-foreground">Prepare a contributor branch</span>
              <span className="block text-[10.5px] text-foreground-subtle leading-relaxed mt-0.5">
                {planSlug
                  ? 'A branch with only the shared items, for an external collaborator.'
                  : 'Needs the plan on disk — use the Shared/Local chip first.'}
              </span>
            </span>
          </button>
        </div>
      )}

      {showTemplate && (
        <PublishTemplateModal
          planUid={plan.uid}
          planTitle={plan.title}
          projectRoot={plan.projectPath}
          onClose={() => setShowTemplate(false)}
          onPublished={() => setShowTemplate(false)}
        />
      )}

      {showBranch && planSlug && (
        <ContributorBranchModal
          planSlug={planSlug}
          planTitle={plan.title}
          projectPath={plan.projectPath}
          onClose={() => setShowBranch(false)}
        />
      )}
    </div>
  );
}
