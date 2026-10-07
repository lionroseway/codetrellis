/**
 * Phase 33 C8 — one renderer (AGENT-CHECKS-AND-REVIEW §3.1).
 *
 * A rule and a finding are written in words once, here. The terminal, the
 * pull request (markdown and SARIF), the app and the phone render from these
 * words, so a person who has read one has read them all:
 *
 *   ✗ packages/web/src/api.ts:1 imports npm:stripe · stripe-via-wrapper (block)
 *     only packages/web/src/payments.ts may import npm:stripe
 *     → use packages/web/src/payments.ts instead
 *
 * The terminal groups by suite, then rule, then place; says the summary
 * first and the exit code last, in words; gives the fix its own line after
 * →; and carries glyph and word, never colour alone. Colour is added only
 * for a terminal that wants it, and the words are the same without it.
 *
 * Pure: a check's result in, text out.
 */

export type Strength = 'block' | 'warn' | 'guide';

/** An import a change adds across a rule, as `check_changes` reports it. */
export interface RuleFinding {
  path: string;
  imports: string;
  rule: string;
  /** The rule's statement: "only src/payments/index.ts may import npm:stripe". */
  words: string;
  because: string;
  strength: string;
  /** The suite the rule is kept in. */
  suite?: string;
  /** What to do instead, when the rule says: "use src/payments/index.ts instead". */
  fix?: string | null;
  /** Where in the file, when the renderer could read it. */
  line?: number | null;
  /** The import's own text there. */
  text?: string | null;
}

/** A rule the check judged by, so a suite can say how many hold. */
export interface CheckedRule { rule: string; suite: string; strength: string }

export interface RulebookFinding { rule: string; words: string; effect?: string; approval?: { ok?: boolean } | null }

