/**
 * Phase 33 C2 — the gate as SARIF 2.1.0, so any host shows the findings
 * where the code is (design §5.2). GitHub code scanning, GitLab and Azure
 * DevOps read it; no host comes first.
 *
 *     codetrellis check --format sarif > codetrellis.sarif
 *
 * Each finding is one result, at the line it is about where there is one: a
 * rule's breach at the import, a loosened rule at its suite file, a file's
 * tests, breakpoint or stale doc at the file. The words are the same words
 * the text output says. A rule at block is an error, one at warn a warning;
 * a loosening that carries a person's approval is a note.
 *
 * `toSarif` is pure given its `read` (tests pass files in); the CLI reads the
 * checkout.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Gate } from './conformity';
import { findingLine } from '../shared/lib/check-words';
import { findingAt, importLine } from '../shared/lib/import-line';

export { importLine };

type Level = 'error' | 'warning' | 'note';

interface SarifResult {
  ruleId: string;
  level: Level;
  message: { text: string };
  locations: Array<{ physicalLocation: { artifactLocation: { uri: string; uriBaseId: 'SRCROOT' }; region?: { startLine: number } } }>;
  partialFingerprints?: Record<string, string>;
}

interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  fullDescription?: { text: string };
  defaultConfiguration: { level: Level };
  helpUri?: string;
}

export interface SarifLog {
  $schema: string;
  version: '2.1.0';
  runs: Array<{
    tool: { driver: { name: string; informationUri: string; version: string; rules: SarifRule[] } };
    originalUriBaseIds: { SRCROOT: { uri: string } };
    results: SarifResult[];
  }>;
}

const SCHEMA = 'https://json.schemastore.org/sarif-2.1.0.json';
const INFO = 'https://codetrellis.dev';

const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? v as Record<string, unknown> : {});
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function at(uri: string, line?: number | null): SarifResult['locations'][number] {
  return { physicalLocation: { artifactLocation: { uri, uriBaseId: 'SRCROOT' }, ...(line ? { region: { startLine: line } } : {}) } };
}

/**
 * The gate as a SARIF log. `read` returns a repository file's text, or null;
 * `ruleFile` finds the suite file a rule is written in (for a loosening).
 */
