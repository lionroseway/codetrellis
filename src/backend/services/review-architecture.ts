/**
 * Phase 33 V1 — what a change does to the architecture, at the top of every
 * review (AGENT-CHECKS-AND-REVIEW §2.1).
 *
 * A reviewer reads "adds a call from packages/web to POST /api/charges"
 * before a line of the text diff. Between two commits, with no plan needed:
 *  - imports added and removed **between folders** (a file's folder is its
 *    first two path segments: `packages/web`, `services/api`);
 *  - **outside packages** added or dropped, from the manifests the change
 *    touches (`package.json`, `requirements.txt`, `go.mod`);
 *  - **cross-system calls** added or dropped: HTTP calls and routes, SQL,
 *    as the per-language callsite extractors find them in the changed files;
 *  - **the rules it touches**: imports it adds across the base's rules, and
 *    what it does to the rulebook (R2).
 *
 * Read only. The import edges come from the comparison the review already
 * makes (`commit:<base>` against `commit:<head>`); the rest from git.
 */

import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Callsite, CallsiteKind } from '../../shared/types/ast';
import { compareSnapshots } from './snapshot-compare-service';
import { parseVirtualFile } from './ast-parser';
import { rulesAt } from './rules-at';
import { checkEdges, ruleWords } from './architecture-rule';
import { diffRules } from './rule-changes';

const MAX_PARSED = 200;
const MAX_BYTES = 512 * 1024;

export interface FolderLink { from: string; to: string; added: number; removed: number; examples: Array<{ from: string; to: string; change: 'added' | 'removed' }> }
export interface PackageChange { manifest: string; ecosystem: 'npm' | 'pip' | 'go'; added: string[]; removed: string[] }
export interface CallChange { file: string; line: number; kind: CallsiteKind; what: string; change: 'added' | 'removed' }
export interface RuleTouch { rule: string; words: string; kind: 'breach' | 'loosens' | 'tightens' | 'reworded'; detail: string }

export interface ArchitectureChange {
  base: string;
  head: string;
  /** False when the import edges of one side could not be read: the folder links are then unknown, not empty. */
  edgesKnown: boolean;
  folders: FolderLink[];
  packages: PackageChange[];
  calls: CallChange[];
  rules: RuleTouch[];
  /** One sentence per finding, most telling first. */
  words: string[];
}

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024, timeout: 20_000 });
  } catch { return null; }
}

/** The text of a file at a commit, or null when it is not there (or too large to read). */
function at(root: string, commit: string, rel: string): string | null {
  const text = git(root, ['show', `${commit}:./${rel}`]);
  return text !== null && text.length <= MAX_BYTES ? text : null;
}

