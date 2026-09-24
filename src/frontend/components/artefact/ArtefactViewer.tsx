import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, FolderOpen, X, FileQuestion } from 'lucide-react';
import type { ItemCriterion } from '@shared/types';
import { useArtefactViewStore, type ArtefactView } from '../../stores/artefact-view-store';
import { usePlanItemsStore } from '../../stores/plan-items-store';
import { artefactRenditionUrl, artefactSrcUrl } from '../../lib/artefact-src';
import { describeLocator, openArtefactAt } from '../../lib/open-artefact-at';
import DOMPurify from 'dompurify';
import type { XlsxReply } from '../../workers/xlsx-worker';
import type { DocxReply } from '../../workers/docx-worker';
import type { PptxReply } from '../../workers/pptx-worker';

/**
 * Phase 31 §7 — the artefact viewer.
 *
 * Where a person verifies: the evidence an agent offered, open at the place
 * it cites, and — when it is wrong — "send back from here", which records
 * the file and the lines or cells the note is about (§8.2). The agent then
 * reads that place back from its worklist rather than from a conversation.
 *
 * Formats: images (SVG only ever through `<img>` — an inlined SVG is a
 * document that can run script), video with seeking, text with line
 * numbers, CSV and .xlsx as a grid (the workbook read in a capped worker),
 * PDF drawn by pdf.js, Word documents converted in a capped worker and
 * sanitised before they reach the DOM. The sandboxed HTML view arrives
 * later; anything not shown gets a card saying what it is, and Show in
 * Finder. There is no "Open" (§7.4).
 */

interface Meta {
  uid: string;
  itemUid: string;
  path: string | null;
  name: string;
  label: string | null;
  role: string | null;
  sha256: string | null;
  size: number | null;
  recordedBy: string | null;
  recordedByType: string | null;
  contentType: string | null;
  viewable: boolean;
}

type Selection = { lines: string } | { range: string; sheet?: string } | { page: number } | { text: string } | null;

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
const VIDEO = new Set(['mp4', 'webm', 'mov']);
const TEXT = new Set(['md', 'txt', 'log', 'json', 'xml']);
/** Past this, text is not pulled into the page — the card says so. */
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const MAX_CSV_ROWS = 2000;
/** §7.2 caps: bytes in, per format. Parsed output is capped in the worker. */
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_SHEET_BYTES = 25 * 1024 * 1024;
const MAX_DOCX_BYTES = 25 * 1024 * 1024;
const MAX_DECK_BYTES = 100 * 1024 * 1024;
/** A quote picked for a send-back: enough to find it again, small enough to store. */
const MAX_QUOTE_CHARS = 300;
const MAX_PDF_PAGES = 300;
const PARSE_TIMEOUT_MS = 15_000;

const extOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

export function ArtefactViewer() {
  const view = useArtefactViewStore((s) => s.view);
  if (!view) return null;
  // Keyed on what is shown: a new file or place starts clean.
  return <ViewerDialog key={`${view.uid}:${JSON.stringify(view.locator ?? null)}`} view={view} />;
}

