/**
 * Phase 32 B7.1 — spec links on the item page.
 *
 * A task shows the spec it relies on: "Relies on: Invoice format › Fields",
 * each a link to the page. A page shows who relies on it: "Relied on by 3
 * tasks in 2 plans", with each task and the section it relies on. When the
 * page changes, those are the tasks affected (B7.2). A heading renamed
 * since the link was made says so rather than disappearing. A page with an
 * open proposal says so: which section, by whom, why, and who it affects;
 * a person decides it from the inbox (B7.4). Beneath it, what each agent
 * doing relying work said it would mean for them (B7.3). A task whose spec
 * changed by an accepted proposal says so, and whether its agent has been
 * told yet (B7.4).
 */

import { useEffect, useState } from 'react';
import { BookMarked, Link2, PenLine } from 'lucide-react';
import { revealPlanItem } from '../../../lib/open-plan-item';
import type { PlanItem } from '@shared/types';

interface Out { pageUid: string; pageTitle: string; planUid: string; planTitle: string; section: string; sectionTitle: string | null; sectionMissing: boolean }
interface In { itemUid: string; title: string; status: string | null; assignee: string | null; planUid: string; planTitle: string; section: string; sectionTitle: string | null }
interface Changed { proposalUid: string; pageUid: string; pageTitle: string; section: string; sectionTitle: string | null; at: number; toldAt: number | null }
interface Links { reliesOn: Out[]; reliedOnBy: In[]; words: string | null; specChanged?: Changed[] }
interface Impact { id: number; impact: 'none' | 'changes'; words: string; tasks: number | null; itemTitle: string | null; planTitle: string | null; author: string }
interface Proposal { uid: string; section: string; sectionTitle: string | null; why: string; author: string; affectedWords: string | null; pageChangedSince: boolean; impacts: Impact[] }