/** A check's result: the shape `check_changes` returns and `codetrellis check --format json` prints. */
export interface CheckResult {
  ok: boolean;
  /** Every finding that fails it, one line each, in the order to act on them. */
  says: string[];
  files: number;
  base: string | null;
  rules: RuleFinding[];
  rulebook: RulebookFinding[];
  /** Said, not failing. */
  notes: string[];
  rulesNote?: string;
  /** C1: the part of the rulebook checked, when not all of it. */
  scope?: string;
  /** The rules judged by, for "✓ N rules hold". */
  checked?: CheckedRule[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ── A rule and a finding ────────────────────────────────────────────────

/** What to do instead, from the rule itself: the files that may, or the doors through it. */
export function ruleFix(rule: { kind?: string; only?: string[]; except: string[] }): string | null {
  if (rule.kind === 'package' && rule.only?.length) return `use ${rule.only.join(' or ')} instead`;
  if (rule.except.length) return `import ${rule.except.join(' or ')} instead`;
  return null;
}

/** The finding's own line, the one `says` and SARIF carry. */
export function findingLine(r: Pick<RuleFinding, 'path' | 'imports' | 'words' | 'because'>): string {
  return `${r.path} now imports ${r.imports}, which the rule “${r.words}” forbids${r.because ? `: ${r.because}` : ''}`;
}

/** Where and what: "packages/web/src/api.ts:1 imports npm:stripe". */
export function findingTitle(r: Pick<RuleFinding, 'path' | 'imports' | 'line'>): string {
  return `${r.path}${r.line ? `:${r.line}` : ''} imports ${r.imports}`;
}

/** What to do: the rule's fix, else its reason. */
export function findingNext(r: Pick<RuleFinding, 'fix' | 'because'>): string | null {
  return r.fix || r.because || null;
}

/** The rule's statement, with its reason when the next line is the fix rather than the reason. */
export function ruleLine(words: string, r: Pick<RuleFinding, 'fix' | 'because'> | undefined): string {
  return `${words}${r?.fix && r.because ? `: ${r.because}` : ''}`;
}

/** Whether a finding fails the check. */
export function fails(r: Pick<RuleFinding, 'strength'>, strict = false): boolean {
  return r.strength === 'block' || strict;
}

const GLYPH = { fail: '✗', warn: '⚠', hold: '✓' } as const;

// ── Groups ──────────────────────────────────────────────────────────────

export interface SuiteGroup {
  suite: string;
  blocks: number;
  warns: number;
  holds: number;
  /** Rule by rule, its findings in path order. */
  rules: Array<{ rule: string; words: string; strength: string; failing: boolean; findings: RuleFinding[] }>;
}

/** The rule findings by suite, then rule; suites with something to say first. */
export function suiteGroups(c: CheckResult): SuiteGroup[] {
  const failing = new Set(c.says);
  const groups = new Map<string, SuiteGroup>();
  const group = (suite: string) => {
    let g = groups.get(suite);
    if (!g) groups.set(suite, (g = { suite, blocks: 0, warns: 0, holds: 0, rules: [] }));
    return g;
  };
  for (const r of c.rules) {
    const g = group(r.suite ?? 'architecture');
    let entry = g.rules.find((x) => x.rule === r.rule);
    if (!entry) {
      entry = { rule: r.rule, words: r.words, strength: r.strength, failing: failing.has(`${GLYPH.fail} ${findingLine(r)}`), findings: [] };
      g.rules.push(entry);
      if (entry.failing) g.blocks += 1; else g.warns += 1;
    }
    entry.findings.push(r);
  }
  for (const k of c.checked ?? []) {
    if (k.strength === 'guide') continue;
    const g = group(k.suite);
    if (!g.rules.some((x) => x.rule === k.rule)) g.holds += 1;
  }
  for (const g of groups.values()) {
    g.rules.sort((a, b) => Number(b.failing) - Number(a.failing) || a.rule.localeCompare(b.rule));
    for (const r of g.rules) r.findings.sort((a, b) => a.path.localeCompare(b.path) || a.imports.localeCompare(b.imports));
  }
  return [...groups.values()].sort((a, b) => (b.blocks + b.warns) - (a.blocks + a.warns) || a.suite.localeCompare(b.suite));
}

/** "✗ 1 blocks · ⚠ 1 warns · ✓ 2 rules hold" */
export function suiteCounts(g: SuiteGroup): string {
  return [
    g.blocks ? `${GLYPH.fail} ${g.blocks} ${g.blocks === 1 ? 'blocks' : 'block'}` : null,
    g.warns ? `${GLYPH.warn} ${g.warns} ${g.warns === 1 ? 'warns' : 'warn'}` : null,
    g.holds ? `${GLYPH.hold} ${plural(g.holds, 'rule')} ${g.holds === 1 ? 'holds' : 'hold'}` : null,
  ].filter(Boolean).join(' · ');
}

/** The lines that fail it and are not a rule's: breakpoints, tests, tasks, docs, the baseline. */
export function otherFindings(c: CheckResult): string[] {
  const mine = new Set([
    ...c.rules.map((r) => `${GLYPH.fail} ${findingLine(r)}`),
    ...c.rulebook.map((b) => b.words),
  ]);
  return c.says.filter((s) => !mine.has(s));
}

/** The notes that are not a warn rule's finding, already shown under its suite. */
export function otherNotes(c: CheckResult): string[] {
  const mine = new Set(c.rules.map((r) => `${GLYPH.warn} ${findingLine(r)} (the rule warns; it does not fail the check)`));
  const rulebook = new Set(c.rulebook.map((b) => b.words));
  return c.notes.filter((n) => !mine.has(n) && !rulebook.has(n));
}

/** The rulebook's changes, each as the gate says it, failing or not. */
export function rulebookLines(c: CheckResult): string[] {
  return c.rulebook.map((b) => b.words);
}

/** What was checked: "2 changed files since main". */
export function whatWords(c: CheckResult): string {
  return `${plural(c.files, 'changed file')}${c.base ? ` since ${c.base}` : ''}`;
}

/** The first line. */
export function headline(c: CheckResult): string {
  const what = whatWords(c);
  if (c.scope) return c.ok ? `Conforms to ${c.scope}: ${what}. They add no import those rules forbid, and loosen none of them.` : `Does not conform to ${c.scope} (${what}):`;
  return c.ok
    ? `Conforms: ${what}. No breakpoint holds them, none of their tests fail or are older than the code, no done task fails its checks, no doc that describes them is stale, they add no import an architecture rule forbids, and they loosen no rule.`
    : `Does not conform (${what}):`;
}

/** The last line: the exit code, in words. */
export function exitWords(c: CheckResult): string {
  if (c.ok) return 'Nothing blocks this change (exit 0).';
  return `${plural(c.says.length, 'finding')} ${c.says.length === 1 ? 'blocks' : 'block'} this change (exit 3).`;
}

// ── The terminal ────────────────────────────────────────────────────────

const ANSI: Record<string, string> = { [GLYPH.fail]: '31', [GLYPH.warn]: '33', [GLYPH.hold]: '32', '■': '35' };

/** Colour each glyph (and bold a suite's name), for a terminal that wants it. The words do not change. */
function paint(line: string, color: boolean, bold = ''): string {
  if (!color) return line;
  let out = line.replace(/[✗⚠✓■]/g, (g) => `\x1b[${ANSI[g]}m${g}\x1b[0m`);
  if (bold && out.startsWith(bold)) out = `\x1b[1m${bold}\x1b[0m${out.slice(bold.length)}`;
  return out;
}

/** `codetrellis check`, in a terminal or a log: grouped by suite, summary first, exit last. */
export function renderText(c: CheckResult, opts: { color?: boolean } = {}): string {
  const color = opts.color === true;
  const lines: string[] = [headline(c)];
  const groups = suiteGroups(c);
  for (const g of groups) {
    lines.push('', paint(`${g.suite}  ${suiteCounts(g)}`, color, g.suite));
    for (const r of g.rules) {
      if (r.findings.length === 0) continue;
      const glyph = r.failing ? GLYPH.fail : GLYPH.warn;
      lines.push('', paint(`  ${glyph} ${r.rule}   ${ruleLine(r.words, r.findings[0])}`, color));
      for (const f of r.findings) {
        lines.push(`      ${findingTitle(f)}${f.text ? `   ${f.text.trim()}` : ''}`);
        const next = findingNext(f);
        if (next) lines.push(`      → ${next}`);
      }
    }
  }
  const rulebook = rulebookLines(c);
  if (rulebook.length) lines.push('', 'rulebook', ...rulebook.map((l) => paint(`  ${l}`, color)));
  const other = otherFindings(c);
  if (other.length) lines.push('', 'also', ...other.map((l) => paint(`  ${l}`, color)));
  const notes = otherNotes(c);
  if (notes.length) lines.push('', 'notes', ...notes.map((l) => paint(`  ${l}`, color)));
  if (c.rulesNote) lines.push('', c.rulesNote);
  lines.push('', exitWords(c));
  return lines.join('\n');
}

// ── The pull request ────────────────────────────────────────────────────

const code = (s: string) => `\`${s.replace(/`/g, 'ˋ')}\``;

