/**
 * Phase 31 §13 — the sign-off pack: what was agreed, in a form that
 * leaves the app and can be checked later.
 *
 * Built from the same rows as the PR draft's table (signoff-rows.ts): each
 * task, each criterion verbatim, the evidence with the place it cites and
 * its sha256, the decision, who, when, and from which device. Criteria the
 * agent approved itself get their own section, so nobody reading the pack
 * mistakes Claude's approval for the analyst's.
 *
 * Two outputs:
 *  - a standalone page — no scripts, no network, every value escaped —
 *    that Electron prints to PDF and a browser saves as it is; the page
 *    carries the pack's own data as JSON so it can be verified from the
 *    file alone;
 *  - `verifyPack`: re-hash the files a pack names and say which still
 *    match. The paths come from the pack, which is untrusted input once it
 *    has left the app, so each is resolved inside the PLAN's project — its
 *    root taken from the plan, never from the pack — without following
 *    links (confined-fs).
 *
 * Signing the pack is not in this phase: the release-manifest key is for
 * releases and must not be reused, and a per-install key is its own design.
 */

import { getPlan } from './plan-service';
import { resolveTrustedProjectRoot } from './trusted-roots';
import { sha256FileWithin } from '../lib/sha256-file';
import { signoffRows } from './signoff-rows';
import { decisionWords, stateWords, type SignoffRow } from '../../shared/lib/signoff';

export const PACK_FORMAT = 'codetrellis-signoff-pack';
export const PACK_VERSION = 1;

/** A file the pack vouches for: this path had this hash when it was judged. */
export interface PackFile {
  path: string;
  sha256: string;
  /** What the hash was taken at: an approval, or the submission. */
  takenAt: 'approval' | 'submission';
}

export interface SignoffPack {
  format: typeof PACK_FORMAT;
  version: typeof PACK_VERSION;
  plan: { uid: string; title: string };
  generatedAt: string;
  rows: SignoffRow[];
  files: PackFile[];
}

export function buildSignoffPack(planUid: string, now: Date = new Date()): SignoffPack {
  const plan = getPlan(planUid);
  if (!plan) throw new Error(`Plan ${planUid} not found`);
  const rows = signoffRows(planUid);

  const files = new Map<string, PackFile>();
  const claim = (path: string | null, sha256: string | null | undefined, takenAt: PackFile['takenAt']) => {
    if (!path || !sha256) return;
    const key = `${path}\u0000${sha256}`;
    if (!files.has(key)) files.set(key, { path, sha256, takenAt });
  };
  for (const r of rows) {
    const approved = r.decision?.decision === 'approved';
    for (const e of r.evidence) {
      const atApproval = approved && e.attachmentUid ? r.decision!.evidenceHashes[e.attachmentUid] : undefined;
      if (atApproval) claim(e.path, atApproval, 'approval');
      else claim(e.path, e.sha256AtSubmit, 'submission');
    }
  }

  return {
    format: PACK_FORMAT,
    version: PACK_VERSION,
    plan: { uid: plan.uid, title: plan.title },
    generatedAt: now.toISOString(),
    rows,
    files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)),
  };
}

// ── Verify ────────────────────────────────────────────────────────────

export type FileVerdict = 'matches' | 'changed' | 'missing';

export interface PackVerification {
  planUid: string;
  checkedAt: string;
  files: Array<{ path: string; sha256: string; now: string | null; verdict: FileVerdict }>;
  matches: number;
  changed: number;
  missing: number;
}

export class PackError extends Error {}

const SHA256 = /^[a-f0-9]{64}$/;
const MAX_PACK_FILES = 5000;

