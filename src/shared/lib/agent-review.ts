/**
 * Phase 33 C4b — an agent's review, checked by code (AGENT-CHECKS-AND-REVIEW
 * §1.2, §1.3).
 *
 * An agent reviews a change from a bundle CodeTrellis assembles, and reports
 * in one schema. The agent's confidence is not evidence; the citation is. A
 * finding must name a file in the change and lines that are in the diff, and
 * quote them; a rule finding must name a rule in scope. What fails any of
 * those is dropped and counted, never shown as a finding.
 *
 * Pure: a diff's text and a report in, kept and dropped findings out.
 */

export const FINDING_KINDS = ['rule', 'bug', 'risk', 'question', 'suspicious'] as const;
export type FindingKind = typeof FINDING_KINDS[number];

/** What the agent reports, as `report_review` takes it. */
export interface ReportedFinding {
  kind: string;
  file?: string | null;
  start_line?: number | null;
  end_line?: number | null;
  quote?: string | null;
  says: string;
  rule?: string | null;
  fix?: string | null;
  /** C6: what kind of problem, as a short slug the agent uses every time it sees it ("stripe-outside-client"). */
  topic?: string | null;
}

/** C6: a topic is a slug, like a rule's id, since a repeated one may become a rule. */
export const TOPIC_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

/** A finding that held: grounded in the change. */
export interface AgentFinding {
  kind: FindingKind;
  path: string | null;
  start: number | null;
  end: number | null;
  quote: string | null;
  says: string;
  rule: string | null;
  fix: string | null;
  /** C6: its topic, when the agent gave one. */
  topic?: string | null;
}

export type ReviewOutcome = 'pass' | 'findings' | 'inconclusive' | 'error';

/** An agent review, kept on its check run. */
export interface AgentReview {
  outcome: ReviewOutcome;
  /** Why it is inconclusive or an error, in words. */
  reason: string | null;
  /** Who reviewed: "claude-code", "codex", "your agent". */
  agent: string;
  findings: AgentFinding[];
  /** Each finding dropped, and why. */
  dropped: Array<{ says: string; why: string }>;
  /** Tool calls refused because they were not on the allowlist (C4). */
  refused: string[];
  /** C4: the skill this pass ran, when `codetrellis review` ran it. */
  pass?: string | null;
  /** C4: runs retried because the agent ended without reporting. */
  retries?: number;
  /** C5: what a second pass made of the findings, in words, when one ran. */
  verify?: string | null;
}

/** The new side of a change: for each file, its numbered lines the diff shows. */
export type DiffLines = Map<string, Map<number, string>>;

/**
 * The lines a unified diff shows on the new side (added and context), by
 * file and line number. Deleted files show none.
 */
export function parseUnifiedDiff(text: string): DiffLines {
  const out: DiffLines = new Map();
  let file: string | null = null;
  let line = 0;
  for (const raw of text.split('\n')) {
    if (raw.startsWith('+++ ')) {
      const p = raw.slice(4).trim();
      file = p === '/dev/null' ? null : p.replace(/^b\//, '');
      if (file && !out.has(file)) out.set(file, new Map());
      continue;
    }
    if (raw.startsWith('--- ') || raw.startsWith('diff ') || raw.startsWith('index ')) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) { line = Number(hunk[1]); continue; }
    if (!file || line === 0) continue;
    if (raw.startsWith('+') || raw.startsWith(' ')) { out.get(file)!.set(line, raw.slice(1)); line += 1; }
    // `-` lines are the old side; `\` is git's "no newline" note.
  }
  return out;
}

/** A whole new file: every line is in the change. */
export function wholeFile(text: string): Map<number, string> {
  const lines = text.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return new Map(lines.map((l, i) => [i + 1, l]));
}

const MAX_FINDINGS = 100;
const MAX_SPAN = 200;
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/**
 * Keep what is grounded in the change, drop the rest with why. `rules` are
 * the ids in scope. A question may stand without a citation; any citation it
 * gives must hold.
 */
