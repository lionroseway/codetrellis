/**
 * The evidence export (Phase 32 B10.4, observability doc §11).
 *
 * For a plan, or a window of time in a project: one signed package an
 * auditor can check on their own machine. It carries
 *
 *  - **the record's entries in the window**, each with the event as written
 *    and its link, and how to recompute them: every digest from its event,
 *    every hash from the one before, starting at the link before the window.
 *    The record is this computer's, not one project's, so the window carries
 *    every entry in it, whichever project it was about;
 *  - **the replay frames** taken in the window (which commit, why, by whom);
 *  - **the stack and the signals at the start and at the end** (B5.2's
 *    state at a moment), with what was waiting on the person;
 *  - **breakpoints and decisions**: the record's own entries for them, in
 *    words, each with its entry number;
 *  - **the sign-off pack**, for a plan;
 *
 * sealed like a pack (B10.3) in its own namespace, with the record's head.
 *
 * Verifying says three things: who signed it and whether it changed since;
 * whether its entries recompute into one unbroken chain; and, on the
 * computer that made it, whether its own record still holds those entries
 * as exported, naming any changed in the database since.
 */

import { getDb } from './database';
import { digestOf, linkHash, GENESIS } from './record-chain';
import { listFrames, type ReplayFrame } from './replay-frames';
import { stateAt, type StateAt } from './replay-state';
import { getPlan } from './plan-service';
import { buildSignoffPack, esc, scriptJson, type SignoffPack } from './signoff-pack';
import { EVIDENCE_NAMESPACE, sealDocument, checkDocumentSeal, type PackSeal, type SealCheck, type SealedRecord } from './pack-seal';
import { phraseEvent } from '../../shared/lib/tool-phrasing';
import type { AgentEvent } from '../../shared/types';

export const EVIDENCE_FORMAT = 'codetrellis-evidence';
export const EVIDENCE_VERSION = 1;
/** The most entries one export carries; a longer window is refused with what to do. */
export const MAX_EVIDENCE_ENTRIES = 20_000;
const MAX_FRAMES = 2000;

export class EvidenceError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

/** An event as the record wrote it: the fields its digest is over, the payload as stored. */
export interface EvidenceEvent { id: string; at: number; source: string; type: string; sessionId: string | null; agentType: string | null; payload: string }

export interface EvidenceEntry {
  seq: number;
  linkedAt: number;
  digest: string;
  hash: string;
  /** Null when the event had already gone from this computer's log at export. */
  event: EvidenceEvent | null;
}

/** The project as it was at one end of the window. */
export type EvidenceMoment = Omit<StateAt, 'sinceFrame' | 'projectPath'>;

export interface EvidenceDecision { seq: number; at: number; type: string; words: string }

export interface Evidence {
  format: typeof EVIDENCE_FORMAT;
  version: number;
  generatedAt: string;
  window: { from: number; to: number; projectPath: string; plan: { uid: string; title: string } | null; words: string };
  record: {
    /** How to recompute every link, in words. */
    how: string;
    /** The link before the window's first: where the recomputation starts. */
    before: { seq: number; hash: string };
    /** The window's last link. */
    through: { seq: number; hash: string };
    entries: EvidenceEntry[];
  };
  frames: ReplayFrame[];
  start: EvidenceMoment;
  end: EvidenceMoment;
  decisions: EvidenceDecision[];
  signoffPack: SignoffPack | null;
  sealedRecord?: SealedRecord;
  seal?: PackSeal;
}

const HOW = 'digest = sha256(JSON.stringify([event.id, event.at, event.source, event.type, event.sessionId, event.agentType, event.payload])); ' +
  'hash = sha256(prev + "\\n" + seq + "\\n" + event.id + "\\n" + digest), hex, where prev is the hash before (record.before.hash for the first entry).';

/** The kinds of entry that are a breakpoint or a person's decision. */
const DECISION_TYPES = new Set(['breakpoint_hit', 'breakpoint_answered', 'criterion_decided', 'signal_answered', 'spec_decided', 'rule_changed', 'retention_changed']);

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const minute = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16);