/** The files a pack names, validated as untrusted input. */
export function packFilesOf(raw: unknown): PackFile[] {
  if (!raw || typeof raw !== 'object') throw new PackError('That is not a sign-off pack');
  const p = raw as Record<string, unknown>;
  if (p.format !== PACK_FORMAT) throw new PackError('That is not a CodeTrellis sign-off pack');
  if (p.version !== PACK_VERSION) throw new PackError(`This pack is version ${String(p.version)}; this app reads version ${PACK_VERSION}`);
  if (!Array.isArray(p.files)) throw new PackError('The pack names no files');
  if (p.files.length > MAX_PACK_FILES) throw new PackError(`The pack names more than ${MAX_PACK_FILES} files`);
  return p.files.flatMap((f) => {
    if (!f || typeof f !== 'object') return [];
    const { path, sha256, takenAt } = f as Record<string, unknown>;
    if (typeof path !== 'string' || !path || path.length > 1024 || typeof sha256 !== 'string' || !SHA256.test(sha256)) return [];
    return [{ path, sha256, takenAt: takenAt === 'approval' ? 'approval' : 'submission' } as PackFile];
  });
}

export async function verifyPack(planUid: string, raw: unknown, now: Date = new Date()): Promise<PackVerification> {
  const files = packFilesOf(raw);
  const packPlan = (raw as { plan?: { uid?: unknown } }).plan?.uid;
  if (packPlan !== planUid) throw new PackError('This pack is for a different plan — open that plan to verify it');
  const plan = getPlan(planUid);
  if (!plan?.projectPath) throw new PackError('This plan is not associated with a project');
  const root = resolveTrustedProjectRoot(plan.projectPath, 'plan.projectPath');

  const results: PackVerification['files'] = [];
  for (const f of files) {
    let current: string | null = null;
    try {
      current = (await sha256FileWithin(root, f.path)).sha256;
    } catch {
      current = null; // gone, outside the project, or a link — none of which is the file judged
    }
    results.push({
      path: f.path, sha256: f.sha256, now: current,
      verdict: current === null ? 'missing' : current === f.sha256 ? 'matches' : 'changed',
    });
  }
  return {
    planUid,
    checkedAt: now.toISOString(),
    files: results,
    matches: results.filter((r) => r.verdict === 'matches').length,
    changed: results.filter((r) => r.verdict === 'changed').length,
    missing: results.filter((r) => r.verdict === 'missing').length,
  };
}

// ── The page ──────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** JSON that is safe inside a `<script type="application/json">`: no `<` survives to close it. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

const GLYPH: Record<SignoffRow['state'], string> = {
  met: '✓', submitted: '◐', sent_back: '↩', stale: '⚠', open: '○',
};

function rowHtml(r: SignoffRow): string {
  const evidence = r.evidence.length === 0
    ? '<p class="muted">No evidence was offered.</p>'
    : `<ul class="evidence">${r.evidence.map((e) => `<li><span class="path">${esc(e.path ?? 'note')}</span>${e.where ? ` — ${esc(e.where)}` : ''}${
      e.sha256AtSubmit ? `<br><code>sha256 ${esc(e.sha256AtSubmit)}</code>` : ''}</li>`).join('')}</ul>`;
  const notes = [
    r.submissionNote ? `<p><strong>${esc(r.submittedBy ?? 'The agent')} said:</strong> ${esc(r.submissionNote)}</p>` : '',
    r.decision?.note ? `<p><strong>Decision note:</strong> ${esc(r.decision.note)}</p>` : '',
    r.changedFiles.length ? `<p class="warn">Changed since it was approved: ${esc(r.changedFiles.join(', '))}</p>` : '',
  ].join('');
  return `<section class="criterion">
  <h3><span class="glyph">${GLYPH[r.state]}</span> ${esc(r.text)}</h3>
  <p class="state">${esc(stateWords(r))} · ${esc(r.kind)} · ${esc(r.policy === 'agent' ? 'the agent may approve' : r.policy === 'propose' ? 'the agent proposes, a person decides' : 'a person decides')}</p>
  <p class="decision">${esc(decisionWords(r))}</p>
  ${evidence}${notes}
</section>`;
}

function groupByItem(rows: SignoffRow[]): Array<{ title: string; ref: string; rows: SignoffRow[] }> {
  const groups = new Map<string, { title: string; ref: string; rows: SignoffRow[] }>();
  for (const r of rows) {
    const g = groups.get(r.itemUid) ?? { title: r.itemTitle, ref: r.itemRef, rows: [] };
    g.rows.push(r);
    groups.set(r.itemUid, g);
  }
  return [...groups.values()];
}