function ViewerDialog({ view }: { view: ArtefactView }) {
  const back = useArtefactViewStore((s) => s.back);
  const goBack = useArtefactViewStore((s) => s.goBack);
  const close = useArtefactViewStore((s) => s.close);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/artefacts/${encodeURIComponent(view.uid)}`)
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (!live) return;
        if (!r.ok) setError(data?.error ?? `HTTP ${r.status}`);
        else setMeta(data as Meta);
      })
      .catch((err) => live && setError(String(err)));
    return () => { live = false; };
  }, [view.uid]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close]);

  const name = meta?.path ?? meta?.name ?? '';
  const ext = extOf(name);
  const reveal = (window as unknown as { electronAPI?: { revealArtefact?: (uid: string) => Promise<boolean> } })
    .electronAPI?.revealArtefact;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Artefact viewer"
      data-testid="artefact-viewer"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={close}
    >
      <div
        className="w-[min(1100px,94vw)] h-[88vh] flex flex-col rounded-2xl border border-white/[0.08] bg-surface-solid/95 shadow-[0_0_40px_rgba(0,0,0,0.5)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.06]">
          {back && (
            <button
              onClick={goBack}
              className="inline-flex items-center gap-1 text-[11.5px] text-foreground-subtle hover:text-foreground mr-2"
              title="Back to where you were"
            >
              <ArrowLeft size={12} /> Back to {back.label}
            </button>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-foreground truncate font-mono">{name || '…'}</div>
            {meta && (
              <div className="text-[10.5px] text-foreground-subtle truncate">
                {[
                  meta.role,
                  meta.size !== null ? formatBytes(meta.size) : null,
                  meta.sha256 ? `sha256 ${meta.sha256.slice(0, 12)}` : null,
                  meta.recordedBy ? `recorded by ${meta.recordedBy}${meta.recordedByType === 'mcp' ? ' (agent)' : ''}` : null,
                  describeLocator(view.locator) ? `at ${describeLocator(view.locator)}` : null,
                ].filter(Boolean).join(' · ')}
              </div>
            )}
          </div>
          {reveal && meta?.viewable && (
            <button
              onClick={() => void reveal(view.uid)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-white/[0.08] text-[11.5px] text-foreground-muted hover:text-foreground hover:bg-white/[0.05]"
              title="Show the file in Finder / Explorer. The viewer never opens files with another app."
            >
              <FolderOpen size={12} /> Show in Finder
            </button>
          )}
          <button onClick={close} aria-label="Close viewer" className="p-1 text-foreground-subtle hover:text-foreground">
            <X size={15} />
          </button>
        </header>

        <EvidenceStrip view={view} currentName={name} />

        <div className="flex-1 min-h-0 overflow-auto">
          {error && <Card title="This attachment could not be shown" lines={[error]} />}
          {!error && !meta && <p className="p-6 text-[12px] text-foreground-subtle">Loading…</p>}
          {meta && !meta.viewable && (
            <Card title={meta.name} lines={['This attachment is not a file in an open project, so it cannot be shown here.']} />
          )}
          {meta?.viewable && (
            IMAGE.has(ext) ? <ImageView uid={view.uid} name={name} />
            : VIDEO.has(ext) ? <VideoView uid={view.uid} locator={view.locator} />
            : ext === 'pdf' ? ((meta.size ?? 0) > MAX_PDF_BYTES ? <TooBig meta={meta} /> : (
              <PdfView uid={view.uid} meta={meta} locator={view.locator} selection={selection} onSelect={setSelection} />
            ))
            : ext === 'xlsx' || ext === 'xlsm' ? ((meta.size ?? 0) > MAX_SHEET_BYTES ? <TooBig meta={meta} /> : (
              <XlsxView uid={view.uid} meta={meta} locator={view.locator} selection={selection} onSelect={setSelection} />
            ))
            : ext === 'docx' || ext === 'xls' ? ((meta.size ?? 0) > MAX_DOCX_BYTES ? <TooBig meta={meta} /> : (
              <OfficeView uid={view.uid} meta={meta} ext={ext} locator={view.locator} selection={selection} onSelect={setSelection} />
            ))
            : ext === 'pptx' ? ((meta.size ?? 0) > MAX_DECK_BYTES ? <TooBig meta={meta} /> : (
              <OfficeView uid={view.uid} meta={meta} ext={ext} locator={view.locator} selection={selection} onSelect={setSelection} />
            ))
            : ext === 'csv' ? (tooBig(meta) ? <TooBig meta={meta} /> : (
              <CsvView uid={view.uid} locator={view.locator} selection={selection} onSelect={setSelection} />
            ))
            : TEXT.has(ext) ? (tooBig(meta) ? <TooBig meta={meta} /> : (
              <TextView uid={view.uid} locator={view.locator} selection={selection} onSelect={setSelection} />
            ))
            : ext === 'html' || ext === 'htm' ? (
              <HtmlView uid={view.uid} meta={meta} locator={view.locator} selection={selection} onSelect={setSelection} />
            )
            : <NotYet meta={meta} ext={ext} />
          )}
        </div>

        {view.criterionUid && view.itemUid && (
          <SendBackBar view={view} selection={selection} />
        )}
      </div>
    </div>
  );
}

// ── the criterion's evidence, one click apart ─────────────────────────

function useCriterion(itemUid: string | null | undefined, criterionUid: string | null | undefined): ItemCriterion | null {
  const ctx = usePlanItemsStore((s) => (itemUid ? s.contextByUid[itemUid] : undefined));
  return (criterionUid && ctx?.criteria?.find((c) => c.uid === criterionUid)) || null;
}

/**
 * The other files a criterion's evidence cites. Clicking one opens it at
 * its place and remembers this one as the way back — the claim and the
 * cell it came from, one click apart (§7.5).
 */
function EvidenceStrip({ view, currentName }: { view: ArtefactView; currentName: string }) {
  const criterion = useCriterion(view.itemUid, view.criterionUid);
  const attachments = usePlanItemsStore((s) => (view.itemUid ? s.contextByUid[view.itemUid]?.attachments : undefined));
  const pieces = (criterion?.latestSubmission ?? []).filter((e) => e.attachmentUid);
  if (!criterion || pieces.length < 2) return null;
  return (
    <div className="flex items-center gap-2 px-4 py-1.5 border-b border-white/[0.04] text-[11px] overflow-x-auto">
      <span className="text-foreground-subtle shrink-0">Evidence:</span>
      {pieces.map((e) => {
        const a = attachments?.find((x) => x.uid === e.attachmentUid);
        const label = a?.label || a?.value || e.attachmentUid!.slice(0, 8);
        const here = e.attachmentUid === view.uid;
        return (
          <button
            key={e.uid}
            disabled={here}
            onClick={() => openArtefactAt(e.attachmentUid!, e.locator, {
              criterionUid: view.criterionUid, itemUid: view.itemUid,
              from: { ...view, label: currentName || 'the evidence' },
            })}
            className={`shrink-0 px-2 py-0.5 rounded border font-mono ${here
              ? 'border-accent/40 text-accent'
              : 'border-white/[0.08] text-foreground-muted hover:text-foreground'}`}
          >
            {label}{describeLocator(e.locator) ? ` · ${describeLocator(e.locator)}` : ''}
          </button>
        );
      })}
    </div>
  );
}

function SendBackBar({ view, selection }: { view: ArtefactView; selection: Selection }) {
  const criterion = useCriterion(view.itemUid, view.criterionUid);
  const decideCriterion = usePlanItemsStore((s) => s.decideCriterion);
  const [writing, setWriting] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  // Once sent, the criterion reads sent_back — the bar stays to say so.
  if (!criterion || (!sent && criterion.state !== 'submitted' && criterion.state !== 'met' && criterion.state !== 'stale')) return null;

  const place = selection ? describeLocator(selection) : '';
  const send = async () => {
    const err = await decideCriterion(view.itemUid!, criterion.uid, 'sent_back', note, selection
      ? { attachmentUid: view.uid, locator: selection }
      : undefined);
    setError(err);
    if (!err) { setSent(true); setWriting(false); }
  };

  return (
    <footer data-testid="send-back-bar" className="border-t border-white/[0.06] px-4 py-2.5 text-[11.5px] space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-foreground-muted truncate flex-1">“{criterion.text}”</span>
        {sent ? (
          <span className="text-red-300">↩ Sent back{place ? ` from ${place}` : ''}</span>
        ) : !writing ? (
          <>
            <span className="text-foreground-subtle">
              {place ? `Selected ${place}` : 'Select the lines, cells, page or words that are wrong to point at them'}
            </span>
            <button
              onClick={() => setWriting(true)}
              className="px-2 py-0.5 rounded border border-red-300/30 text-red-300 hover:bg-red-300/10"
            >
              ↩ Send back{place ? ' from here' : ''}
            </button>
          </>
        ) : null}
      </div>
      {writing && !sent && (
        <div className="space-y-1.5">
          <textarea
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={`What isn't right${place ? ` at ${place}` : ''}? The agent reads this next, with the place.`}
            rows={2}
            className="w-full text-[12.5px] bg-white/[0.03] border border-white/[0.08] rounded-md px-2.5 py-1.5 focus:outline-none focus:border-accent/40"
          />
          <div className="flex items-center gap-2">
            <div className="flex-1" />
            <button onClick={() => setWriting(false)} className="text-foreground-subtle hover:text-foreground">Cancel</button>
            <button
              onClick={() => void send()}
              disabled={!note.trim()}
              className="px-2.5 py-1 rounded-md bg-red-400/15 text-red-300 hover:bg-red-400/25 disabled:opacity-40"
            >
              Send back
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-red-300">{error}</p>}
    </footer>
  );
}