function rowsOf<T>(sql: string, params: Array<string | number> = []): T[] {
  const res = getDb().exec(sql, params);
  if (!res.length) return [];
  const { columns, values } = res[0];
  return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i]])) as T);
}

interface JoinedRow { seq: number; linked_at: number; digest: string; prev: string; hash: string; id: string | null; at: number | null; source: string | null; type: string | null; session_id: string | null; agent_type: string | null; payload: string | null }

/** The link at or before a time: where a window that starts then begins its chain. */
function linkBefore(at: number): { seq: number; hash: string } {
  const last = rowsOf<{ seq: number; hash: string }>('SELECT seq, hash FROM record_chain WHERE linked_at < ? ORDER BY seq DESC LIMIT 1', [at])[0];
  if (last) return { seq: Number(last.seq), hash: last.hash };
  const a = rowsOf<{ through_seq: number; hash: string }>('SELECT through_seq, hash FROM record_anchor WHERE id = 1')[0];
  return a ? { seq: Number(a.through_seq), hash: a.hash } : { seq: 0, hash: GENESIS };
}

function entriesIn(from: number, to: number): { before: { seq: number; hash: string }; entries: EvidenceEntry[] } {
  const n = Number(rowsOf<{ n: number }>('SELECT COUNT(*) AS n FROM record_chain WHERE linked_at >= ? AND linked_at <= ?', [from, to])[0]?.n ?? 0);
  if (n > MAX_EVIDENCE_ENTRIES) {
    throw new EvidenceError(`That window holds ${n.toLocaleString('en-GB')} record entries; one export carries at most ${MAX_EVIDENCE_ENTRIES.toLocaleString('en-GB')}. Choose a shorter window.`);
  }
  const rows = rowsOf<JoinedRow>(
    `SELECT c.seq, c.linked_at, c.digest, c.prev, c.hash, e.id, e.at, e.source, e.type, e.session_id, e.agent_type, e.payload
     FROM record_chain c LEFT JOIN agent_events e ON e.id = c.event_id
     WHERE c.linked_at >= ? AND c.linked_at <= ? ORDER BY c.seq ASC`,
    [from, to],
  );
  const before = rows.length ? { seq: Number(rows[0].seq) - 1, hash: rows[0].prev } : linkBefore(from);
  const entries = rows.map((r): EvidenceEntry => ({
    seq: Number(r.seq),
    linkedAt: Number(r.linked_at),
    digest: r.digest,
    hash: r.hash,
    event: r.id === null ? null : {
      id: r.id, at: Number(r.at), source: String(r.source), type: String(r.type),
      sessionId: r.session_id ?? null, agentType: r.agent_type ?? null, payload: String(r.payload),
    },
  }));
  return { before, entries };
}

function parsePayload(raw: string): Record<string, unknown> {
  try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v as Record<string, unknown> : {}; } catch { return {}; }
}

function decisionsOf(entries: EvidenceEntry[]): EvidenceDecision[] {
  return entries.filter((e) => e.event && DECISION_TYPES.has(e.event.type)).map((e) => {
    const ev = e.event!;
    const phrased = phraseEvent({ id: ev.id, timestamp: ev.at, source: ev.source, type: ev.type, payload: parsePayload(ev.payload) } as AgentEvent);
    return { seq: e.seq, at: ev.at, type: ev.type, words: phrased.text };
  });
}

function moment(projectPath: string, at: number): EvidenceMoment {
  const { sinceFrame: _diff, projectPath: _path, ...rest } = stateAt(projectPath, at, false);
  return rest;
}

export interface EvidenceRequest {
  /** A plan: its project, from when it was made until it finished (or now). */
  planUid?: string;
  /** Or a window of time in a project the caller has already confined. */
  projectPath?: string;
  from?: number;
  to?: number;
}