/** `--format markdown`: the same content, for a pull request comment or a job summary. */
export function renderMarkdown(c: CheckResult): string {
  const lines: string[] = [
    `### CodeTrellis check: ${c.ok ? 'conforms' : 'does not conform'}${c.scope ? ` (${c.scope})` : ''}`,
    '',
    `${whatWords(c)} · ${exitWords(c)}`,
  ];
  for (const g of suiteGroups(c)) {
    lines.push('', `**${g.suite}** · ${suiteCounts(g)}`);
    for (const r of g.rules) {
      for (const f of r.findings) {
        lines.push('', `- ${r.failing ? GLYPH.fail : GLYPH.warn} **${code(findingTitle(f))}** · ${code(r.rule)} (${r.strength})  `, `  ${ruleLine(r.words, f)}  `);
        const next = findingNext(f);
        if (next) lines.push(`  → ${next}`);
      }
    }
  }
  const section = (title: string, items: string[]) => { if (items.length) lines.push('', `**${title}**`, '', ...items.map((l) => `- ${l}`)); };
  section('rulebook', rulebookLines(c));
  section('also', otherFindings(c));
  section('notes', otherNotes(c));
  if (c.rulesNote) lines.push('', `_${c.rulesNote}_`);
  return lines.join('\n');
}
