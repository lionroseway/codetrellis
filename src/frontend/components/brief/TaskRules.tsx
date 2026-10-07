import { useEffect, useState } from 'react';
import { useProjectStore } from '../../stores/project-store';
import { useUiStore } from '../../stores/ui-store';
import { absoluteFilePath, openFileAt } from '../../lib/open-file-at';
import { ATTENTION, chipClass } from '../../lib/visual-language';

interface TaskRulesBody {
  files: string[];
  in_scope: Array<{ rule: string; suite: string; strength: string; words: string; because: string }>;
  latest_run: {
    id: string; who: string; ran_in: string; at: string;
    findings: Array<{ rule: string; path: string; imports: string; failing: boolean; words: string; fix: string | null }>;
  } | null;
  says: string;
}

const STRENGTH_GLYPH: Record<string, string> = { block: '■', warn: '⚠', guide: '○' };

/**
 * Phase 33 G10 — a task's rules, in its Brief: the rules that judge the files
 * it changes, and what the latest check run found in them, each finding with
 * what to do instead, its code, and the way to the run. The agent reads the
 * same block in `get_brief`. Nothing when the task names no files.
 */
export function TaskRules({ taskUid }: { taskUid: string }) {
  const root = useProjectStore((s) => s.root);
  const openCheckRun = useUiStore((s) => s.openCheckRun);
  const [body, setBody] = useState<TaskRulesBody | null>(null);

  useEffect(() => {
    let live = true;
    const load = () => {
      fetch(`/api/items/${encodeURIComponent(taskUid)}/rules`)
        .then((r) => (r.ok ? r.json() : null))
        .then((b) => { if (live) setBody(b as TaskRulesBody | null); })
        .catch(() => { if (live) setBody(null); });
    };
    load();
    window.addEventListener('check-runs-changed', load);
    window.addEventListener('rules-changed', load);
    return () => { live = false; window.removeEventListener('check-runs-changed', load); window.removeEventListener('rules-changed', load); };
  }, [taskUid]);

  if (!body || body.files.length === 0) return null;
  const findings = body.latest_run?.findings ?? [];
  return (
    <section className="mt-6" data-testid="brief-rules">
      <h3 className="text-[11px] uppercase tracking-[0.1em] text-foreground-subtle font-semibold mb-2">Rules</h3>
      <p className="text-[12.5px] text-foreground-muted" data-testid="brief-rules-says">{body.says}</p>
      {findings.length > 0 && body.latest_run && (
        <ul className="mt-2 space-y-1.5">
          {findings.map((f) => (
            <li key={`${f.rule}${f.path}${f.imports}`} className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[12.5px] space-y-0.5" data-testid="brief-rule-finding">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className={`rounded-full border px-1.5 text-[11px] ${chipClass(ATTENTION.breach.tone)}`}>{ATTENTION.breach.glyph} {f.path} imports {f.imports}</span>
                <span className="text-foreground-muted">{f.failing ? '✗' : '⚠'} {f.rule}</span>
              </div>
              <div className="text-foreground-muted">{f.words}</div>
              {f.fix && <div className="text-foreground">→ {f.fix}</div>}
              <div className="flex gap-3 text-[11.5px]">
                {root && (
                  <button type="button" className="text-sky-300/90 hover:underline" data-testid="brief-rule-code"
                    onClick={() => { void openFileAt(absoluteFilePath(root, f.path)); }}>
                    Open the code
                  </button>
                )}
                <button type="button" className="text-sky-300/90 hover:underline" data-testid="brief-rule-run"
                  onClick={() => openCheckRun(body.latest_run!.id)}>
                  Open the check run
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {body.in_scope.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[12.5px]" data-testid="brief-rules-in-scope">
          {body.in_scope.map((r) => (
            <li key={r.rule} className="flex items-baseline gap-2" data-testid="brief-rule">
              <span className="text-foreground-subtle shrink-0" title={r.strength}>{STRENGTH_GLYPH[r.strength] ?? ''} {r.strength}</span>
              <span className="text-foreground min-w-0">{r.words}{r.because && <span className="text-foreground-subtle">: {r.because}</span>}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
