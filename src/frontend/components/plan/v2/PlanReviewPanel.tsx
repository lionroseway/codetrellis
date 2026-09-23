import { useCallback, useEffect, useState } from 'react';
import {
  ClipboardCheck, RefreshCw, ChevronRight, CheckCircle2, CircleDashed,
  CircleSlash, AlertTriangle, Check, GitPullRequest, Loader2,
} from 'lucide-react';
import { useProjectStore } from '../../../stores/project-store';
import { openFileAt, absoluteFilePath } from '../../../lib/open-file-at';

/**
 * Reviewing a plan against what actually landed — Phase 29 (surfacing
 * Phase 25).
 *
 * See [docs/PHASE-29-SURFACING-WHAT-WE-COLLECT.md](../../../../../docs/PHASE-29-SURFACING-WHAT-WE-COLLECT.md).
 *
 * Phase 25 built four endpoints — `/api/comparands`, `/api/compare`,
 * `/api/plans/:uid/review` and `/api/plans/:uid/pr-draft` — and shipped
 * every one of them reachable only over REST and MCP. The whole review
 * surface was invisible to the application.
 *
 * ## How this differs from `PlanDiffPanel`, which sits above it
 *
 * They answer different questions and both are worth having:
 *
 *   - `PlanDiffPanel` (Phase 15) reads the plan's own declared intent —
 *     the file and symbol specs Actions carry — and reports drift
 *     against them. It asks *"is the code doing what the plan said?"*
 *   - This panel compares two **points in time** and asks *"between
 *     these two, what changed, and which of it did any item claim?"*
 *
 * The second question is the one that finds work nobody planned, which
 * is why `unclaimedChanges` is the headline finding rather than a
 * footnote.
 *
 * ## The comparison needs two ends, and the default is not "baseline"
 *
 * `scanProject` re-pins the baseline on every run, so baseline→live is
 * empty immediately after a scan — which looks like "nothing changed"
 * at exactly the moment a user opens this. The default `before` is
 * therefore `commit:HEAD`, which is stable across scans.
 *
 * ## The PR draft is read-only, and says so
 *
 * `buildPrDraft` never touches the repository: the agent does the git
 * and opens the PR with its own credentials, and CodeTrellis supplies
 * the body it cannot write. So this offers **copy**, not "open a PR" —
 * an affordance for something this process cannot do would be the same
 * over-claim as a sync button on the ticket chip.
 */

interface Comparand { spec: string; label: string; kind: string }

interface ReviewedItem {
  uid: string;
  title: string;
  status: string | null;
  landed: string[];
  missing: string[];
  verdict: 'landed' | 'partial' | 'untouched' | 'no-targets';
  /** Phase 31 — where its acceptance criteria stand. */
  criteria?: { total: number; met: number; waiting: number; sentBack: number };
}

interface PlanReview {
  planUid: string;
  items: ReviewedItem[];
  unclaimedChanges: string[];
  unplannedEdges: Array<{ source: string; target: string }>;
  unremovedEdges: Array<{ source: string; target: string }>;
  summary: {
    itemsLanded: number;
    itemsPartial: number;
    itemsUntouched: number;
    filesChanged: number;
    unclaimedCount: number;
    unplannedEdgeCount: number;
  };
}

interface PrDraft {
  title: string;
  body: string;
  head: string | null;
  base: string | null;
  tickets: string[];
  warnings: string[];
}

const VERDICT: Record<ReviewedItem['verdict'], { Icon: typeof CheckCircle2; tint: string; label: string }> = {
  landed: { Icon: CheckCircle2, tint: 'text-green-400', label: 'landed' },
  partial: { Icon: CircleDashed, tint: 'text-amber-300', label: 'partly landed' },
  untouched: { Icon: CircleSlash, tint: 'text-foreground-subtle', label: 'untouched' },
  // Not a failure: an item that declared no file targets cannot be
  // checked against a diff, and saying "untouched" would be a claim we
  // have not earned.
  'no-targets': { Icon: CircleDashed, tint: 'text-foreground-subtle/60', label: 'no targets declared' },
};

