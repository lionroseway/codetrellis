import { useCallback, useEffect, useMemo, useState } from 'react';
import { GitMerge, ChevronDown, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { useProjectStore } from '../../../stores/project-store';
import { useToastStore } from '../../../stores/toast-store';

/**
 * Phase 29 §4.9 — merge conflicts in `.codetrellis/`.
 *
 * `plan-conflict-service` (Phase 6.4) detects conflicts in the plan
 * manifests, parses both sides into typed fields where it can, and
 * offers two ways out: take one side wholesale, or pick per field.
 * Detection *and* resolution existed behind `/api/conflicts` and
 * `/api/conflicts/resolve`, and nothing in either client called them.
 *
 * Shaped after `FreezeBar`, and for the same reason: this is
 * project-level state that is absent almost always and blocking when
 * present. So it renders nothing at all unless `hasConflicts` — no
 * placeholder, no "0 conflicts" chip. When it does render it is red
 * rather than amber, because unlike a freeze this is not a policy the
 * user chose; their plan files are mid-merge and the app cannot read
 * them properly until it is settled.
 *
 * The field list is deliberately read-only-looking until you act. The
 * service can only parse fields for YAML and JSON, and only when both
 * sides parse — `fields: null` means "too tangled to describe", which
 * the UI says in words rather than showing an empty list that reads
 * like "no differences".
 */

type ConflictFieldType = 'structured' | 'freetext';

interface ConflictField {
  field: string;
  type: ConflictFieldType;
  ours: unknown;
  theirs: unknown;
  autoResolvable: boolean;
}

interface FileConflict {
  filePath: string;
  planSlug: string | null;
  entityType: 'plan' | 'item' | 'channel-event' | 'config' | 'unknown';
  fields: ConflictField[] | null;
  rawContent: string;
  resolved: boolean;
}

interface ConflictSummary {
  hasConflicts: boolean;
  files: FileConflict[];
  totalConflicts: number;
  autoResolvable: number;
}

const ENTITY_LABEL: Record<FileConflict['entityType'], string> = {
  plan: 'Plan',
  item: 'Item',
  'channel-event': 'Channel event',
  config: 'Project config',
  unknown: 'File',
};

/**
 * Render a parsed side for display. The service hands back whatever
 * YAML/JSON produced, so this has to cope with objects and arrays, not
 * just strings — and an absent key is meaningfully different from an
 * empty one, so it says so rather than rendering blank.
 */
export function describeSide(value: unknown): string {
  if (value === undefined) return '(not set)';
  if (value === null) return '(null)';
  if (typeof value === 'string') return value.length === 0 ? '(empty)' : value;
  if (Array.isArray(value)) return value.length === 0 ? '(empty list)' : JSON.stringify(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** "3 files, 2 fields can be resolved automatically" — never "0 fields". */
export function summarise(summary: ConflictSummary): string {
  const files = `${summary.totalConflicts} file${summary.totalConflicts === 1 ? '' : 's'}`;
  if (summary.autoResolvable === 0) return files;
  return `${files} · ${summary.autoResolvable} field${summary.autoResolvable === 1 ? '' : 's'} can be taken field by field`;
}

export function ManifestConflictBar() {
  const projectPath = useProjectStore((s) => s.root);
  const addToast = useToastStore((s) => s.addToast);

  const [summary, setSummary] = useState<ConflictSummary | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** Per-file, per-field side choice for the field-level path. */
  const [picks, setPicks] = useState<Record<string, Record<string, 'ours' | 'theirs'>>>({});

  const load = useCallback(async () => {
    if (!projectPath) { setSummary(null); return; }
    try {
      const res = await fetch(`/api/conflicts?project=${encodeURIComponent(projectPath)}`);
      if (!res.ok) return;
      setSummary(await res.json());
    } catch { /* a conflict check that fails is not worth a toast */ }
  }, [projectPath]);

  useEffect(() => {
    load();
    // A merge happens outside the app, so there is no event to listen
    // for. Poll — slowly, because the answer is "no" nearly always.
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load]);

  const resolve = useCallback(async (
    file: FileConflict,
    body: Record<string, unknown>,
    label: string,
  ) => {
    if (!projectPath) return;
    setBusy(file.filePath);
    try {
      const res = await fetch('/api/conflicts/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath, filePath: file.filePath, ...body }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.resolved) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      addToast({
        type: 'success',
        title: 'Conflict resolved',
        message: `${file.filePath} — ${label}. Staged for commit.`,
      });
      setOpenFile(null);
      await load();
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Could not resolve',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  }, [projectPath, addToast, load]);

  const conflicted = useMemo(
    () => (summary?.files ?? []).filter((f) => !f.resolved),
    [summary],
  );

  // Silent unless there is something to say.
  if (!summary?.hasConflicts || conflicted.length === 0) return null;

  return (
    <div className="border-y border-red-500/20 bg-red-500/[0.06] shrink-0">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-red-500/[0.04] transition-colors"
      >
        {expanded
          ? <ChevronDown size={12} className="text-red-300 shrink-0" />
          : <ChevronRight size={12} className="text-red-300 shrink-0" />}
        <GitMerge size={13} className="text-red-300 shrink-0" />
        <span className="text-[12.5px] text-red-200 font-medium">
          Plan files are mid-merge
        </span>
        <span className="text-[11px] text-red-300/70">
          {summarise(summary)}
        </span>
        <span className="flex-1" />
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); load(); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); load(); } }}
          className="p-1 rounded text-red-300/60 hover:text-red-200 hover:bg-red-500/10"
          title="Re-check"
        >
          <RefreshCw size={11} />
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          <p className="text-[11px] text-red-200/70 leading-relaxed">
            Files under <code className="font-mono">.codetrellis/</code> have conflict markers from a
            merge. Resolving here writes the chosen content and stages the file —
            it does not commit, and it does not touch the rest of the merge.
          </p>

          {conflicted.map((file) => {
            const isOpen = openFile === file.filePath;
            const isBusy = busy === file.filePath;
            const filePicks = picks[file.filePath] ?? {};
            return (
              <div
                key={file.filePath}
                className="rounded-lg border border-red-500/15 bg-black/20 overflow-hidden"
              >
                <button
                  onClick={() => setOpenFile(isOpen ? null : file.filePath)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.02] transition-colors"
                >
                  {isOpen
                    ? <ChevronDown size={11} className="text-foreground-subtle shrink-0" />
                    : <ChevronRight size={11} className="text-foreground-subtle shrink-0" />}
                  <span className="text-[10px] uppercase tracking-wider text-foreground-subtle shrink-0">
                    {ENTITY_LABEL[file.entityType]}
                  </span>
                  <span className="text-[11.5px] font-mono text-foreground truncate">
                    {file.filePath}
                  </span>
                  {file.planSlug && (
                    <span className="text-[10px] text-foreground-subtle shrink-0">
                      {file.planSlug}
                    </span>
                  )}
                </button>

                {isOpen && (
                  <div className="px-3 pb-3 space-y-3 border-t border-white/[0.05] pt-2.5">
                    {file.fields === null ? (
                      <p className="text-[11px] text-foreground-muted leading-relaxed">
                        This file could not be broken into fields — it is not YAML or JSON, or one
                        of the two sides does not parse. Take a whole side below, or resolve it in
                        your editor and re-check.
                      </p>
                    ) : file.fields.length === 0 ? (
                      <p className="text-[11px] text-foreground-muted leading-relaxed">
                        Both sides parse but no field differs at the top level — the conflict
                        markers are probably inside a nested value. Take a whole side below, or
                        resolve it in your editor.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {file.fields.map((f) => {
                          const pick = filePicks[f.field] ?? 'ours';
                          return (
                            <div key={f.field} className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] font-mono text-foreground">{f.field}</span>
                                {f.type === 'freetext' && (
                                  <span className="text-[9.5px] uppercase tracking-wider text-amber-300/70">
                                    free text
                                  </span>
                                )}
                              </div>
                              <div className="grid grid-cols-2 gap-1.5">
                                {(['ours', 'theirs'] as const).map((side) => (
                                  <button
                                    key={side}
                                    onClick={() => setPicks((p) => ({
                                      ...p,
                                      [file.filePath]: { ...filePicks, [f.field]: side },
                                    }))}
                                    className={`text-left px-2.5 py-1.5 rounded-md border transition-colors ${
                                      pick === side
                                        ? 'border-accent/40 bg-accent/[0.08]'
                                        : 'border-white/[0.06] bg-white/[0.015] hover:bg-white/[0.04]'
                                    }`}
                                  >
                                    <div className="text-[9.5px] uppercase tracking-wider text-foreground-subtle">
                                      {side === 'ours' ? 'Yours' : 'Theirs'}
                                    </div>
                                    <div className="text-[11px] text-foreground-muted font-mono break-all line-clamp-3">
                                      {describeSide(side === 'ours' ? f.ours : f.theirs)}
                                    </div>
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })}

                        <button
                          onClick={() => resolve(
                            file,
                            {
                              mode: 'fields',
                              resolutions: file.fields!.map((f) => ({
                                field: f.field,
                                pick: filePicks[f.field] ?? 'ours',
                              })),
                            },
                            'field by field',
                          )}
                          disabled={isBusy}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-[11.5px] rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
                        >
                          {isBusy && <Loader2 size={11} className="animate-spin" />}
                          Apply these choices
                        </button>
                      </div>
                    )}

                    <div className="flex items-center gap-2 pt-1 border-t border-white/[0.05]">
                      <span className="text-[10px] text-foreground-subtle">Or take one side:</span>
                      {(['ours', 'theirs'] as const).map((side) => (
                        <button
                          key={side}
                          onClick={() => resolve(
                            file,
                            { mode: 'by_side', side },
                            side === 'ours' ? 'kept your side' : 'took their side',
                          )}
                          disabled={isBusy}
                          className="px-2.5 py-1 text-[11px] rounded-md border border-white/[0.08] text-foreground-muted hover:text-foreground hover:bg-white/[0.04] disabled:opacity-50 transition-colors"
                        >
                          {side === 'ours' ? 'Keep yours' : 'Take theirs'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
