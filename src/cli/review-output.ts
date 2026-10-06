/**
 * Phase 33 C5 — what `codetrellis review` prints, for any host: words for a
 * terminal, markdown for a pull request comment or a job summary, SARIF 2.1.0
 * for code scanning, JSON for anything else. No host comes first.
 *
 * Pure: the passes in, text out.
 */

import type { SarifLog } from './sarif';

export interface ReviewFinding {
  kind: string;
  path: string | null;
  start: number | null;
  end: number | null;
  says: string;
  rule: string | null;
  fix: string | null;
}

export interface PassResult {
  pass: string;
  outcome: string;
  reason: string | null;
  says: string;
  run: string;
  failing: boolean;
  kept: ReviewFinding[];
  dropped: number;
  /** The strength of each rule in the bundle, by id. */
  strengths: Record<string, string>;
  /** C5: what the second pass made of the findings, in words, when one ran. */
  verify: string | null;
}

const GLYPH: Record<string, string> = { rule: '✗', bug: '✗', risk: '⚠', question: '?', suspicious: '⚑' };

const where = (f: ReviewFinding) => (f.path ? `${f.path}${f.start ? `:${f.start}${f.end && f.end !== f.start ? `–${f.end}` : ''}` : ''}` : 'the change');

/** "✗ rule (stripe-api-via-client) · src/api.ts:2: … → fix". */
export function findingWords(f: ReviewFinding): string {
  return `${GLYPH[f.kind] ?? '•'} ${f.kind}${f.rule ? ` (${f.rule})` : ''} · ${where(f)}: ${f.says}${f.fix ? ` → ${f.fix}` : ''}`;
}

export function reviewText(passes: readonly PassResult[], agent: string, code: number): string {
  const lines: string[] = [];
  for (const p of passes) {
    lines.push(`${p.pass}: ${agent}'s review: ${p.says}`);
    for (const f of p.kept) lines.push(`  ${findingWords(f)}`);
    if (p.verify) lines.push(`  ${p.verify}`);
  }
  lines.push('', `Kept as check runs; the Checks view opens each.${code ? ' Exit 3: --fail-on.' : ''}`);
  return lines.join('\n');
}

const md = (s: string) => s.replace(/([\\`*_[\]<>|])/g, '\\$1');

/** For a pull request comment or a job summary. Advisory in its own words. */
export function reviewMarkdown(passes: readonly PassResult[], agent: string): string {
  const out = ['### CodeTrellis review', '', `${md(agent)} reviewed the change on its own model, held to the review's contract; each finding cites the diff and was checked. Advisory.`, ''];
  for (const p of passes) {
    out.push(`**${md(p.pass)}**: ${md(p.says)}`, '');
    for (const f of p.kept) out.push(`- ${GLYPH[f.kind] ?? '•'} **${f.kind}**${f.rule ? ` (\`${f.rule}\`)` : ''} · \`${where(f)}\`: ${md(f.says)}${f.fix ? ` → ${md(f.fix)}` : ''}`);
    if (p.kept.length) out.push('');
    if (p.verify) out.push(`_${md(p.verify)}_`, '');
  }
  return out.join('\n').trimEnd() + '\n';
}

/**
 * As SARIF: one result per finding at its lines. A rule finding takes its
 * rule's strength (block an error, warn a warning); a bug a warning; a risk,
 * question or suspicious line a note. Questions with no place are left out:
 * SARIF has nowhere to put them, and the markdown says them.
 */
export function reviewSarif(passes: readonly PassResult[], opts: { version: string; root: string; agent: string }): SarifLog {
  const rules = new Map<string, SarifLog['runs'][number]['tool']['driver']['rules'][number]>();
  const results: Array<Record<string, unknown>> = [];
  for (const p of passes) {
    for (const f of p.kept) {
      if (!f.path) continue;
      const level = f.kind === 'rule' ? (p.strengths[f.rule ?? ''] === 'block' ? 'error' : 'warning') : f.kind === 'bug' ? 'warning' : 'note';
      const id = f.kind === 'rule' && f.rule ? f.rule : `review/${f.kind}`;
      if (!rules.has(id)) {
        rules.set(id, {
          id, name: id.replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : '')),
          shortDescription: { text: f.kind === 'rule' ? `The rule ${id}` : `An agent review's ${f.kind} finding` },
          defaultConfiguration: { level },
        });
      }
      results.push({
        ruleId: id,
        level,
        message: { text: `${p.pass}: ${f.says}${f.fix ? ` → ${f.fix}` : ''}` },
        locations: [{ physicalLocation: { artifactLocation: { uri: f.path, uriBaseId: 'SRCROOT' }, ...(f.start ? { region: { startLine: f.start, ...(f.end && f.end >= f.start ? { endLine: f.end } : {}) } } : {}) } }],
        partialFingerprints: { codetrellisReview: `${p.pass}|${f.kind}|${f.path}|${f.rule ?? ''}|${f.says}`.slice(0, 500) },
      });
    }
  }
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: { driver: { name: `CodeTrellis review (${opts.agent})`, informationUri: 'https://codetrellis.dev', version: opts.version, rules: [...rules.values()] } },
      originalUriBaseIds: { SRCROOT: { uri: `file://${opts.root.replace(/\\/g, '/').replace(/\/?$/, '/')}` } },
      results: results as unknown as SarifLog['runs'][number]['results'],
    }],
  };
}