export function PlanReviewPanel({ planUid }: { planUid: string }) {
  const projectRoot = useProjectStore((s) => s.root);
  // Open by default. Closed-by-default is right for a panel you consult;
  // this one IS the third step of plan → execute → check, and shutting it
  // made the product's own answer something you had to go looking for.
  // It still collapses, and the choice sticks for the session.
  const [open, setOpen] = useState(true);
  const [comparands, setComparands] = useState<Comparand[]>([]);
  const [before, setBefore] = useState('commit:HEAD');
  const [after, setAfter] = useState('live');
  const [review, setReview] = useState<PlanReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<PrDraft | null>(null);
  const [copied, setCopied] = useState(false);

  const loadComparands = useCallback(async () => {
    if (!projectRoot) return;
    try {
      const res = await fetch(`/api/comparands?project=${encodeURIComponent(projectRoot)}`);
      if (!res.ok) return;
      setComparands((await res.json()) as Comparand[]);
    } catch { /* leave the selects on their defaults */ }
  }, [projectRoot]);

  const runReview = useCallback(async () => {
    if (!projectRoot) return;
    setLoading(true);
    setError(null);
    setDraft(null);
    try {
      const q = `project=${encodeURIComponent(projectRoot)}&before=${encodeURIComponent(before)}&after=${encodeURIComponent(after)}`;
      const res = await fetch(`/api/plans/${encodeURIComponent(planUid)}/review?${q}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.reason || body.error || 'That comparison could not be made.');
        setReview(null);
        return;
      }
      setReview((await res.json()) as PlanReview);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectRoot, planUid, before, after]);

  useEffect(() => { if (open) void loadComparands(); }, [open, loadComparands]);
  useEffect(() => { if (open && projectRoot) void runReview(); }, [open, projectRoot, runReview]);

  const copyDraft = async () => {
    if (!projectRoot) return;
    const q = `project=${encodeURIComponent(projectRoot)}&before=${encodeURIComponent(before)}&after=${encodeURIComponent(after)}`;
    const res = await fetch(`/api/plans/${encodeURIComponent(planUid)}/pr-draft?${q}`);
    if (!res.ok) return;
    const d = (await res.json()) as PrDraft;
    setDraft(d);
    try {
      await navigator.clipboard.writeText(`${d.title}\n\n${d.body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* the draft is still shown below for manual copying */ }
  };

  if (!projectRoot) return null;

  return (
    <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 hover:bg-white/[0.02] transition-colors text-left"
      >
        <ChevronRight
          size={13}
          className={`text-foreground-subtle transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <ClipboardCheck size={13} className="text-foreground-subtle" />
        <span className="text-[12.5px] text-foreground font-medium">Review against what landed</span>
        {review && (
          <span className="ml-auto text-[10.5px] text-foreground-subtle tabular-nums">
            {review.summary.itemsLanded}/{review.items.length} landed
            {review.summary.unclaimedCount > 0 && (
              <span className="text-amber-300 ml-2">
                {review.summary.unclaimedCount} unclaimed
              </span>
            )}
          </span>
        )}
      </button>

      {open && (
        <div className="px-3.5 pb-3.5 space-y-3">
          {/* Comparand picker. Two ends, both editable — the point of the
              surface is choosing them. */}
          <div className="flex items-center gap-2 text-[11px]">
            <ComparandSelect value={before} onChange={setBefore} options={comparands} label="From" />
            <span className="text-foreground-subtle shrink-0">→</span>
            <ComparandSelect value={after} onChange={setAfter} options={comparands} label="To" />
            <button
              onClick={() => void runReview()}
              disabled={loading}
              className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.08] text-foreground-muted hover:text-foreground transition-colors disabled:opacity-50"
              title="Re-run the review"
            >
              {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            </button>
          </div>

          {error && (
            <p className="text-[11px] text-amber-300/90 leading-snug">{error}</p>
          )}

          {review && !error && (
            <>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-foreground-subtle tabular-nums">
                <span>{review.summary.filesChanged} files changed</span>
                <span>{review.summary.itemsLanded} landed</span>
                <span>{review.summary.itemsPartial} partial</span>
                <span>{review.summary.itemsUntouched} untouched</span>
              </div>

              {review.items.length > 0 && (
                <ul className="space-y-0.5">
                  {review.items.map((item) => (
                    <ReviewedItemRow key={item.uid} item={item} root={projectRoot} />
                  ))}
                </ul>
              )}

              {/* The finding. Files that changed and no item claimed —
                  the question this panel exists to ask. */}
              {review.unclaimedChanges.length > 0 && (
                <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.05] p-2.5">
                  <div className="flex items-center gap-1.5 text-[11.5px] text-amber-200 mb-1">
                    <AlertTriangle size={11} />
                    {review.unclaimedChanges.length} file
                    {review.unclaimedChanges.length === 1 ? '' : 's'} no item claimed
                  </div>
                  <p className="text-[10.5px] text-foreground-subtle/80 leading-snug mb-1.5">
                    Changed between these two points, and not covered by any item's
                    declared targets. That can be incidental — or work nobody planned.
                  </p>
                  <ul className="space-y-0.5 max-h-40 overflow-y-auto">
                    {review.unclaimedChanges.map((f) => (
                      <li key={f}>
                        <FileLink path={f} root={projectRoot} tone="text-amber-200/90" />
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {review.unplannedEdges.length > 0 && (
                <div className="text-[11px]">
                  <div className="text-foreground-subtle mb-1">
                    {review.unplannedEdges.length} dependency
                    {review.unplannedEdges.length === 1 ? '' : 'ies'} appeared that no item planned
                  </div>
                  <ul className="space-y-0.5 max-h-32 overflow-y-auto">
                    {review.unplannedEdges.map((e) => (
                      <li key={`${e.source}->${e.target}`} className="font-mono text-[10px] text-foreground-subtle/80 truncate">
                        {e.source.split('/').pop()} → {e.target.split('/').pop()}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="pt-1 border-t border-white/[0.06]">
                <button
                  onClick={() => void copyDraft()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.08] text-foreground-muted hover:text-foreground transition-colors"
                >
                  {copied ? <Check size={11} className="text-success" /> : <GitPullRequest size={11} />}
                  {copied ? 'Copied' : 'Copy PR description'}
                </button>

                {draft && (
                  <div className="mt-2 space-y-1">
                    {draft.warnings.length > 0 && (
                      <ul className="text-[10.5px] text-amber-300/90 leading-snug">
                        {draft.warnings.map((w) => <li key={w}>· {w}</li>)}
                      </ul>
                    )}
                    <pre className="text-[10px] font-mono text-foreground-subtle bg-black/25 border border-white/[0.06] rounded p-2 max-h-40 overflow-auto whitespace-pre-wrap">
                      {draft.title}{'\n\n'}{draft.body}
                    </pre>
                    {/* CodeTrellis does not open pull requests — the agent
                        holds the credentials and does the git. */}
                    <p className="text-[10px] text-foreground-subtle/60 leading-snug">
                      Nothing was pushed. Hand this to your agent, or paste it
                      into the PR yourself.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function ComparandSelect({
  value, onChange, options, label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Comparand[];
  label: string;
}) {
  return (
    <label className="flex items-center gap-1.5 min-w-0 flex-1">
      <span className="text-foreground-subtle shrink-0">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 bg-black/25 border border-white/[0.08] rounded px-1.5 py-1 text-[11px] text-foreground focus:outline-none focus:border-accent/40"
      >
        {/* The current value always has an option, even before the list
            loads or if it names a commit no longer in the last twenty. */}
        {!options.some((o) => o.spec === value) && <option value={value}>{value}</option>}
        {options.map((o) => (
          <option key={o.spec} value={o.spec}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}


/**
 * A file you can actually open.
 *
 * Every path this panel prints used to be dead text: it would tell you a
 * file changed and no item claimed it — the finding this panel exists to
 * produce — and leave you to find that file yourself.
 */
function FileLink({ path, root, tone }: { path: string; root: string | null; tone?: string }) {
  return (
    <button
      onClick={() => { void openFileAt(absoluteFilePath(root, path)); }}
      title={`Read ${path}`}
      className={`block w-full text-left font-mono text-[10px] truncate hover:underline transition-colors ${tone ?? 'text-foreground-subtle hover:text-foreground'}`}
    >
      {path}
    </button>
  );
}

/**
 * One item's verdict, and the files behind it.
 *
 * The verdict alone is where this panel stopped. "Two untouched" is a
 * fact you cannot act on: untouched *which* files, and are they the ones
 * you thought? The service has always returned `landed` and `missing`
 * per item — the renderer simply dropped them — so this needed no new
 * endpoint, only somewhere to put them.
 *
 * Collapsed by default: the summary is what most readers want, and a
 * panel that dumps every path for every item is the reason people stop
 * reading panels.
 */
function ReviewedItemRow({ item, root }: { item: ReviewedItem; root: string | null }) {
  const [open, setOpen] = useState(false);
  const v = VERDICT[item.verdict];
  const fileCount = item.landed.length + item.missing.length;

  return (
    <li className="rounded-md hover:bg-white/[0.025] transition-colors">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={fileCount === 0}
        className="w-full flex items-baseline gap-2 text-[11.5px] px-1.5 py-1 text-left disabled:cursor-default"
      >
        <v.Icon size={11} className={`${v.tint} shrink-0 translate-y-0.5`} />
        <span className="text-foreground-muted truncate flex-1">{item.title}</span>
        {fileCount > 0 && (
          <span className="text-foreground-subtle/70 shrink-0 text-[10px] tabular-nums">
            {fileCount} file{fileCount === 1 ? '' : 's'}
          </span>
        )}
        {item.criteria && item.criteria.total > 0 && (
          <span
            data-testid="review-criteria"
            className="text-foreground-subtle/70 shrink-0 text-[10px] tabular-nums"
            title={[
              `${item.criteria.met} of ${item.criteria.total} acceptance criteria met`,
              item.criteria.waiting ? `${item.criteria.waiting} waiting for you` : '',
              item.criteria.sentBack ? `${item.criteria.sentBack} sent back` : '',
            ].filter(Boolean).join(' · ')}
          >
            {item.criteria.met === item.criteria.total ? '✓' : item.criteria.waiting ? '◐' : '○'} {item.criteria.met}/{item.criteria.total} met
          </span>
        )}
        <span className={`${v.tint} shrink-0 text-[10.5px]`}>{v.label}</span>
      </button>

      {open && fileCount > 0 && (
        <div className="pl-6 pr-2 pb-1.5 space-y-1.5">
          {item.landed.length > 0 && (
            <div>
              <div className="text-[9.5px] uppercase tracking-[0.1em] text-emerald-300/70 mb-0.5">
                Landed
              </div>
              {item.landed.map((f) => (
                <FileLink key={f} path={f} root={root} tone="text-emerald-200/80 hover:text-emerald-100" />
              ))}
            </div>
          )}
          {item.missing.length > 0 && (
            <div>
              <div className="text-[9.5px] uppercase tracking-[0.1em] text-foreground-subtle mb-0.5">
                Still outstanding
              </div>
              {item.missing.map((f) => (
                <FileLink key={f} path={f} root={root} />
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