// ── formats ───────────────────────────────────────────────────────────

function ImageView({ uid, name }: { uid: string; name: string }) {
  return (
    <div className="h-full flex items-center justify-center p-4 bg-black/20">
      {/* Always <img>, never inlined: an inlined SVG is a document that can run script. */}
      <img src={artefactSrcUrl(uid)} alt={name} className="max-w-full max-h-full object-contain" />
    </div>
  );
}

function VideoView({ uid, locator }: { uid: string; locator: unknown }) {
  const ref = useRef<HTMLVideoElement>(null);
  const t = toSeconds((locator as { t?: unknown } | null)?.t);
  return (
    <div className="h-full flex items-center justify-center p-4 bg-black/40">
      <video
        ref={ref}
        controls
        preload="metadata"
        src={artefactSrcUrl(uid)}
        onLoadedMetadata={() => { if (ref.current && t !== null) ref.current.currentTime = t; }}
        className="max-w-full max-h-full"
      />
    </div>
  );
}

function useText(uid: string): { text: string | null; error: string | null } {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(artefactSrcUrl(uid))
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body = await r.text();
        if (live) setText(body);
      })
      .catch((err) => live && setError(String(err)));
    return () => { live = false; };
  }, [uid]);
  return { text, error };
}

function TextView({ uid, locator, selection, onSelect }: {
  uid: string; locator: unknown; selection: Selection; onSelect: (s: Selection) => void;
}) {
  const { text, error } = useText(uid);
  const lines = useMemo(() => (text ?? '').split(/\r?\n/), [text]);
  const target = lineSpan((locator as { lines?: unknown } | null)?.lines);
  const quote = typeof (locator as { text?: unknown } | null)?.text === 'string'
    ? ((locator as { text: string }).text).toLowerCase() : null;
  const picked = selection && 'lines' in selection ? lineSpan(selection.lines) : null;
  const anchor = useRef<number | null>(null);
  const firstHit = useRef<HTMLDivElement>(null);

  useEffect(() => { firstHit.current?.scrollIntoView({ block: 'center' }); }, [text]);

  if (error) return <Card title="Could not read the file" lines={[error]} />;
  if (text === null) return <p className="p-6 text-[12px] text-foreground-subtle">Loading…</p>;

  const pick = (n: number, extend: boolean) => {
    const from = extend && anchor.current !== null ? anchor.current : n;
    if (!extend) anchor.current = n;
    const [a, b] = from <= n ? [from, n] : [n, from];
    onSelect({ lines: a === b ? String(a) : `${a}-${b}` });
  };

  let scrolled = false;
  return (
    <div data-testid="artefact-text" className="font-mono text-[12px] leading-5 py-2">
      {lines.map((line, i) => {
        const n = i + 1;
        const hit = (target && n >= target.start && n <= target.end) || (!!quote && line.toLowerCase().includes(quote));
        const sel = picked && n >= picked.start && n <= picked.end;
        const ref = hit && !scrolled ? ((scrolled = true), firstHit) : undefined;
        return (
          <div
            key={n}
            ref={ref}
            data-line={n}
            data-cited={hit ? 'true' : undefined}
            className={`flex ${sel ? 'bg-red-400/15' : hit ? 'bg-amber-400/15' : ''}`}
          >
            <button
              onClick={(e) => pick(n, e.shiftKey)}
              className="w-12 shrink-0 pr-3 text-right text-foreground-subtle/70 hover:text-foreground select-none"
              title="Select this line (shift-click for a span) to point at it"
              aria-label={`Line ${n}`}
            >
              {n}
            </button>
            <span className="whitespace-pre-wrap break-all text-foreground-muted pr-4">{line || ' '}</span>
          </div>
        );
      })}
    </div>
  );
}

function CsvView({ uid, locator, selection, onSelect }: {
  uid: string; locator: unknown; selection: Selection; onSelect: (s: Selection) => void;
}) {
  const { text, error } = useText(uid);
  const rows = useMemo(() => (text === null ? [] : parseCsv(text)), [text]);
  if (error) return <Card title="Could not read the file" lines={[error]} />;
  if (text === null) return <p className="p-6 text-[12px] text-foreground-subtle">Loading…</p>;
  return (
    <Grid
      rows={rows.slice(0, MAX_CSV_ROWS)}
      target={parseRange((locator as { range?: unknown } | null)?.range)}
      picked={selection && 'range' in selection ? parseRange(selection.range) : null}
      onPick={(range) => onSelect({ range })}
      footer={rows.length > MAX_CSV_ROWS ? `Showing the first ${MAX_CSV_ROWS} of ${rows.length} rows.` : null}
    />
  );
}

/**
 * An .xlsx / .xlsm, read in a worker with caps (§7.2): values and layout;
 * charts and conditional formatting are not shown, and macros are never
 * run — an .xlsm says so. Past a cap or the time limit: the card.
 */