/** The evidence for a plan or a window, not yet sealed. */
export function buildEvidence(req: EvidenceRequest, now = Date.now()): Evidence {
  let projectPath: string;
  let from: number;
  let to: number;
  let plan: Evidence['window']['plan'] = null;
  let signoffPack: SignoffPack | null = null;
  if (req.planUid) {
    const p = getPlan(req.planUid);
    if (!p) throw new EvidenceError(`Plan ${req.planUid} not found`, 404);
    projectPath = p.projectPath;
    from = p.createdAt;
    to = p.status === 'completed' || p.status === 'archived' ? Math.max(p.updatedAt, p.createdAt) : now;
    plan = { uid: p.uid, title: p.title };
    signoffPack = buildSignoffPack(p.uid, new Date(now));
  } else {
    if (!req.projectPath) throw new EvidenceError('Name a plan, or a project and a window (from, to)');
    if (!Number.isFinite(req.from) || !Number.isFinite(req.to)) throw new EvidenceError('from and to must be times in milliseconds');
    projectPath = req.projectPath;
    from = req.from as number;
    to = Math.min(req.to as number, now);
    if (from > to) throw new EvidenceError('from must be before to');
  }

  const { before, entries } = entriesIn(from, to);
  const last = entries[entries.length - 1];
  const words = `${plan ? `The plan “${plan.title}”: ` : ''}${minute(from)} to ${minute(to)} UTC, ` +
    `${entries.length.toLocaleString('en-GB')} record entr${entries.length === 1 ? 'y' : 'ies'}`;
  return {
    format: EVIDENCE_FORMAT,
    version: EVIDENCE_VERSION,
    generatedAt: new Date(now).toISOString(),
    window: { from, to, projectPath, plan, words },
    record: { how: HOW, before, through: last ? { seq: last.seq, hash: last.hash } : before, entries },
    frames: listFrames(projectPath, { from, to, limit: MAX_FRAMES }),
    start: moment(projectPath, from),
    end: moment(projectPath, to),
    decisions: decisionsOf(entries),
    signoffPack,
  };
}

/** The evidence, sealed with this computer's key and the record's head. */
export function sealEvidence(e: Evidence): Evidence & { sealedRecord: SealedRecord; seal: PackSeal } {
  return sealDocument(EVIDENCE_NAMESPACE, e);
}

// ── Verifying ───────────────────────────────────────────────────────

export type ChainProblemKind = 'changed' | 'relinked' | 'missing';
export interface ChainProblem { seq: number; kind: ChainProblemKind; type: string | null; agentType: string | null; at: number | null }
export type HereProblemKind = 'changed' | 'removed' | 'relinked';
export interface HereProblem { seq: number; kind: HereProblemKind; type: string | null; agentType: string | null; at: number | null }

export interface EvidenceCheck {
  ok: boolean;
  seal: SealCheck;
  chain: { ok: boolean; entries: number; problems: ChainProblem[]; words: string };
  /** This computer's record against the export: only on the computer that made it. */
  here: { state: 'matches' | 'differs' | 'trimmed' | 'not-here'; problems: HereProblem[]; words: string };
  words: string;
}

const MAX_PROBLEMS = 50;

const label = (p: { seq: number; type: string | null; agentType: string | null; at: number | null }) =>
  `#${p.seq}${p.type ? ` (${p.type.replace(/_/g, ' ')}${p.agentType ? ` by ${p.agentType}` : ''}${p.at ? `, ${day(p.at)}` : ''})` : ''}`;

function str(v: unknown): string | null { return typeof v === 'string' ? v : null; }
function num(v: unknown): number | null { return typeof v === 'number' && Number.isFinite(v) ? v : null; }

