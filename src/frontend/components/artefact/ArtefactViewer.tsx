import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, FolderOpen, X, FileQuestion } from 'lucide-react';
import type { ItemCriterion } from '@shared/types';
import { useArtefactViewStore, type ArtefactView } from '../../stores/artefact-view-store';
import { usePlanItemsStore } from '../../stores/plan-items-store';
import { artefactSrcUrl } from '../../lib/artefact-src';
import { describeLocator, openArtefactAt } from '../../lib/open-artefact-at';

/**
 * Phase 31 §7 — the artefact viewer.
 *
 * Where a person verifies: the evidence an agent offered, open at the place
 * it cites, and — when it is wrong — "send back from here", which records
 * the file and the lines or cells the note is about (§8.2). The agent then
 * reads that place back from its worklist rather than from a conversation.
 *
 * Formats in this first cut need no parser: images (SVG only ever through
 * `<img>` — an inlined SVG is a document that can run script), video with
 * seeking, text with line numbers, CSV as a grid. PDF, spreadsheets and
 * Word documents arrive with their parsers; anything not shown yet gets a
 * card saying what it is, and Show in Finder. There is no "Open" (§7.4).
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

type Selection = { lines: string } | { range: string } | null;

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
const VIDEO = new Set(['mp4', 'webm', 'mov']);
const TEXT = new Set(['md', 'txt', 'log', 'json', 'xml']);
/** Past this, text is not pulled into the page — the card says so. */
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const MAX_CSV_ROWS = 2000;

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
            : ext === 'csv' ? (tooBig(meta) ? <TooBig meta={meta} /> : (
              <CsvView uid={view.uid} locator={view.locator} selection={selection} onSelect={setSelection} />
            ))
            : TEXT.has(ext) ? (tooBig(meta) ? <TooBig meta={meta} /> : (
              <TextView uid={view.uid} locator={view.locator} selection={selection} onSelect={setSelection} />
            ))
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
              {place ? `Selected ${place}` : 'Select lines or cells to point at the problem'}
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
  const target = parseRange((locator as { range?: unknown } | null)?.range);
  const picked = selection && 'range' in selection ? parseRange(selection.range) : null;
  const anchor = useRef<{ col: number; row: number } | null>(null);
  const firstHit = useRef<HTMLTableCellElement>(null);

  useEffect(() => { firstHit.current?.scrollIntoView({ block: 'center', inline: 'center' }); }, [text]);

  if (error) return <Card title="Could not read the file" lines={[error]} />;
  if (text === null) return <p className="p-6 text-[12px] text-foreground-subtle">Loading…</p>;
  const shown = rows.slice(0, MAX_CSV_ROWS);
  const cols = Math.max(0, ...shown.map((r) => r.length));

  const pick = (col: number, row: number, extend: boolean) => {
    const from = extend && anchor.current ? anchor.current : { col, row };
    if (!extend) anchor.current = { col, row };
    const a = { col: Math.min(from.col, col), row: Math.min(from.row, row) };
    const b = { col: Math.max(from.col, col), row: Math.max(from.row, row) };
    const ref = (c: { col: number; row: number }) => `${colName(c.col)}${c.row}`;
    onSelect({ range: a.col === b.col && a.row === b.row ? ref(a) : `${ref(a)}:${ref(b)}` });
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
          {shown.map((r, ri) => (
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
                    {/* Cells are text, always — never markup. */}
                    {r[ci] ?? ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > MAX_CSV_ROWS && (
        <p className="p-2 text-[11px] text-foreground-subtle">Showing the first {MAX_CSV_ROWS} of {rows.length} rows.</p>
      )}
    </div>
  );
}

function NotYet({ meta, ext }: { meta: Meta; ext: string }) {
  const why =
    ext === 'html' || ext === 'htm'
      ? 'HTML is a program, so it gets its own sandboxed view — that has not shipped yet.'
      : ext === 'pdf' || ext === 'xlsx' || ext === 'xlsm' || ext === 'xls' || ext === 'docx' || ext === 'pptx'
        ? `Previewing .${ext} files arrives with its parser — not in this version.`
        : `.${ext || '?'} files are not previewed.`;
  return <Card title={meta.path ?? meta.name} lines={[why, 'Show in Finder to look at it — the viewer never opens files with another app.']} icon />;
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