function XlsxView({ uid, meta, locator, selection, onSelect }: {
  uid: string; meta: Meta; locator: unknown; selection: Selection; onSelect: (s: Selection) => void;
}) {
  const wanted = (locator as { sheet?: unknown } | null)?.sheet;
  const [sheet, setSheet] = useState<string | null>(typeof wanted === 'string' ? wanted : null);

  const book = useWorkerParse<XlsxReply>(
    uid,
    () => new Worker(new URL('../../workers/xlsx-worker.ts', import.meta.url), { type: 'module' }),
    'workbook',
  );

  if (!book) return <p className="p-6 text-[12px] text-foreground-subtle">Reading the workbook…</p>;
  if (!book.ok) return <Card title={meta.path ?? meta.name} lines={[book.reason]} icon />;
  const current = book.sheets.find((s) => s.name === sheet) ?? book.sheets[0];
  if (!current) return <Card title={meta.path ?? meta.name} lines={['This workbook has no sheets.']} icon />;
  const targetSheet = typeof wanted === 'string' ? wanted : book.sheets[0]?.name;
  const pickedSheet = selection && 'range' in selection ? (selection as { sheet?: string }).sheet ?? null : null;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-white/[0.04] text-[11px]" role="tablist" aria-label="Sheets">
        {book.sheets.map((s) => (
          <button
            key={s.name}
            role="tab"
            aria-selected={s.name === current.name}
            onClick={() => setSheet(s.name)}
            className={`px-2 py-0.5 rounded font-mono ${s.name === current.name
              ? 'bg-white/[0.08] text-foreground'
              : 'text-foreground-subtle hover:text-foreground'}`}
          >
            {s.name}
          </button>
        ))}
        <div className="flex-1" />
        {(book.macros || extOf(meta.path ?? meta.name) === 'xlsm') && (
          <span data-testid="macro-badge" className="px-1.5 py-0.5 rounded border border-amber-400/30 text-amber-300">
            contains macros — not run
          </span>
        )}
        <span className="text-foreground-subtle ml-2">values as last saved · charts not shown</span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <Grid
          rows={current.rows}
          target={current.name === targetSheet ? parseRange((locator as { range?: unknown } | null)?.range) : null}
          picked={pickedSheet === current.name && selection && 'range' in selection ? parseRange(selection.range) : null}
          onPick={(range) => onSelect({ sheet: current.name, range } as Selection)}
          footer={current.truncated ? 'This sheet is larger than the viewer shows; the rest is not displayed.' : null}
        />
      </div>
    </div>
  );
}