export function verifyFindings(diff: DiffLines, rules: ReadonlySet<string>, reported: readonly ReportedFinding[]): { kept: AgentFinding[]; dropped: Array<{ says: string; why: string }> } {
  const kept: AgentFinding[] = [];
  const dropped: Array<{ says: string; why: string }> = [];
  const seen = new Set<string>();
  for (const r of reported.slice(0, MAX_FINDINGS)) {
    const says = text(r.says, 1000);
    const drop = (why: string) => dropped.push({ says: says ?? '(no words)', why });
    if (!says) { drop('it says nothing'); continue; }
    if (!(FINDING_KINDS as readonly string[]).includes(r.kind)) { drop(`its kind, ${String(r.kind)}, is not one of ${FINDING_KINDS.join(', ')}`); continue; }
    const kind = r.kind as FindingKind;
    const cited = !!(r.file || r.start_line || r.quote);
    let path: string | null = null;
    let start: number | null = null;
    let end: number | null = null;
    let quote: string | null = null;
    if (cited || kind !== 'question') {
      path = text(r.file, 500);
      const lines = path ? diff.get(path) : undefined;
      if (!path || !lines) { drop(path ? `${path} is not in the change` : 'it names no file'); continue; }
      start = Number.isSafeInteger(r.start_line) ? r.start_line! : null;
      end = Number.isSafeInteger(r.end_line) ? r.end_line! : start;
      if (start === null || end === null || end < start || end - start > MAX_SPAN) { drop('it names no line range in the file'); continue; }
      const span: string[] = [];
      for (let n = start; n <= end; n++) {
        const l = lines.get(n);
        if (l === undefined) break;
        span.push(l);
      }
      if (span.length !== end - start + 1) { drop(`lines ${start}–${end} of ${path} are not in the diff`); continue; }
      quote = text(r.quote, 2000);
      if (!quote) { drop('it quotes no code'); continue; }
      if (!squash(span.join('\n')).includes(squash(quote))) { drop(`its quote is not what lines ${start}–${end} of ${path} say`); continue; }
    }
    const rule = text(r.rule, 63);
    if (kind === 'rule' && (!rule || !rules.has(rule))) { drop(rule ? `the rule ${rule} is not in scope` : 'a rule finding names no rule'); continue; }
    const key = `${kind}|${path}|${start}|${end}|${squash(says)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const topic = typeof r.topic === 'string' && TOPIC_RE.test(r.topic.trim()) ? r.topic.trim() : null;
    kept.push({ kind, path, start, end, quote, says, rule: kind === 'rule' ? rule : rule && rules.has(rule) ? rule : null, fix: text(r.fix, 500), topic });
  }
  if (reported.length > MAX_FINDINGS) dropped.push({ says: `${reported.length - MAX_FINDINGS} more`, why: `a review reports at most ${MAX_FINDINGS} findings` });
  return { kept, dropped };
}

/**
 * The outcome from what held. A review that reported findings and had every
 * one dropped is inconclusive: it found something it could not show.
 */
export function reviewOutcome(reported: { inconclusive?: string | null; findings: readonly unknown[] }, kept: readonly AgentFinding[]): { outcome: ReviewOutcome; reason: string | null } {
  if (reported.inconclusive) return { outcome: 'inconclusive', reason: reported.inconclusive };
  if (kept.length > 0) return { outcome: 'findings', reason: null };
  if (reported.findings.length > 0) return { outcome: 'inconclusive', reason: 'none of its findings could be grounded in the change' };
  return { outcome: 'pass', reason: null };
}

const GLYPH: Record<FindingKind, string> = { rule: '✗', bug: '✗', risk: '⚠', question: '?', suspicious: '⚑' };

/** "⚠ 2 findings · ? 1 question · 1 dropped": a review in a few words. */
export function reviewWords(r: Pick<AgentReview, 'outcome' | 'reason' | 'findings' | 'dropped'>): string {
  const dropped = r.dropped.length ? ` · ${r.dropped.length} dropped` : '';
  if (r.outcome === 'error') return `✗ error: ${r.reason ?? 'the agent could not run'}`;
  if (r.outcome === 'inconclusive') return `? inconclusive: ${r.reason ?? 'no reason given'}${dropped}`;
  if (r.outcome === 'pass') return `✓ nothing found${dropped}`;
  const questions = r.findings.filter((f) => f.kind === 'question').length;
  const others = r.findings.length - questions;
  return [
    others ? `⚠ ${others} ${others === 1 ? 'finding' : 'findings'}` : null,
    questions ? `? ${questions} ${questions === 1 ? 'question' : 'questions'}` : null,
  ].filter(Boolean).join(' · ') + dropped;
}

/** "✗ bug · src/api.ts:12–14: …" — one finding in a line. */
export function agentFindingLine(f: AgentFinding): string {
  const where = f.path ? `${f.path}${f.start ? `:${f.start}${f.end && f.end !== f.start ? `–${f.end}` : ''}` : ''}` : 'the change';
  return `${GLYPH[f.kind]} ${f.kind}${f.rule ? ` (${f.rule})` : ''} · ${where}: ${f.says}${f.fix ? ` → ${f.fix}` : ''}`;
}

/** The limits a stored review is read back under. */
export function parseAgentReview(raw: unknown): AgentReview | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const outcome = (['pass', 'findings', 'inconclusive', 'error'] as const).find((o) => o === r.outcome);
  if (!outcome) return null;
  const findings = (Array.isArray(r.findings) ? r.findings : []).slice(0, MAX_FINDINGS).flatMap((x): AgentFinding[] => {
    const f = x && typeof x === 'object' ? x as Record<string, unknown> : {};
    const kind = (FINDING_KINDS as readonly string[]).includes(f.kind as string) ? f.kind as FindingKind : null;
    const says = text(f.says, 1000);
    if (!kind || !says) return [];
    const n = (v: unknown) => (Number.isSafeInteger(v) && (v as number) > 0 ? v as number : null);
    const p = typeof f.path === 'string' && f.path && !f.path.startsWith('/') && !f.path.split('/').includes('..') ? f.path.slice(0, 500) : null;
    const topic = typeof f.topic === 'string' && TOPIC_RE.test(f.topic) ? f.topic : null;
    return [{ kind, path: p, start: n(f.start), end: n(f.end), quote: text(f.quote, 2000), says, rule: text(f.rule, 63), fix: text(f.fix, 500), topic }];
  });
  const dropped = (Array.isArray(r.dropped) ? r.dropped : []).slice(0, 200).flatMap((x) => {
    const d = x && typeof x === 'object' ? x as Record<string, unknown> : {};
    const says = text(d.says, 1000);
    const why = text(d.why, 300);
    return says && why ? [{ says, why }] : [];
  });
  const refused = (Array.isArray(r.refused) ? r.refused : []).map((x) => text(x, 300)).filter((x): x is string => !!x).slice(0, 200);
  const retries = Number.isSafeInteger(r.retries) && (r.retries as number) > 0 ? Math.min(r.retries as number, 10) : 0;
  return { outcome, reason: text(r.reason, 500), agent: text(r.agent, 80) ?? 'an agent', findings, dropped, refused, pass: text(r.pass, 80), retries, verify: text(r.verify, 300) };
}