/** The entries an export carries, read as untrusted input. */
function entriesOf(doc: Record<string, unknown>): { before: { seq: number; hash: string } | null; entries: EvidenceEntry[] } | null {
  const record = doc.record as Record<string, unknown> | undefined;
  if (!record || !Array.isArray(record.entries)) return null;
  const b = record.before as Record<string, unknown> | undefined;
  const before = b && num(b.seq) !== null && str(b.hash) ? { seq: num(b.seq)!, hash: str(b.hash)! } : null;
  const entries: EvidenceEntry[] = [];
  for (const raw of record.entries.slice(0, MAX_EVIDENCE_ENTRIES)) {
    const e = (raw ?? {}) as Record<string, unknown>;
    const ev = e.event as Record<string, unknown> | null | undefined;
    entries.push({
      seq: num(e.seq) ?? -1, linkedAt: num(e.linkedAt) ?? 0, digest: str(e.digest) ?? '', hash: str(e.hash) ?? '',
      event: ev && typeof ev === 'object' ? {
        id: str(ev.id) ?? '', at: num(ev.at) ?? 0, source: str(ev.source) ?? '', type: str(ev.type) ?? '',
        sessionId: str(ev.sessionId), agentType: str(ev.agentType), payload: str(ev.payload) ?? '',
      } : null,
    });
  }
  return { before, entries };
}

/** Recompute every digest and link from the export alone. */
function checkChain(before: { seq: number; hash: string } | null, entries: EvidenceEntry[]): EvidenceCheck['chain'] {
  const problems: ChainProblem[] = [];
  const say = (p: ChainProblem) => { if (problems.length < MAX_PROBLEMS) problems.push(p); };
  let prev = before?.hash ?? '';
  let expected = (before?.seq ?? -1) + 1;
  for (const e of entries) {
    const info = { type: e.event?.type ?? null, agentType: e.event?.agentType ?? null, at: e.event?.at ?? null };
    if (!before || e.seq !== expected) say({ seq: e.seq, kind: 'relinked', ...info });
    else if (linkHash(prev, e.seq, e.event?.id ?? '', e.digest) !== e.hash) say({ seq: e.seq, kind: 'relinked', ...info });
    if (!e.event) say({ seq: e.seq, kind: 'missing', ...info });
    else if (digestOf({ id: e.event.id, at: e.event.at, source: e.event.source, type: e.event.type, session_id: e.event.sessionId, agent_type: e.event.agentType, payload: e.event.payload }) !== e.digest) {
      say({ seq: e.seq, kind: 'changed', ...info });
    }
    prev = e.hash;
    expected = e.seq + 1;
  }
  const ok = problems.length === 0;
  const span = entries.length ? ` (#${entries[0].seq} to #${entries[entries.length - 1].seq})` : '';
  const n = `${entries.length.toLocaleString('en-GB')} record entr${entries.length === 1 ? 'y' : 'ies'}`;
  const WORDS: Record<ChainProblemKind, string> = {
    changed: 'its event does not match its digest',
    relinked: 'its link does not follow from the one before',
    missing: 'its event was already gone when it was exported',
  };
  const words = ok
    ? entries.length ? `Its ${n}${span} recompute into one unbroken chain.` : 'It carries no record entries.'
    : `Its record entries do not recompute: ${problems.slice(0, 3).map((p) => `${label(p)}: ${WORDS[p.kind]}`).join('; ')}.`;
  return { ok, entries: entries.length, problems, words };
}

