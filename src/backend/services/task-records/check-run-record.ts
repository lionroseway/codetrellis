/**
 * A check-run record: what one check said, where it ran, by whom, against
 * which commit and rulebook (Phase 33 C7, AGENT-CHECKS-AND-REVIEW §3.2).
 *
 * Every check is a run, from the CLI, CI, the app or an agent's MCP call.
 * With task state shared (C3.1), a device also writes its latest check run
 * into the plans folder, as test runs are (Phase 32 D1.5a):
 *
 *     .codetrellis/runs/checks/<writer>-<counter>.yaml
 *
 * written once and never edited; a device removes its own older ones when it
 * writes a new one. A run made in CI then appears in a teammate's app after a
 * pull, saying where it ran.
 *
 * Untrusted input, like every record: parsed here with limits; a path in it
 * is a name to show and never one to open; who ran it, and where, are claims
 * until its signature verifies (C3.3). Pure: no file is read or written here.
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { canonicalJson, parseSignature, type RecordSignature } from './signing';
import type { SignedPart } from './record';
import { isRunPath } from './run-record';

/** Signed into every check-run record, so one can never be read as another kind. */
const KIND = 'check-run';

/** One import across a rule, as the run found it. */
export interface CheckRunFinding {
  rule: string;
  suite: string;
  path: string;
  imports: string;
  strength: 'block' | 'warn';
  /** Whether it failed the run (a warn finding fails only a strict run). */
  failing: boolean;
  /** The rule's statement, and what to do instead. */
  words: string;
  fix: string | null;
}

export interface CheckRunOutcome {
  ok: boolean;
  /** Changed files checked. */
  files: number;
  /** Findings that failed it, and rule findings that only warned. */
  blocks: number;
  warns: number;
}

export interface CheckRunRecord {
  writer: string;
  /** The person whose device it is, as that device says. A claim. */
  name: string;
  counter: number;
  /** When it ran (ms). */
  at: number;
  /** Who asked: an agent, the CLI as an agent, or the person. */
  by: { author: string; authorType: string };
  /** Where it ran, in words: "GitHub Actions", "a terminal", "the app", "claude-code's session". */
  ranIn: string;
  /** The commit checked, and what differed from it then. */
  commit: string | null;
  dirty: string[];
  /** The base it was judged against, as given, and the commit it was. */
  base: string | null;
  /** The commit whose rulebook judged it: the base's (R2), or null when the work's own. */
  rulebook: string | null;
  /** C1: the part of the rulebook checked, in words, or null for all of it. */
  scope: string | null;
  strict: boolean;
  outcome: CheckRunOutcome;
  /** Every line that failed it, as the gate says them. */
  says: string[];
  findings: CheckRunFinding[];
}

export const MAX_CHECK_RUN_BYTES = 512 * 1024;
const MAX_SAYS = 200;
const MAX_FINDINGS = 1_000;
const MAX_DIRTY = 500;
const WRITER = /^[a-f0-9]{8,32}$/;
const SHA = /^[a-f0-9]{40}$/;

const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null);
const count = (v: unknown): number => (Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : 0);

function bodyOf(r: CheckRunRecord) {
  return {
    kind: KIND, writer: r.writer, name: r.name, counter: r.counter, at: new Date(r.at).toISOString(),
    by: r.by, ranIn: r.ranIn, commit: r.commit, dirty: r.dirty, base: r.base, rulebook: r.rulebook, scope: r.scope, strict: r.strict,
    outcome: r.outcome, says: r.says,
    findings: r.findings.map((f) => ({ rule: f.rule, suite: f.suite, path: f.path, imports: f.imports, strength: f.strength, failing: f.failing, words: f.words, fix: f.fix })),
  };
}

/** The exact bytes a check-run record's signature is over. */
export function checkRunBytes(r: CheckRunRecord): string {
  return canonicalJson(bodyOf(r));
}

export function serializeCheckRun(r: CheckRunRecord, signature?: RecordSignature | null): string {
  const body = signature ? { ...bodyOf(r), signature } : bodyOf(r);
  return `# CodeTrellis: one device's latest check run, where it ran, and what it said.\n${stringifyYaml(body, { lineWidth: 0 })}`;
}