/** Cells as a grid — always text, never markup. Click or shift-click to pick a range. */
function Grid({ rows, target, picked, onPick, footer }: {
  rows: string[][];
  target: ReturnType<typeof parseRange>;
  picked: ReturnType<typeof parseRange>;
  onPick: (range: string) => void;
  footer: string | null;
}) {
  const anchor = useRef<{ col: number; row: number } | null>(null);
  const firstHit = useRef<HTMLTableCellElement>(null);
  useEffect(() => { firstHit.current?.scrollIntoView({ block: 'center', inline: 'center' }); }, [rows, target]);
  const cols = Math.max(0, ...rows.map((r) => r.length));

  const pick = (col: number, row: number, extend: boolean) => {
    const from = extend && anchor.current ? anchor.current : { col, row };
    if (!extend) anchor.current = { col, row };
    const a = { col: Math.min(from.col, col), row: Math.min(from.row, row) };
    const b = { col: Math.max(from.col, col), row: Math.max(from.row, row) };
    const ref = (c: { col: number; row: number }) => `${colName(c.col)}${c.row}`;
    onPick(a.col === b.col && a.row === b.row ? ref(a) : `${ref(a)}:${ref(b)}`);
  };
  const inside = (r: ReturnType<typeof parseRange>, col: number, row: number) =>
    !!r && col >= r.from.col && col <= r.to.col && row >= r.from.row && row <= r.to.row;

  let scrolled = false;
  return (
    <div className="p-2">
      <table data-testid="artefact-grid" className="border-collapse font-mono text-[11.5px]">
        <thead>
          <tr>
            <th className="sticky top-0 bg-surface-solid px-2 text-foreground-subtle/70" />
            {Array.from({ length: cols }, (_, c) => (
              <th key={c} className="sticky top-0 bg-surface-solid px-2 py-0.5 text-foreground-subtle/70 font-normal">{colName(c + 1)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              <td className="px-2 text-right text-foreground-subtle/70 select-none">{ri + 1}</td>
              {Array.from({ length: cols }, (_, ci) => {
                const col = ci + 1;
                const row = ri + 1;
                const hit = inside(target, col, row);
                const sel = inside(picked, col, row);
                const ref = hit && !scrolled ? ((scrolled = true), firstHit) : undefined;
                return (
                  <td
                    key={ci}
                    ref={ref}
                    data-cell={`${colName(col)}${row}`}
                    data-cited={hit ? 'true' : undefined}
                    onClick={(e) => pick(col, row, e.shiftKey)}
                    className={`border border-white/[0.06] px-2 py-0.5 whitespace-nowrap cursor-cell ${
                      sel ? 'bg-red-400/20' : hit ? 'bg-amber-400/20 text-foreground' : 'text-foreground-muted'}`}
                  >
                    {r[ci] ?? ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {footer && <p className="p-2 text-[11px] text-foreground-subtle">{footer}</p>}
    </div>
  );
}

/**
 * A PDF, drawn by pdf.js (§7.2), lazily loaded so it costs nothing until a
 * PDF is opened. pdf.js 6 has no eval path at all, and the app's CSP
 * (script-src 'self', no unsafe-eval) would refuse one; XFA forms are off. `{page}` scrolls there; `{text}` finds the
 * page that has the quote. Clicking a page picks it to send back from.
 */
function PdfView({ uid, meta, locator, selection, onSelect, data: given }: {
  uid: string; meta: Meta; locator: unknown; selection: Selection; onSelect: (s: Selection) => void;
  /** The PDF's bytes, when they are already here (an Office file's rendition). */
  data?: Uint8Array;
}) {
  const [pages, setPages] = useState<HTMLCanvasElement[] | null>(null);
  const [cited, setCited] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const holder = useRef<HTMLDivElement>(null);
  const loc = (locator ?? {}) as { page?: unknown; text?: unknown };
  const wantPage = typeof loc.page === 'number' ? loc.page : null;
  const wantText = typeof loc.text === 'string' ? loc.text : null;

  useEffect(() => {
    let live = true;
    let destroy: (() => void) | null = null;
    (async () => {
      try {
        // The legacy build: pdf.js 6 calls Map#getOrInsertComputed, which
        // the browser-served build cannot count on, and this one polyfills.
        const [pdfjs, worker] = await Promise.all([
          import('pdfjs-dist/legacy/build/pdf.mjs'),
          import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
        ]);
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        let data: Uint8Array;
        if (given) {
          // pdf.js takes ownership of what it is given; keep the original for a re-render.
          data = given.slice();
        } else {
          const res = await fetch(artefactSrcUrl(uid));
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          data = new Uint8Array(await res.arrayBuffer());
        }
        const task = pdfjs.getDocument({ data, enableXfa: false });
        destroy = () => { void task.destroy(); };
        const doc = await task.promise;
        if (!live) return;
        setTotal(doc.numPages);
        let hit: number | null = wantPage;
        const quote = wantText ? wantText.replace(/\s+/g, ' ').trim().toLowerCase() : null;
        const canvases: HTMLCanvasElement[] = [];
        const count = Math.min(doc.numPages, MAX_PDF_PAGES);
        for (let n = 1; n <= count && live; n++) {
          const page = await doc.getPage(n);
          if (quote && hit === null) {
            const content = await page.getTextContent();
            const text = content.items.map((i) => ('str' in i ? i.str : '')).join(' ').replace(/\s+/g, ' ').toLowerCase();
            if (text.includes(quote)) hit = n;
          }
          const viewport = page.getViewport({ scale: 1.3 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({ canvas, viewport }).promise;
          canvases.push(canvas);
        }
        if (live) { setPages(canvases); setCited(hit); }
      } catch (err) {
        if (live) setError((err as Error).message);
      }
    })();
    return () => { live = false; destroy?.(); };
  }, [uid, wantPage, wantText, given]);

  useEffect(() => {
    if (!pages || cited === null) return;
    holder.current?.querySelector(`[data-page="${cited}"]`)?.scrollIntoView({ block: 'start' });
  }, [pages, cited]);

  if (error) return <Card title={meta.path ?? meta.name} lines={[`This PDF could not be shown (${error}).`]} icon />;
  if (!pages) return <p className="p-6 text-[12px] text-foreground-subtle">Drawing the PDF…</p>;
  const picked = selection && 'page' in selection ? (selection as { page: number }).page : null;

  return (
    <div ref={holder} data-testid="artefact-pdf" className="flex flex-col items-center gap-3 p-4 bg-black/20">
      {pages.map((canvas, i) => {
        const n = i + 1;
        return (
          <div
            key={n}
            data-page={n}
            data-cited={n === cited ? 'true' : undefined}
            onClick={() => onSelect({ page: n } as Selection)}
            className={`relative cursor-pointer ring-2 ${picked === n ? 'ring-red-400/70' : n === cited ? 'ring-amber-400/70' : 'ring-transparent'}`}
            title={`Page ${n} — click to point at it`}
          >
            <CanvasHost canvas={canvas} />
            <span className="absolute top-1 right-2 text-[10px] text-black/60 bg-white/70 px-1 rounded">{n}</span>
          </div>
        );
      })}
      {total > MAX_PDF_PAGES && (
        <p className="text-[11px] text-foreground-subtle">Showing the first {MAX_PDF_PAGES} of {total} pages.</p>
      )}
    </div>
  );
}

/** Mounts a canvas pdf.js already drew. */
function CanvasHost({ canvas }: { canvas: HTMLCanvasElement }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    canvas.style.maxWidth = '100%';
    canvas.style.height = 'auto';
    el.appendChild(canvas);
    return () => { if (canvas.parentNode === el) el.removeChild(canvas); };
  }, [canvas]);
  return <div ref={ref} className="bg-white" />;
}

/**
 * Fetch an attachment's bytes and hand them to a parsing worker, under the
 * time limit. The worker is terminated when it answers, errors, runs out of
 * time, or the view goes away — whichever is first.
 */
function useWorkerParse<R>(uid: string, spawn: () => Worker, noun: string): R | { ok: false; reason: string } | null {
  const [reply, setReply] = useState<R | { ok: false; reason: string } | null>(null);
  const spawnRef = useRef(spawn);
  useEffect(() => {
    let live = true;
    let worker: Worker | null = null;
    setReply(null);
    const fail = (reason: string) => { if (live) setReply({ ok: false, reason }); };
    const timer = setTimeout(() => {
      worker?.terminate();
      fail(`Reading this ${noun} took longer than ${PARSE_TIMEOUT_MS / 1000}s, so it was stopped.`);
    }, PARSE_TIMEOUT_MS);
    fetch(artefactSrcUrl(uid))
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
      .then((buffer) => {
        if (!live) return;
        worker = spawnRef.current();
        worker.onmessage = (e: MessageEvent<R>) => {
          clearTimeout(timer);
          worker?.terminate();
          if (live) setReply(e.data);
        };
        worker.onerror = () => {
          clearTimeout(timer);
          worker?.terminate();
          fail(`The ${noun} could not be read.`);
        };
        worker.postMessage({ buffer }, [buffer]);
      })
      .catch((err) => { clearTimeout(timer); fail(String(err)); });
    return () => { live = false; clearTimeout(timer); worker?.terminate(); };
  }, [uid, noun]);
  return reply;
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** The blocks a quote is looked for in, and marked on. */
const DOCX_BLOCKS = 'p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote';

/**
 * A Word document, read (§7.2): headings, paragraphs, lists, tables and
 * images; not its page layout. mammoth's HTML is sanitised by DOMPurify
 * before it reaches the DOM, with ids prefixed so a document cannot shadow
 * the app's own. Images become blob: URLs made here from bytes the worker
 * read. Links keep their text and show their target, but lead nowhere —
 * following one would navigate the app window — except a footnote's, which
 * scrolls within the document. A cited `{text}` marks the paragraph that
 * holds it; selecting words picks them for a send-back.
 */
function DocxView({ uid, meta, locator, onSelect }: {
  uid: string; meta: Meta; locator: unknown; onSelect: (s: Selection) => void;
}) {
  const doc = useWorkerParse<DocxReply>(
    uid,
    () => new Worker(new URL('../../workers/docx-worker.ts', import.meta.url), { type: 'module' }),
    'document',
  );
  const host = useRef<HTMLDivElement>(null);
  const [missing, setMissing] = useState(false);
  const wantText = typeof (locator as { text?: unknown } | null)?.text === 'string'
    ? (locator as { text: string }).text : null;

  useEffect(() => {
    const el = host.current;
    if (!el || !doc || !doc.ok) return;
    const fragment = DOMPurify.sanitize(doc.html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'svg', 'math'],
      FORBID_ATTR: ['style', 'srcset', 'target'],
      SANITIZE_NAMED_PROPS: true,
      RETURN_DOM_FRAGMENT: true,
    });
    const urls: string[] = [];
    for (const img of Array.from(fragment.querySelectorAll('img'))) {
      const image = doc.images[Number(img.getAttribute('data-ct-img'))];
      if (!image) { img.replaceWith('[image not shown]'); continue; }
      const url = URL.createObjectURL(new Blob([image.bytes as Uint8Array<ArrayBuffer>], { type: image.contentType }));
      urls.push(url);
      img.setAttribute('src', url);
    }
    for (const a of Array.from(fragment.querySelectorAll('a'))) {
      const href = a.getAttribute('href') ?? '';
      if (href.startsWith('#')) continue;
      a.removeAttribute('href');
      if (href) a.setAttribute('title', href);
    }
    el.replaceChildren(fragment);

    setMissing(false);
    if (wantText) {
      const quote = squash(wantText);
      const hits = Array.from(el.querySelectorAll<HTMLElement>(DOCX_BLOCKS))
        .filter((b) => squash(b.textContent ?? '').includes(quote));
      // The innermost block that holds it: a table cell's paragraph, not the whole row.
      const cited = hits.find((b) => !hits.some((o) => o !== b && b.contains(o)));
      if (cited) {
        cited.setAttribute('data-cited', 'true');
        cited.scrollIntoView({ block: 'center' });
      } else {
        setMissing(true);
      }
    }
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [doc, wantText]);

  if (!doc) return <p className="p-6 text-[12px] text-foreground-subtle">Reading the document…</p>;
  if (!doc.ok) return <Card title={meta.path ?? meta.name} lines={[doc.reason]} icon />;

  const pickText = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !host.current?.contains(sel.anchorNode)) return;
    const text = sel.toString().replace(/\s+/g, ' ').trim().slice(0, MAX_QUOTE_CHARS);
    if (text) onSelect({ text });
  };
  const followFootnote = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href');
    if (!a || !href?.startsWith('#')) return;
    e.preventDefault();
    const id = `user-content-${decodeURIComponent(href.slice(1))}`;
    host.current?.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' });
  };

  return (
    <div className="px-8 py-6">
      <p className="text-[11px] text-foreground-subtle mb-4">
        Read as text — headings, tables, lists and images, not Word's page layout.
        {doc.imagesOmitted > 0 && ` ${doc.imagesOmitted} image${doc.imagesOmitted === 1 ? '' : 's'} in a format the viewer does not show.`}
        {missing && ' The cited words were not found as written.'}
      </p>
      <div
        ref={host}
        data-testid="artefact-docx"
        onMouseUp={pickText}
        onClick={followFootnote}
        className="docx-body max-w-3xl text-[13px] leading-6 text-foreground-muted select-text"
      />
    </div>
  );
}

/**
 * A PowerPoint deck read as words (§7.6 fallback): each slide's title and
 * text in presentation order, and the thumbnail PowerPoint saved inside the
 * file. Shown when the engine cannot draw the slides, and labelled so. A
 * cited `{page}` or `{text}` marks its slide; clicking a slide points at it,
 * selecting words quotes them.
 */
function PptxView({ uid, meta, locator, selection, onSelect }: {
  uid: string; meta: Meta; locator: unknown; selection: Selection; onSelect: (s: Selection) => void;
}) {
  const deck = useWorkerParse<PptxReply>(
    uid,
    () => new Worker(new URL('../../workers/pptx-worker.ts', import.meta.url), { type: 'module' }),
    'deck',
  );
  const holder = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const loc = (locator ?? {}) as { page?: unknown; text?: unknown };
  const wantPage = typeof loc.page === 'number' ? loc.page : null;
  const wantText = typeof loc.text === 'string' ? squash(loc.text) : null;

  const cited = useMemo(() => {
    if (!deck || !deck.ok) return null;
    if (wantPage !== null) return deck.slides.some((s) => s.n === wantPage) ? wantPage : null;
    if (wantText) {
      return deck.slides.find((s) => squash([s.title ?? '', ...s.paragraphs].join(' ')).includes(wantText))?.n ?? null;
    }
    return null;
  }, [deck, wantPage, wantText]);

  useEffect(() => {
    if (!deck || !deck.ok || !deck.thumbnail) return;
    const url = URL.createObjectURL(new Blob([deck.thumbnail.bytes as Uint8Array<ArrayBuffer>], { type: deck.thumbnail.contentType }));
    setThumb(url);
    return () => { URL.revokeObjectURL(url); setThumb(null); };
  }, [deck]);

  // Again once the thumbnail is in: it lands above the slides and would push the cited one away.
  useEffect(() => {
    if (cited === null) return;
    holder.current?.querySelector(`[data-page="${cited}"]`)?.scrollIntoView({ block: 'center' });
  }, [cited, thumb]);

  if (!deck) return <p className="p-6 text-[12px] text-foreground-subtle">Reading the deck…</p>;
  if (!deck.ok) return <Card title={meta.path ?? meta.name} lines={[deck.reason]} icon />;

  const picked = selection && 'page' in selection ? (selection as { page: number }).page : null;
  const pickText = (e: React.MouseEvent) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !holder.current?.contains(sel.anchorNode)) return;
    const text = sel.toString().replace(/\s+/g, ' ').trim().slice(0, MAX_QUOTE_CHARS);
    if (text) { e.stopPropagation(); onSelect({ text }); }
  };
  const missing = (wantPage !== null || wantText !== null) && cited === null;

  return (
    <div ref={holder} data-testid="artefact-pptx" className="px-8 py-6 max-w-3xl">
      <p className="text-[11px] text-foreground-subtle mb-4">
        Read as text — each slide's title and words, not its layout.
        {deck.slidesOmitted > 0 && ` Showing the first ${deck.slides.length} slides; ${deck.slidesOmitted} more are not listed.`}
        {missing && (wantPage !== null ? ` The deck has no slide ${wantPage}.` : ' The cited words were not found as written.')}
      </p>
      {thumb && (
        <figure className="mb-5">
          <img
            src={thumb}
            alt="The deck's first slide, as saved in the file"
            onLoad={() => { if (cited !== null) holder.current?.querySelector(`[data-page="${cited}"]`)?.scrollIntoView({ block: 'center' }); }}
            className="max-w-xs rounded border border-white/10"
          />
          <figcaption className="text-[10.5px] text-foreground-subtle mt-1">The first slide, as PowerPoint saved it in the file.</figcaption>
        </figure>
      )}
      <ol className="space-y-2">
        {deck.slides.map((s) => (
          <li
            key={s.n}
            data-page={s.n}
            data-cited={s.n === cited ? 'true' : undefined}
            onClick={() => { if (window.getSelection()?.isCollapsed !== false) onSelect({ page: s.n } as Selection); }}
            onMouseUp={pickText}
            title={`Slide ${s.n} — click to point at it`}
            className={`cursor-pointer rounded-md px-3 py-2 border select-text ${picked === s.n ? 'border-red-400/70' : s.n === cited ? 'border-amber-400/70 bg-amber-400/[0.04]' : 'border-white/[0.06]'}`}
          >
            <div className="text-[10px] uppercase tracking-wide text-foreground-subtle">Slide {s.n}</div>
            {s.title && <div className="text-[13px] font-medium text-foreground">{s.title}</div>}
            {s.paragraphs.map((p, i) => <p key={i} className="text-[12.5px] leading-6 text-foreground-muted">{p}</p>)}
            {!s.title && s.paragraphs.length === 0 && <p className="text-[12px] italic text-foreground-subtle">No text on this slide.</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}

type Rendition = { kind: 'loading' } | { kind: 'pdf'; data: Uint8Array } | { kind: 'fallback'; reason: string };

/**
 * An Office file as it looks (§7.6): converted to PDF by the engine in its
 * own process, and shown by the PDF view — pages as Word lays them out,
 * slides as PowerPoint draws them, citations by page or by words. The
 * engine starts on the first one opened, so that first look takes a few
 * seconds; after that it is warm, and a file seen before comes from the
 * cache. When it cannot convert — no engine in this build, a runtime that
 * cannot confine it, a document it cannot read — the packaged fallback is
 * shown, and says why.
 */
function OfficeView({ uid, meta, ext, locator, selection, onSelect }: {
  uid: string; meta: Meta; ext: string; locator: unknown; selection: Selection; onSelect: (s: Selection) => void;
}) {
  const [state, setState] = useState<Rendition>({ kind: 'loading' });

  useEffect(() => {
    let live = true;
    setState({ kind: 'loading' });
    (async () => {
      try {
        const res = await fetch(artefactRenditionUrl(uid));
        if (res.ok) {
          const data = new Uint8Array(await res.arrayBuffer());
          if (live) setState({ kind: 'pdf', data });
          return;
        }
        const body = await res.json().catch(() => null) as { error?: string } | null;
        if (live) setState({ kind: 'fallback', reason: body?.error ?? `HTTP ${res.status}` });
      } catch {
        if (live) setState({ kind: 'fallback', reason: 'the document could not be converted' });
      }
    })();
    return () => { live = false; };
  }, [uid]);

  if (state.kind === 'loading') {
    return <p data-testid="rendition-loading" className="p-6 text-[12px] text-foreground-subtle">Preparing preview…</p>;
  }
  if (state.kind === 'pdf') {
    return <PdfView uid={uid} meta={meta} locator={locator} selection={selection} onSelect={onSelect} data={state.data} />;
  }
  const why = state.reason.replace(/\.$/, '');
  if (ext === 'docx') {
    return (
      <div data-testid="rendition-fallback">
        <p className="px-8 pt-4 text-[11px] text-amber-300/80">Shown as text, not as its pages — {why}.</p>
        <DocxView uid={uid} meta={meta} locator={locator} onSelect={onSelect} />
      </div>
    );
  }
  if (ext === 'pptx') {
    return (
      <div data-testid="rendition-fallback">
        <p className="px-8 pt-4 text-[11px] text-amber-300/80">Shown as text, not as its slides — {why}.</p>
        <PptxView uid={uid} meta={meta} locator={locator} selection={selection} onSelect={onSelect} />
      </div>
    );
  }
  return (
    <div data-testid="rendition-fallback" className="h-full">
      <Card
        title={meta.path ?? meta.name}
        lines={[`This workbook cannot be shown here — ${why}.`, 'Saving it as .xlsx shows its cells in the viewer.']}
        icon
      />
    </div>
  );
}

/** Per artefact, for this session: a person who ran a report's scripts once need not ask again. */
const scriptsOn = new Set<string>();

type HtmlReportApi = NonNullable<Window['electronAPI']>['htmlReport'];

/**
 * An HTML report (§7.3). HTML is a program, so it never runs in this
 * window: on the desktop it is shown in its own sandboxed view, laid over
 * this box — its own session, no network, scripts off unless turned on for
 * this artefact. Where there is no such view (the browser build) its source
 * is shown as text, and says so.
 */
function HtmlView({ uid, meta, locator, selection, onSelect }: {
  uid: string; meta: Meta; locator: unknown; selection: Selection; onSelect: (s: Selection) => void;
}) {
  const api: HtmlReportApi | undefined = (window as unknown as { electronAPI?: { htmlReport?: HtmlReportApi } }).electronAPI?.htmlReport;
  const box = useRef<HTMLDivElement>(null);
  const [scripts, setScripts] = useState(() => scriptsOn.has(uid));
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!api || !el) return;
    let live = true;
    const rect = () => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    };
    setProblem(null);
    void api.show(uid, rect(), scripts).then((res) => { if (live && !res.ok) setProblem(res.reason ?? 'This report cannot be shown here.'); });
    const follow = () => { void api.move(rect()); };
    const observer = new ResizeObserver(follow);
    observer.observe(el);
    window.addEventListener('resize', follow);
    return () => {
      live = false;
      observer.disconnect();
      window.removeEventListener('resize', follow);
      void api.hide();
    };
  }, [api, uid, scripts]);

  if (!api) {
    return (
      <div data-testid="artefact-html-source">
        <p className="px-4 pt-3 text-[11px] text-amber-300/80">
          HTML is a program, so it runs only in its own sandboxed view in the desktop app. Shown here as its source.
        </p>
        <TextView uid={uid} locator={locator} selection={selection} onSelect={onSelect} />
      </div>
    );
  }
  const toggle = () => {
    if (scripts) scriptsOn.delete(uid); else scriptsOn.add(uid);
    setScripts(!scripts);
  };
  return (
    <div className="flex flex-col h-full" data-testid="artefact-html">
      <div className="flex items-center gap-3 px-4 py-1.5 border-b border-white/[0.04] text-[11px] text-foreground-subtle">
        <span>Sandboxed · offline · {scripts ? "this page's scripts are running" : 'scripts off'}</span>
        <button onClick={toggle} className="ml-auto px-2 py-0.5 rounded border border-white/10 hover:border-accent/40 hover:text-foreground">
          {scripts ? 'Stop its scripts' : "Run this page's scripts"}
        </button>
      </div>
      {problem
        ? <Card title={meta.path ?? meta.name} lines={[problem]} icon />
        : <div ref={box} className="flex-1 min-h-0 bg-white" aria-label="HTML report (shown in its own sandboxed view)" />}
    </div>
  );
}

function NotYet({ meta, ext }: { meta: Meta; ext: string }) {
  return <Card title={meta.path ?? meta.name} lines={[`.${ext || '?'} files are not previewed.`, 'Show in Finder to look at it — the viewer never opens files with another app.']} icon />;
}

function TooBig({ meta }: { meta: Meta }) {
  return <Card title={meta.path ?? meta.name} lines={[`This file is ${formatBytes(meta.size ?? 0)} — too large to preview here.`]} icon />;
}

function Card({ title, lines, icon }: { title: string; lines: string[]; icon?: boolean }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 p-8 text-center">
      {icon && <FileQuestion size={28} className="text-foreground-subtle" />}
      <div className="text-[13px] text-foreground font-mono">{title}</div>
      {lines.map((l) => <p key={l} className="text-[12px] text-foreground-muted max-w-md">{l}</p>)}
    </div>
  );
}

// ── helpers ───────────────────────────────────────────────────────────

const tooBig = (m: Meta) => (m.size ?? 0) > MAX_TEXT_BYTES;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function toSeconds(t: unknown): number | null {
  if (typeof t === 'number' && Number.isFinite(t)) return t;
  if (typeof t !== 'string') return null;
  const parts = t.trim().split(':').map(Number);
  return parts.some((n) => !Number.isFinite(n)) ? null : parts.reduce((acc, n) => acc * 60 + n, 0);
}

function lineSpan(lines: unknown): { start: number; end: number } | null {
  if (typeof lines === 'number' && Number.isInteger(lines)) return { start: lines, end: lines };
  if (Array.isArray(lines) && lines.length === 2) return { start: Number(lines[0]), end: Number(lines[1]) };
  if (typeof lines === 'string') {
    const m = lines.trim().match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
    if (m) return { start: Number(m[1]), end: Number(m[2] ?? m[1]) };
  }
  return null;
}

function colName(n: number): string {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function parseCell(ref: string): { col: number; row: number } | null {
  const m = ref.replace(/\$/g, '').match(/^([A-Za-z]{1,3})(\d+)$/);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col, row: Number(m[2]) };
}

function parseRange(range: unknown): { from: { col: number; row: number }; to: { col: number; row: number } } | null {
  if (typeof range !== 'string') return null;
  const [a, b] = range.split(':');
  const from = parseCell(a ?? '');
  const to = b === undefined ? from : parseCell(b);
  if (!from || !to) return null;
  return {
    from: { col: Math.min(from.col, to.col), row: Math.min(from.row, to.row) },
    to: { col: Math.max(from.col, to.col), row: Math.max(from.row, to.row) },
  };
}

/** RFC 4180-ish: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