/** This computer's record against an export it made: what changed in the database since. */
function checkHere(entries: EvidenceEntry[]): EvidenceCheck['here'] {
  const db = getDb();
  const anchorSeq = Number(db.exec('SELECT through_seq FROM record_anchor WHERE id = 1')[0]?.values[0]?.[0] ?? 0);
  const problems: HereProblem[] = [];
  let trimmed = 0;
  for (const e of entries) {
    if (problems.length >= MAX_PROBLEMS) break;
    const info = { type: e.event?.type ?? null, agentType: e.event?.agentType ?? null, at: e.event?.at ?? null };
    const link = rowsOf<{ hash: string; event_id: string }>('SELECT hash, event_id FROM record_chain WHERE seq = ?', [e.seq])[0];
    if (!link) {
      if (e.seq <= anchorSeq) trimmed++;
      else problems.push({ seq: e.seq, kind: 'removed', ...info });
      continue;
    }
    if (link.hash !== e.hash) { problems.push({ seq: e.seq, kind: 'relinked', ...info }); continue; }
    const ev = rowsOf<{ id: string; at: number; source: string; type: string; session_id: string | null; agent_type: string | null; payload: string }>(
      'SELECT id, at, source, type, session_id, agent_type, payload FROM agent_events WHERE id = ?', [link.event_id],
    )[0];
    if (!ev) { if (e.event) problems.push({ seq: e.seq, kind: 'removed', ...info }); continue; }
    if (digestOf(ev) !== e.digest) problems.push({ seq: e.seq, kind: 'changed', ...info });
  }
  const WORDS: Record<HereProblemKind, string> = {
    changed: 'its content was changed in this computer\'s record since',
    removed: 'it was removed from this computer\'s record since',
    relinked: 'its link in this computer\'s record was changed since',
  };
  if (problems.length) {
    return { state: 'differs', problems, words: `Since it was exported: ${problems.slice(0, 3).map((p) => `${label(p)}: ${WORDS[p.kind]}`).join('; ')}.` };
  }
  if (trimmed) {
    return { state: 'trimmed', problems, words: `This computer's record still matches it, except ${trimmed.toLocaleString('en-GB')} entr${trimmed === 1 ? 'y' : 'ies'} retention has removed since.` };
  }
  return { state: 'matches', problems, words: entries.length ? 'This computer\'s record still holds every entry in it, unchanged.' : 'This computer\'s record has nothing to compare.' };
}

/** Who signed an export, whether it changed since, whether its chain holds, and what changed here since. Never throws on bad input. */
export function verifyEvidence(doc: unknown): EvidenceCheck {
  const d = (doc && typeof doc === 'object' ? doc : {}) as Record<string, unknown>;
  if (d.format !== EVIDENCE_FORMAT) throw new EvidenceError('That file is not a CodeTrellis evidence export');
  const seal = checkDocumentSeal(EVIDENCE_NAMESPACE, 'export', d);
  const read = entriesOf(d);
  const chain = read ? checkChain(read.before, read.entries) : { ok: false, entries: 0, problems: [], words: 'It carries no record entries that can be read.' };
  const here: EvidenceCheck['here'] = seal.state === 'this-computer' && read
    ? checkHere(read.entries)
    : {
      state: 'not-here', problems: [],
      words: seal.state === 'changed' || seal.state === 'unsigned'
        ? 'Its signature does not hold, so who made it is not known and this computer\'s record was not compared.'
        : 'It was made on another computer, so this one has no record of it to compare.',
    };
  const ok = (seal.state === 'this-computer' || seal.state === 'teammate') && chain.ok && here.state !== 'differs';
  return { ok, seal, chain, here, words: [seal.words, chain.words, here.words].filter(Boolean).join(' ') };
}

/** The export's data back out of a saved page (or the JSON itself). */
export function evidenceFromText(text: string): unknown {
  const trimmed = text.trim();
  try {
    if (trimmed.startsWith('{')) return JSON.parse(trimmed);
    const m = trimmed.match(/<script type="application\/json" id="codetrellis-evidence">([\s\S]*?)<\/script>/);
    if (!m) throw new EvidenceError('No evidence data in that file');
    return JSON.parse(m[1]);
  } catch (err) {
    if (err instanceof EvidenceError) throw err;
    throw new EvidenceError('That file is not a readable evidence export');
  }
}

// ── The page ────────────────────────────────────────────────────────

function stackSection(title: string, m: EvidenceMoment): string {
  const plans = m.stack.plans.map((p) => `<li><b>${esc(p.title)}</b> <span class="muted">${esc(p.status)}</span><ul>${
    p.tasks.map((t) => `<li>${esc(t.title)} <span class="muted">${esc(t.status ?? '')}${t.assignee ? ` · ${esc(t.assignee)}` : ''}${t.workstream ? ` · ${esc(t.workstream)}` : ''}</span></li>`).join('')
  }</ul></li>`).join('');
  const signals = m.signals.map((s) => `<li>${esc(s.summary)} <span class="muted">${esc(s.severity)}</span></li>`).join('');
  return `<h2>${esc(title)} <span class="muted">${esc(minute(m.at))} UTC</span></h2>
<h3>The stack</h3>${plans ? `<ul>${plans}</ul>` : '<p class="muted">Nothing under way.</p>'}
<h3>Signals open</h3>${signals ? `<ul>${signals}</ul>` : '<p class="muted">None.</p>'}
<p class="muted">${m.waiting.length === 0 ? 'Nothing was waiting on a person.' : `${m.waiting.length} call${m.waiting.length === 1 ? ' was' : 's were'} waiting on a person.`}</p>`;
}

