/**
 * Phase 32 B7.1 — spec links on the item page.
 *
 * A task shows the spec it relies on: "Relies on: Invoice format › Fields",
 * each a link to the page. A page shows who relies on it: "Relied on by 3
 * tasks in 2 plans", with each task and the section it relies on. When the
 * page changes, those are the tasks affected (B7.2). A heading renamed
 * since the link was made says so rather than disappearing.
 */

import { useEffect, useState } from 'react';
import { BookMarked, Link2 } from 'lucide-react';
import { revealPlanItem } from '../../../lib/open-plan-item';
import type { PlanItem } from '@shared/types';

interface Out { pageUid: string; pageTitle: string; planUid: string; planTitle: string; section: string; sectionTitle: string | null; sectionMissing: boolean }
interface In { itemUid: string; title: string; status: string | null; assignee: string | null; planUid: string; planTitle: string; section: string; sectionTitle: string | null }
interface Links { reliesOn: Out[]; reliedOnBy: In[]; words: string | null }

export function SpecLinksPanel({ item }: { item: PlanItem }) {
  const [links, setLinks] = useState<Links | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/items/${item.uid}/spec-links`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: Links | null) => { if (live) setLinks(body); })
      .catch(() => { if (live) setLinks(null); });
    return () => { live = false; };
  }, [item]);

  if (!links) return null;
  const { reliesOn, reliedOnBy, words } = links;
  if (reliesOn.length === 0 && reliedOnBy.length === 0) return null;

  return (
    <section className="space-y-2 text-[12px]" data-testid="spec-links">
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