export function toSarif(
  g: Gate,
  opts: { version: string; root: string; read: (rel: string) => string | null; ruleFile: (ruleId: string) => string },
): SarifLog {
  const rules = new Map<string, SarifRule>();
  const results: SarifResult[] = [];
  const rule = (r: SarifRule) => { if (!rules.has(r.id)) rules.set(r.id, r); };

  for (const raw of g.rules) {
    const r = asObj(raw);
    const file = str(r.path);
    const id = str(r.rule);
    const imports = str(r.imports);
    if (!file || !id || !imports) continue;
    const level: Level = r.strength === 'warn' ? 'warning' : 'error';
    rule({
      id: `rule/${id}`, name: id,
      shortDescription: { text: str(r.words) ?? id },
      ...(str(r.because) ? { fullDescription: { text: str(r.because)! } } : {}),
      defaultConfiguration: { level }, helpUri: INFO,
    });
    const text = opts.read(file);
    results.push({
      ruleId: `rule/${id}`, level,
      // C8: the finding's own line, as every surface says it, and what to do after →.
      message: { text: `${findingLine({ path: file, imports, words: str(r.words) ?? id, because: str(r.because) ?? '' })}${str(r.fix) ? ` → ${str(r.fix)}` : ''}` },
      locations: [at(file, text === null ? null : findingAt(text, imports, (r as { line_found?: number }).line_found))],
      partialFingerprints: { 'codetrellis/import': `${id}:${file}>${imports}` },
    });
  }

  for (const raw of g.rulebook) {
    const c = asObj(raw);
    const id = str(c.rule);
    const words = str(c.words);
    if (!id || !words) continue;
    const approved = asObj(c.approval).ok === true;
    const level: Level = c.effect === 'loosens' && !approved ? 'error' : 'note';
    rule({ id: 'rulebook/change', name: 'rulebook-change', shortDescription: { text: 'A change to the rulebook' }, defaultConfiguration: { level: 'error' }, helpUri: INFO });
    results.push({ ruleId: 'rulebook/change', level, message: { text: words }, locations: [at(opts.ruleFile(id))] });
  }

  for (const raw of g.breakpoints) {
    const b = asObj(raw);
    const file = str(b.path);
    if (!file) continue;
    rule({ id: 'codetrellis/breakpoint', name: 'breakpoint', shortDescription: { text: 'A person asked to be asked before this changes' }, defaultConfiguration: { level: 'error' }, helpUri: INFO });
    results.push({ ruleId: 'codetrellis/breakpoint', level: 'error', message: { text: `${str(b.by) ?? 'A person'} set a breakpoint here${str(b.note) ? ` (“${str(b.note)}”)` : ''}; ask them before changing it` }, locations: [at(file)] });
  }

  for (const raw of g.tests) {
    const t = asObj(raw);
    const file = str(t.path);
    if (!file) continue;
    rule({ id: 'codetrellis/tests', name: 'tests', shortDescription: { text: 'A changed file whose tests fail, or are older than the code' }, defaultConfiguration: { level: 'error' }, helpUri: INFO });
    results.push({ ruleId: 'codetrellis/tests', level: t.state === 'stale' ? 'warning' : 'error', message: { text: str(t.says) ?? 'its tests do not pass' }, locations: [at(file)] });
  }

  for (const raw of g.docs) {
    const d = asObj(raw);
    const files = Array.isArray(d.files) ? d.files.filter((f): f is string => typeof f === 'string') : [];
    rule({ id: 'codetrellis/doc', name: 'stale-doc', shortDescription: { text: 'A system doc describes a file that changed after it was verified' }, defaultConfiguration: { level: 'warning' }, helpUri: INFO });
    for (const f of files) {
      results.push({ ruleId: 'codetrellis/doc', level: 'warning', message: { text: `The system doc "${str(d.title) ?? ''}" describes ${f}, which changed after it was verified at ${str(d.verified_at) ?? '?'}` }, locations: [at(f)] });
    }
  }

  for (const raw of g.criteria) {
    const c = asObj(raw);
    rule({ id: 'codetrellis/criterion', name: 'criterion', shortDescription: { text: 'A task marked done fails its criterion' }, defaultConfiguration: { level: 'error' }, helpUri: INFO });
    const findings = Array.isArray(c.findings) ? c.findings.filter((f): f is string => typeof f === 'string') : [];
    // A task has no line in the code: SARIF wants a location, so it is the plan's folder.
    results.push({
      ruleId: 'codetrellis/criterion', level: 'error',
      message: { text: `"${str(c.task) ?? ''}" is marked done, but its criterion "${str(c.criterion) ?? ''}" fails${findings.length ? `: ${findings.join('; ')}` : ''}` },
      locations: [at('.codetrellis/')],
    });
  }

  return {
    $schema: SCHEMA,
    version: '2.1.0',
    runs: [{
      tool: { driver: { name: 'CodeTrellis', informationUri: INFO, version: opts.version, rules: [...rules.values()] } },
      originalUriBaseIds: { SRCROOT: { uri: `file://${opts.root.replace(/\\/g, '/').replace(/\/?$/, '/')}` } },
      results,
    }],
  };
}

/** The suite file that has a rule, by its id, else the default suite's. */
export function ruleFileIn(root: string): (ruleId: string) => string {
  return (ruleId) => {
    const dir = path.join(root, '.codetrellis', 'rules');
    try {
      for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.yaml')).sort()) {
        const text = fs.readFileSync(path.join(dir, name), 'utf8');
        if (new RegExp(`^\\s*-?\\s*id:\\s*['"]?${ruleId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\\s*$`, 'm').test(text)) return `.codetrellis/rules/${name}`;
      }
    } catch { /* no rules folder */ }
    return '.codetrellis/rules/architecture.yaml';
  };
}