/**
 * The export as a standalone page. No script runs in it: the only
 * `<script>` is `application/json` data, and every value is escaped.
 */
export function renderEvidenceHtml(e: Evidence): string {
  const title = e.window.plan ? `Evidence — ${e.window.plan.title}` : 'Evidence';
  const decisions = e.decisions.map((d) => `<tr><td>#${d.seq}</td><td>${esc(minute(d.at))}</td><td>${esc(d.words)}</td></tr>`).join('');
  const frames = e.frames.map((f) => `<tr><td>${esc(minute(f.at))}</td><td>${esc(f.reasons.join(', '))}</td><td><code>${esc((f.commitSha ?? '').slice(0, 10))}</code> ${esc(f.branch ?? '')}</td><td>${esc(f.agentType ?? '')}</td></tr>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${esc(title)}</title>
<style>
  body { font: 13px/1.5 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #111; max-width: 860px; margin: 32px auto; padding: 0 24px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 28px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  h3 { font-size: 13px; margin: 12px 0 4px; }
  .muted { color: #666; font-weight: normal; font-size: 12px; }
  code { font: 11px ui-monospace, Menlo, Consolas, monospace; color: #444; word-break: break-all; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  td, th { border-bottom: 1px solid #eee; padding: 4px 6px; text-align: left; vertical-align: top; }
</style>
</head>
<body>
<h1>${esc(title)}</h1>
<p class="muted">${esc(e.window.words)} · ${esc(e.window.projectPath)} · generated ${esc(e.generatedAt.replace('T', ' ').slice(0, 16))} UTC by CodeTrellis</p>
${e.seal ? `<p class="muted" id="seal">Signed by the computer with key <code>${esc(e.seal.key)}</code>, with its record at entry #${esc(String(e.sealedRecord?.seq ?? 0))}. Verify it in CodeTrellis: a changed byte, a broken chain, or a record changed since, shows.</p>` : ''}
<h2>Breakpoints and decisions</h2>
${decisions ? `<table><thead><tr><th>Entry</th><th>When (UTC)</th><th>What</th></tr></thead><tbody>${decisions}</tbody></table>` : '<p class="muted">None in this window.</p>'}
${stackSection('At the start', e.start)}
${stackSection('At the end', e.end)}
<h2>Recorded moments</h2>
${frames ? `<table><thead><tr><th>When (UTC)</th><th>Why</th><th>Commit</th><th>Agent</th></tr></thead><tbody>${frames}</tbody></table>` : '<p class="muted">None in this window.</p>'}
<h2>The record</h2>
<p class="muted">${e.record.entries.length.toLocaleString('en-GB')} entries, from the link after #${e.record.before.seq} (<code>${esc(e.record.before.hash.slice(0, 16))}…</code>) through #${e.record.through.seq} (<code>${esc(e.record.through.hash.slice(0, 16))}…</code>). Each recomputes from the data in this file: ${esc(e.record.how)}</p>
${e.signoffPack ? `<h2>Sign-off pack</h2><p class="muted">${e.signoffPack.rows.filter((r) => r.state === 'met').length} of ${e.signoffPack.rows.length} criteria met; ${e.signoffPack.files.length} file${e.signoffPack.files.length === 1 ? '' : 's'} with hashes. The pack is in this file's data.</p>` : ''}
<script type="application/json" id="codetrellis-evidence">${scriptJson(e)}</script>
</body>
</html>
`;
}
