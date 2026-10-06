import { useEffect, useState } from 'react';
import { ATTENTION, chipClass } from '../../lib/visual-language';
import { rulesForFile, type OverlayRuleView } from '../../lib/rule-overlay';
import { useUiStore } from '../../stores/ui-store';
import { useFileFindings } from '../../hooks/useCheckRuns';

const STRENGTH_GLYPH: Record<string, string> = { block: '■', warn: '⚠', guide: '○' };

/**
 * Phase 33 G8 — the rules about the selected file, in the inspector: each
 * rule with its strength and words, the imports that break it starting or
 * ending here, "Show this suite" to fade the graph to what the suite is
 * about, and the way to the Rules view. Absent when no rule is about it.
 *
 * Phase 33 G10 — and what the latest check run found here: each finding with
 * what to do instead, and the way to that run in the Checks view. The same
 * findings are marked on their lines in the code above.
 */
export function FileRules({ root, file }: { root: string; file: string }) {
  const [views, setViews] = useState<OverlayRuleView[] | null>(null);
  const setRuleSuiteFocus = useUiStore((s) => s.setRuleSuiteFocus);
  const setWorkspaceMode = useUiStore((s) => s.setWorkspaceMode);
  const focus = useUiStore((s) => s.ruleSuiteFocus);
  const openCheckRun = useUiStore((s) => s.openCheckRun);
  const found = useFileFindings(root, file);

  useEffect(() => {
    let live = true;
    const load = () => {
      fetch(`/api/rules?project=${encodeURIComponent(root)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((b) => { if (live) setViews(b ? ((b as { rules: OverlayRuleView[] }).rules ?? []) : []); })
        .catch(() => { if (live) setViews([]); });
    };
    load();
    window.addEventListener('rules-changed', load);
    return () => { live = false; window.removeEventListener('rules-changed', load); };
  }, [root]);

  if (!views) return null;
  const about = rulesForFile(views, file);
  const findings = found?.findings ?? [];
  if (about.length === 0 && findings.length === 0) return null;
  return (
    <section className="space-y-1.5" data-testid="file-rules">
      {found && findings.length > 0 && (
        <div className="space-y-1" data-testid="file-findings">
          <h3 className="text-[10px] uppercase tracking-wide text-foreground-subtle">Found here by the latest check</h3>
          <p className="text-[10.5px] text-foreground-muted" data-testid="file-findings-words">{found.who} in {found.ranIn}</p>
          {findings.map((f) => (
            <div key={`${f.rule}>${f.imports}`} className="rounded border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 text-[11px] space-y-0.5" data-testid="file-finding">
              <div className="flex items-baseline gap-1.5">
                <span className={`shrink-0 rounded-full border px-1.5 text-[10px] ${chipClass(ATTENTION.breach.tone)}`}>{ATTENTION.breach.glyph} imports {f.imports}</span>
                <span className="text-foreground-muted min-w-0">{f.failing ? '✗' : '⚠'} {f.rule} ({f.strength})</span>
              </div>
              <div className="text-foreground-muted">{f.words}</div>
              {f.fix && <div className="text-foreground" data-testid="file-finding-fix">→ {f.fix}</div>}
              <button type="button" onClick={() => openCheckRun(found.runId)} className="text-[10.5px] text-sky-300/90 hover:underline" data-testid="file-finding-run">
                Open the check run
              </button>
            </div>
          ))}
        </div>
      )}
      {about.length > 0 && <h3 className="text-[10px] uppercase tracking-wide text-foreground-subtle">Rules about this file</h3>}
      {about.map((v) => (
        <div key={v.rule.id} className="rounded border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 text-[11px] space-y-1" data-testid="file-rule">
          <div className="flex items-baseline gap-1.5">
            <span className="text-foreground-muted shrink-0" title={v.rule.strength}>{STRENGTH_GLYPH[v.rule.strength] ?? ''} {v.rule.strength}</span>
            <span className="text-foreground min-w-0" data-testid="file-rule-words">{v.words}</span>
          </div>
          {v.here.map((b) => (
            <div key={`${b.from}>${b.to}`} className={`inline-flex items-center gap-1 rounded-full border px-1.5 text-[10px] ${chipClass(ATTENTION.breach.tone)}`} data-testid="file-rule-breach">
              {ATTENTION.breach.glyph} {b.from === file ? `imports ${b.to}` : `imported by ${b.from}`}
            </div>
          ))}
          <div className="flex gap-3 text-[10.5px]">
            {v.rule.suite && (
              <button type="button" onClick={() => setRuleSuiteFocus(focus === v.rule.suite ? null : v.rule.suite!)} className="text-sky-300/90 hover:underline" data-testid="file-rule-show-suite">
                {focus === v.rule.suite ? 'Show everything' : `Show the ${v.rule.suite} suite`}
              </button>
            )}
            <button type="button" onClick={() => setWorkspaceMode('rules')} className="text-foreground-muted hover:text-foreground" data-testid="file-rule-open">
              Open in the Rules view
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