/** A check-run record from a file's text, or why not. */
export function parseCheckRun(source: string): { record: CheckRunRecord; signed: SignedPart } | { error: string } {
  if (Buffer.byteLength(source, 'utf8') > MAX_CHECK_RUN_BYTES) return { error: 'larger than a check-run record can be' };
  let raw: unknown;
  try { raw = parseYaml(source, { maxAliasCount: 0 }); } catch { return { error: 'not YAML' }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'not a record' };
  const { signature: rawSignature, ...r } = raw as Record<string, unknown>;
  if (r.kind !== KIND) return { error: 'not a check-run record' };
  const writer = typeof r.writer === 'string' && WRITER.test(r.writer) ? r.writer : null;
  if (!writer) return { error: 'no writer' };
  const counter = Number.isSafeInteger(r.counter) && (r.counter as number) > 0 ? (r.counter as number) : null;
  if (!counter) return { error: 'no counter' };
  const at = typeof r.at === 'string' ? Date.parse(r.at) : NaN;
  if (!Number.isFinite(at)) return { error: 'no time' };
  const by = r.by && typeof r.by === 'object' ? r.by as Record<string, unknown> : {};
  const o = r.outcome && typeof r.outcome === 'object' ? r.outcome as Record<string, unknown> : {};
  const findings: CheckRunFinding[] = [];
  for (const f of Array.isArray(r.findings) ? r.findings.slice(0, MAX_FINDINGS) : []) {
    const ff = f && typeof f === 'object' ? f as Record<string, unknown> : {};
    const rule = text(ff.rule, 63);
    const imports = text(ff.imports, 300);
    if (!rule || !imports || !isRunPath(ff.path)) continue;
    findings.push({
      rule, suite: text(ff.suite, 63) ?? 'architecture', path: ff.path as string, imports,
      strength: ff.strength === 'warn' ? 'warn' : 'block', failing: ff.failing === true,
      words: text(ff.words, 500) ?? rule, fix: text(ff.fix, 500),
    });
  }
  return {
    signed: { bytes: canonicalJson(r), signature: parseSignature(rawSignature) },
    record: {
      writer,
      name: text(r.name, 120) ?? 'someone',
      counter,
      at,
      by: { author: text(by.author, 120) ?? 'someone', authorType: text(by.authorType, 40) ?? 'unknown' },
      ranIn: text(r.ranIn, 80) ?? 'somewhere',
      commit: typeof r.commit === 'string' && SHA.test(r.commit) ? r.commit : null,
      dirty: (Array.isArray(r.dirty) ? r.dirty : []).filter(isRunPath).slice(0, MAX_DIRTY),
      base: text(r.base, 200),
      rulebook: typeof r.rulebook === 'string' && SHA.test(r.rulebook) ? r.rulebook : null,
      scope: text(r.scope, 300),
      strict: r.strict === true,
      outcome: { ok: o.ok === true, files: count(o.files), blocks: count(o.blocks), warns: count(o.warns) },
      says: (Array.isArray(r.says) ? r.says : []).map((s) => text(s, 1000)).filter((s): s is string => !!s).slice(0, MAX_SAYS),
      findings,
    },
  };
}

/** "✗ 2 block · ⚠ 1 warns", "✓ conforms" — a run's outcome in a few words. */
export function outcomeWords(o: CheckRunOutcome): string {
  if (o.ok && o.warns === 0) return '✓ conforms';
  const parts = [
    o.blocks ? `✗ ${o.blocks} ${o.blocks === 1 ? 'blocks' : 'block'}` : null,
    o.warns ? `⚠ ${o.warns} ${o.warns === 1 ? 'warns' : 'warn'}` : null,
  ].filter(Boolean);
  return o.ok ? `✓ conforms · ${parts.join(' · ')}` : parts.join(' · ');
}

export const CHECK_RUN_LIMITS = { MAX_SAYS, MAX_FINDINGS, MAX_DIRTY };