/**
 * The pack as a standalone page. No script runs in it — the only `<script>`
 * is `application/json` data — and every value from the plan is escaped,
 * because criterion text and notes are written by agents and people alike.
 */
export function renderPackHtml(pack: SignoffPack): string {
  const byPerson = pack.rows.filter((r) => !r.selfApproved);
  const selfApproved = pack.rows.filter((r) => r.selfApproved);
  const met = pack.rows.filter((r) => r.state === 'met').length;
  const title = `Sign-off pack — ${pack.plan.title}`;
  const sections = groupByItem(byPerson)
    .map((g) => `<h2>${esc(g.title)} <span class="ref">${esc(g.ref)}</span></h2>\n${g.rows.map(rowHtml).join('\n')}`)
    .join('\n');
  const self = selfApproved.length === 0 ? '' : `
<h2 class="self">Approved by the agent's own checks</h2>
<p class="muted">These criteria were left to the agent (agent policy), and it approved them itself when it submitted. No person signed them.</p>
${groupByItem(selfApproved).map((g) => `<h3 class="item">${esc(g.title)} <span class="ref">${esc(g.ref)}</span></h3>\n${g.rows.map(rowHtml).join('\n')}`).join('\n')}`;
  const fileRows = pack.files.map((f) => `<tr><td class="path">${esc(f.path)}</td><td><code>${esc(f.sha256)}</code></td><td>${f.takenAt === 'approval' ? 'at approval' : 'when offered'}</td></tr>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${esc(title)}</title>
<style>
  body { font: 13px/1.5 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #111; max-width: 820px; margin: 32px auto; padding: 0 24px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 28px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  h2.self { color: #7a4d00; }
  h3 { font-size: 14px; margin: 0 0 2px; }
  h3.item { margin-top: 16px; }
  .ref, .muted, .state { color: #666; font-weight: normal; font-size: 12px; }
  .criterion { border: 1px solid #e3e3e3; border-radius: 6px; padding: 10px 12px; margin: 8px 0; break-inside: avoid; }
  .decision { margin: 2px 0 6px; }
  .glyph { display: inline-block; width: 1.2em; }
  .evidence { margin: 4px 0; padding-left: 18px; }
  .path { font-family: ui-monospace, Menlo, Consolas, monospace; }
  code { font: 11px ui-monospace, Menlo, Consolas, monospace; color: #444; word-break: break-all; }
  .warn { color: #8a5a00; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  td, th { border-bottom: 1px solid #eee; padding: 4px 6px; text-align: left; vertical-align: top; }
  .summary { margin: 8px 0 0; color: #333; }
</style>
</head>
<body>
<h1>${esc(title)}</h1>
<p class="muted">Generated ${esc(pack.generatedAt.replace('T', ' ').slice(0, 16))} UTC by CodeTrellis · plan ${esc(pack.plan.uid)}</p>
<p class="summary">${met} of ${pack.rows.length} criteria met${selfApproved.length ? ` — ${selfApproved.length} of them by the agent's own checks, listed separately` : ''}.</p>
${sections || '<p class="muted">This plan has no acceptance criteria.</p>'}
${self}
<h2>Files and hashes</h2>
<p class="muted">Every file this pack vouches for, with the sha256 it had when it was judged. "Verify a pack" in CodeTrellis re-hashes each one and says which still match.</p>
<table><thead><tr><th>File</th><th>sha256</th><th>Taken</th></tr></thead><tbody>${fileRows || '<tr><td colspan="3" class="muted">No files.</td></tr>'}</tbody></table>
<script type="application/json" id="codetrellis-signoff-pack">${scriptJson(pack)}</script>
</body>
</html>
`;
}

/** The pack's data back out of a saved page (or the JSON itself). */
export function packFromText(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  const m = trimmed.match(/<script type="application\/json" id="codetrellis-signoff-pack">([\s\S]*?)<\/script>/);
  if (!m) throw new PackError('No sign-off pack data in that file');
  return JSON.parse(m[1]);
}