/** A path's folder for the review: its first two segments (`packages/web`), its only one (`web`), or `.` at the root. Pure. */
export function folderOf(p: string): string {
  const parts = p.replace(/\\/g, '/').replace(/^\.\//, '').split('/');
  if (parts.length <= 1) return '.';
  return parts.slice(0, Math.min(2, parts.length - 1)).join('/');
}

/** Imports between folders, from file edges. Imports inside one folder are not architecture. Pure. */
export function folderLinks(added: ReadonlyArray<{ from: string; to: string }>, removed: ReadonlyArray<{ from: string; to: string }>): FolderLink[] {
  const links = new Map<string, FolderLink>();
  const note = (e: { from: string; to: string }, change: 'added' | 'removed') => {
    const from = folderOf(e.from);
    const to = folderOf(e.to);
    if (from === to) return;
    const k = `${from}>${to}`;
    let l = links.get(k);
    if (!l) links.set(k, (l = { from, to, added: 0, removed: 0, examples: [] }));
    l[change]++;
    if (l.examples.length < 3) l.examples.push({ ...e, change });
  };
  for (const e of added) note(e, 'added');
  for (const e of removed) note(e, 'removed');
  return [...links.values()].sort((a, b) => b.added - a.added || b.removed - a.removed || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

/** The outside packages a manifest names. Pure; an unreadable one names none. */
export function packagesIn(manifest: string, text: string | null): Set<string> {
  const out = new Set<string>();
  if (!text) return out;
  const base = path.posix.basename(manifest);
  if (base === 'package.json') {
    try {
      const j = JSON.parse(text) as Record<string, unknown>;
      for (const k of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        const deps = j[k];
        if (deps && typeof deps === 'object') for (const name of Object.keys(deps)) out.add(name);
      }
    } catch { /* not JSON: none */ }
  } else if (base === 'requirements.txt') {
    for (const line of text.split('\n')) {
      const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(line.replace(/#.*/, ''));
      if (m && !line.trim().startsWith('-')) out.add(m[1].toLowerCase());
    }
  } else if (base === 'go.mod') {
    let block = false;
    for (const line of text.split('\n')) {
      const t = line.replace(/\/\/.*/, '').trim();
      if (/^require\s*\($/.test(t)) { block = true; continue; }
      if (block && t === ')') { block = false; continue; }
      const m = block ? /^(\S+)\s+\S+/.exec(t) : /^require\s+(\S+)\s+\S+/.exec(t);
      if (m) out.add(m[1]);
    }
  }
  return out;
}

const ECOSYSTEM: Record<string, PackageChange['ecosystem']> = { 'package.json': 'npm', 'requirements.txt': 'pip', 'go.mod': 'go' };

function describeCall(c: Callsite): string | null {
  if ((c.kind === 'http_call' || c.kind === 'http_route') && c.urlPattern) return `${c.method ? `${c.method} ` : ''}${c.urlPattern}`;
  if (c.kind === 'sql_query') return c.sqlText?.trim().split(/\s+/).slice(0, 6).join(' ') ?? c.context ?? null;
  return null;
}

/** Calls in one file at each side, and the ones that differ. Pure given its parse. */
export function callChanges(file: string, before: Callsite[], after: Callsite[]): CallChange[] {
  const key = (c: Callsite) => `${c.kind}|${describeCall(c)}`;
  const was = new Set(before.map(key));
  const now = new Set(after.map(key));
  const out: CallChange[] = [];
  for (const c of after) {
    const what = describeCall(c);
    if (what && !was.has(key(c))) out.push({ file, line: c.line, kind: c.kind, what, change: 'added' });
  }
  for (const c of before) {
    const what = describeCall(c);
    if (what && !now.has(key(c))) out.push({ file, line: c.line, kind: c.kind, what, change: 'removed' });
  }
  return out;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const CALL_WORDS: Record<CallsiteKind, string> = {
  http_call: 'an HTTP call to', http_route: 'a route,', sql_query: 'SQL:', subprocess: 'a command:', env_lookup: 'an environment variable:',
};

/** What a change between two commits does to the architecture. Never throws; what cannot be read is said. */
export async function architectureOf(projectRoot: string, baseRef: string, headRef: string): Promise<ArchitectureChange | { error: string }> {
  const base = git(projectRoot, ['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`])?.trim();
  const head = git(projectRoot, ['rev-parse', '--verify', '--quiet', `${headRef}^{commit}`])?.trim();
  if (!base) return { error: `${baseRef} is not a commit in this repository` };
  if (!head) return { error: `${headRef} is not a commit in this repository` };

  // Imports, from the comparison a review already makes.
  const cmp = compareSnapshots(`commit:${base}`, `commit:${head}`, projectRoot);
  const rel = (p: string) => (path.isAbsolute(p) ? path.relative(projectRoot, p) : p).split(path.sep).join('/');
  const edgesKnown = cmp.ok && cmp.result.edgesComparable;
  const added = cmp.ok && edgesKnown ? cmp.result.diff.addedEdges.map((e) => ({ from: rel(e.source), to: rel(e.target) })) : [];
  const removed = cmp.ok && edgesKnown ? cmp.result.diff.removedEdges.map((e) => ({ from: rel(e.source), to: rel(e.target) })) : [];
  const folders = folderLinks(added, removed);

  // The files the change touches.
  const changed = (git(projectRoot, ['diff', '--name-only', '--no-renames', base, head, '--']) ?? '').split('\n').map((s) => s.trim()).filter(Boolean);

  const packages: PackageChange[] = [];
  for (const f of changed) {
    const eco = ECOSYSTEM[path.posix.basename(f)];
    if (!eco) continue;
    const was = packagesIn(f, at(projectRoot, base, f));
    const now = packagesIn(f, at(projectRoot, head, f));
    const a = [...now].filter((p) => !was.has(p)).sort();
    const r = [...was].filter((p) => !now.has(p)).sort();
    if (a.length || r.length) packages.push({ manifest: f, ecosystem: eco, added: a, removed: r });
  }

  const calls: CallChange[] = [];
  for (const f of changed.slice(0, MAX_PARSED)) {
    const before = at(projectRoot, base, f);
    const after = at(projectRoot, head, f);
    let b: Callsite[] = [];
    let h: Callsite[] = [];
    try { b = before !== null ? parseVirtualFile(f, before)?.callsites ?? [] : []; } catch { b = []; }
    try { h = after !== null ? parseVirtualFile(f, after)?.callsites ?? [] : []; } catch { h = []; }
    calls.push(...callChanges(f, b, h));
  }

  const rules: RuleTouch[] = [];
  const baseRules = await rulesAt(projectRoot, base);
  const headRules = await rulesAt(projectRoot, head);
  if (baseRules) {
    for (const b of checkEdges(baseRules.rules, added)) {
      const r = baseRules.rules.find((x) => x.id === b.rule)!;
      rules.push({ rule: r.id, words: ruleWords(r), kind: 'breach', detail: `${b.from} now imports ${b.to}, which it forbids` });
    }
    if (headRules) {
      for (const c of diffRules(baseRules.rules, headRules.rules, added)) {
        rules.push({ rule: c.rule, words: c.after ? ruleWords(c.after) : c.before ? ruleWords(c.before) : c.rule, kind: c.effect, detail: c.words });
      }
    }
  }

  const words: string[] = [];
  for (const r of rules.filter((x) => x.kind === 'breach' || x.kind === 'loosens')) words.push(r.kind === 'breach' ? `✗ ${r.detail} (${r.rule})` : r.detail);
  for (const c of calls.filter((x) => x.change === 'added')) words.push(`Adds ${CALL_WORDS[c.kind]} ${c.what} (${c.file}:${c.line})`);
  for (const p of packages) {
    if (p.added.length) words.push(`Adds ${plural(p.added.length, `${p.ecosystem} package`)}: ${p.added.join(', ')} (${p.manifest})`);
    if (p.removed.length) words.push(`Drops ${plural(p.removed.length, `${p.ecosystem} package`)}: ${p.removed.join(', ')} (${p.manifest})`);
  }
  for (const l of folders) {
    const bits = [l.added ? `${plural(l.added, 'import')} added` : '', l.removed ? `${plural(l.removed, 'import')} removed` : ''].filter(Boolean).join(', ');
    words.push(`${l.from} → ${l.to}: ${bits}`);
  }
  for (const c of calls.filter((x) => x.change === 'removed')) words.push(`Drops ${CALL_WORDS[c.kind]} ${c.what} (${c.file})`);
  for (const r of rules.filter((x) => x.kind === 'tightens' || x.kind === 'reworded')) words.push(r.detail);
  if (!edgesKnown) words.push('The imports between folders are not known: one side\'s import graph could not be read.');

  return { base, head, edgesKnown, folders, packages, calls, rules, words };
}

/** The section as markdown, for the top of a review or a pull request. */
export function architectureMarkdown(a: ArchitectureChange): string {
  const lines = ['### What this change does to the architecture', ''];
  const shown = a.words.filter((w) => !w.startsWith('The imports between folders are not known'));
  if (shown.length === 0) lines.push('No imports between folders, outside packages, cross-system calls or rules change.');
  else for (const w of a.words) lines.push(`- ${w}`);
  if (shown.length === 0 && !a.edgesKnown) lines.push('', '_The imports between folders are not known: one side\'s import graph could not be read._');
  return lines.join('\n');
}