export function SpecLinksPanel({ item }: { item: PlanItem }) {
  const [links, setLinks] = useState<Links | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);

  useEffect(() => {
    let live = true;
    // Read again when a proposal is made, decided, or its news reaches an
    // agent: "its agent has been told" shows as it happens, not on reopening.
    const loadLinks = () => fetch(`/api/items/${item.uid}/spec-links`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: Links | null) => { if (live) setLinks(body); })
      .catch(() => { if (live) setLinks(null); });
    const loadProposals = () => (item.kind !== 'object' ? Promise.resolve() : fetch(`/api/spec-proposals?page=${encodeURIComponent(item.uid)}&status=open`)
      .then((r) => (r.ok ? r.json() : { proposals: [] }))
      .then((body: { proposals: Proposal[] }) => { if (live) setProposals(body.proposals ?? []); })
      .catch(() => { /* the links still show */ }));
    const load = () => { void loadLinks(); void loadProposals(); };
    if (item.kind !== 'object') setProposals([]);
    load();
    window.addEventListener('spec-proposals-changed', load);
    return () => { live = false; window.removeEventListener('spec-proposals-changed', load); };
  }, [item]);

  if (!links) return null;
  const { reliesOn, reliedOnBy, words } = links;
  const changed = links.specChanged ?? [];
  if (reliesOn.length === 0 && reliedOnBy.length === 0 && proposals.length === 0 && changed.length === 0) return null;

  return (
    <section className="space-y-2 text-[12px]" data-testid="spec-links">
      {proposals.map((p) => (
        <div key={p.uid} className="rounded border border-violet-400/30 bg-violet-400/[0.05] px-2.5 py-1.5 space-y-0.5" data-testid="spec-proposal">
          <div className="flex items-center gap-1.5 text-violet-200">
            <PenLine size={12} />
            <span className="font-medium">Spec change proposed</span>
            <span className="text-foreground-muted">
              {p.section ? `to § ${p.sectionTitle ?? p.section}` : 'to the whole page'} by {p.author}
            </span>
          </div>
          <div className="text-foreground">Why: {p.why}</div>
          <div className="text-foreground-subtle">
            {p.affectedWords ?? 'Nothing relies on this page yet'}. A person decides, in Awareness; the page is unchanged until then.
            {p.pageChangedSince && <span className="text-amber-300"> The page has changed since this was proposed.</span>}
          </div>
          {p.impacts.length > 0 && (
            <ul className="pt-0.5 space-y-0.5" data-testid="spec-proposal-impacts">
              {p.impacts.map((i) => (
                <li key={i.id} className="flex flex-wrap gap-x-1.5" data-testid="spec-proposal-impact">
                  <span className={`shrink-0 whitespace-nowrap ${i.impact === 'changes' ? 'text-amber-300' : 'text-emerald-300'}`}>
                    {i.impact === 'changes' ? `Changes${i.tasks !== null ? ` ${i.tasks} ${i.tasks === 1 ? 'task' : 'tasks'}` : ''}` : 'No impact'}
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-foreground-muted">
                    {i.itemTitle ? `${i.itemTitle}${i.planTitle ? ` (${i.planTitle})` : ''}` : i.author}
                    {i.itemTitle ? ` · ${i.author}` : ''}
                  </span>
                  {i.words && <span className="text-foreground">— {i.words}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {changed.map((c) => (
        <div key={c.proposalUid} className="flex flex-wrap items-center gap-1.5 rounded border border-violet-400/30 bg-violet-400/[0.05] px-2.5 py-1" data-testid="spec-changed">
          <PenLine size={12} className="text-violet-200" />
          <span className="font-medium text-violet-200">Spec changed</span>
          <button onClick={() => { const r = reliesOn.find((x) => x.pageUid === c.pageUid); if (r) void revealPlanItem(r.planUid, c.pageUid); }} className="text-foreground hover:underline">
            {c.section ? `§ ${c.sectionTitle ?? c.section} of ` : ''}{c.pageTitle}
          </button>
          <span className="text-foreground-subtle">at {new Date(c.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <span className="text-foreground-muted">· {c.toldAt ? 'its agent has been told' : 'its agent is told on its next step'}</span>
        </div>
      ))}
      {reliesOn.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="spec-relies-on">
          <span className="flex items-center gap-1 text-foreground-muted"><BookMarked size={12} /> Relies on:</span>
          {reliesOn.map((r) => (
            <button
              key={`${r.pageUid}:${r.section}`}
              data-testid="spec-relies-on-link"
              onClick={() => { void revealPlanItem(r.planUid, r.pageUid); }}
              className="px-1.5 py-0.5 rounded border border-border-subtle hover:border-accent/40 hover:text-foreground text-foreground-muted"
              title={r.sectionMissing
                ? `"${r.section}" is no longer a heading on ${r.pageTitle}. Open the page to pick the section again.`
                : `Open ${r.pageTitle}${r.planTitle && r.planUid !== item.planUid ? ` in plan ${r.planTitle}` : ''}`}
            >
              {r.pageTitle}
              {r.section && (
                <span className={r.sectionMissing ? 'text-amber-300' : ''}>
                  {' › '}{r.sectionMissing ? `${r.section} (heading no longer on the page)` : r.sectionTitle}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {reliedOnBy.length > 0 && (
        <div className="space-y-1" data-testid="spec-relied-on-by">
          <div className="flex items-center gap-1 text-foreground-muted"><Link2 size={12} /> <span data-testid="spec-relied-on-words">{words}</span></div>
          <ul className="pl-4 space-y-0.5">
            {reliedOnBy.map((r) => (
              <li key={`${r.itemUid}:${r.section}`} className="flex items-center gap-1.5">
                <button
                  data-testid="spec-relied-on-task"
                  onClick={() => { void revealPlanItem(r.planUid, r.itemUid); }}
                  className="text-foreground hover:underline text-left"
                >
                  {r.title}
                </button>
                <span className="text-foreground-subtle">in {r.planTitle}</span>
                <span className="text-foreground-subtle">· {r.section ? `§ ${r.sectionTitle ?? `${r.section} (heading no longer on the page)`}` : 'the whole page'}</span>
                {r.assignee && <span className="px-1 rounded bg-white/[0.05] text-foreground-muted">{r.assignee}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
