/**
 * Phase 32 stage 0.2 — generate `docs/PHASE-32-VERIFICATION.md`.
 *
 *   npm run inventory          # regenerate the matrix
 *   npm run inventory:check    # exit 1 if the committed matrix is stale
 *
 * Tools come from the MCP server's own registry (`enumerateRegisteredTools`),
 * the same probe the authorisation coverage test uses, so a tool can't be
 * missing from the inventory because nobody typed it in.
 *
 * The human columns (behaviour verified, UX checked, notes) live in
 * `verification.json` beside this file and are merged in, so regenerating
 * never loses a judgement someone recorded.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DOMAINS,
  type DomainKey,
  type InventoryRow,
  type Surface,
  domainForComponent,
  domainForRoute,
  domainForRpc,
  domainForTool,
  extractRoutes,
  extractRpcMethods,
  extractSettingsSections,
  extractToolSections,
  filesMatching,
  filesReaching,
  helperChunks,
  quotedPattern,
  reconcileTools,
  routePattern,
} from './extract';

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs', 'PHASE-32-VERIFICATION.md');
const HUMAN = path.join(__dirname, 'verification.json');

interface HumanEntry {
  behaviour?: string;
  ux?: string;
  notes?: string;
}

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function walk(dir: string, keep: (f: string) => boolean): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('_tmp')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, keep));
    else if (keep(full)) out.push(full);
  }
  return out;
}

function loadTexts(files: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of files) m.set(path.relative(ROOT, f), fs.readFileSync(f, 'utf8'));
  return m;
}

async function registeredTools(): Promise<string[]> {
  // The same probe as mcp-authorisation.test.ts: a throwaway data dir, the
  // real database init, then ask the server what it registers.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-inventory-'));
  process.env.CODETRELLIS_DATA_DIR = tmp;
  try {
    const db = await import('../../src/backend/services/database');
    await db.initDatabase();
    const mcp = await import('../../src/backend/mcp/server');
    return mcp.enumerateRegisteredTools();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function cell(tests: string[] | null): string {
  if (tests === null) return 'n/a';
  return tests.length === 0 ? '✗ none' : String(tests.length);
}

function esc(s: string): string {
  return s.replace(/\|/g, '\\|');
}

export async function build(): Promise<{ markdown: string; unmapped: InventoryRow[] }> {
  const unitFiles = loadTexts([
    ...walk(path.join(ROOT, 'src'), (f) => /\.test\.tsx?$/.test(f)),
    // The inventory's own tests are fixtures full of example names, not coverage.
    ...walk(path.join(ROOT, 'tools'), (f) => /\.test\.tsx?$/.test(f) && !f.startsWith(__dirname)),
  ]);
  const harnessFiles = loadTexts(walk(path.join(ROOT, 'tests', 'e2e'), (f) => /\.test\.ts$/.test(f)));
  const helpers = walk(path.join(ROOT, 'tests', 'harness'), (f) => f.endsWith('.ts')).flatMap((f) =>
    helperChunks(fs.readFileSync(f, 'utf8')),
  );
  const harnessHits = (p: RegExp) => filesReaching(p, harnessFiles, helpers);

  const rows: (InventoryRow & { domain: DomainKey | null })[] = [];

  // REST
  for (const r of extractRoutes(read('src/backend/server.ts'))) {
    const p = routePattern(r.path);
    rows.push({
      surface: 'rest',
      id: `${r.method} ${r.path}`,
      domain: domainForRoute(r.path) as DomainKey,
      unitTests: filesMatching(p, unitFiles),
      harnessTests: harnessHits(p),
    });
  }

  // MCP
  const capSource = read('src/backend/services/mcp-capabilities.ts');
  const sections = extractToolSections(capSource);
  const registered = await registeredTools();
  const recon = reconcileTools(registered, [...sections.keys()]);
  const { TOOL_CAPABILITIES } = await import('../../src/backend/services/mcp-capabilities');
  for (const name of [...new Set(registered)].sort()) {
    const p = quotedPattern(name);
    rows.push({
      surface: 'mcp',
      id: name,
      domain: domainForTool(name, sections.get(name)) as DomainKey,
      detail: `${sections.get(name) ?? '?'} · ${TOOL_CAPABILITIES[name] ?? 'NO CAPABILITY ROW'}`,
      unitTests: filesMatching(p, unitFiles),
      harnessTests: harnessHits(p),
    });
  }

  // RPC
  for (const { method, capability } of extractRpcMethods(read('src/backend/services/peer-capabilities.ts'))) {
    const p = quotedPattern(method);
    rows.push({
      surface: 'rpc',
      id: method,
      domain: domainForRpc(method) as DomainKey,
      detail: capability,
      unitTests: filesMatching(p, unitFiles),
      harnessTests: harnessHits(p),
    });
  }

  // Components — tested by reachable.test.ts (rendered somewhere) and, from
  // 0.4/0.5, by the behaviour and UX columns; text search isn't meaningful.
  const compDir = path.join(ROOT, 'src', 'frontend', 'components');
  for (const f of walk(compDir, (x) => x.endsWith('.tsx') && !/\.test\.tsx$/.test(x))) {
    const rel = path.relative(compDir, f);
    rows.push({ surface: 'component', id: rel, domain: domainForComponent(rel) as DomainKey, unitTests: null, harnessTests: null });
  }

  // Mobile screens
  const mobileDir = path.join(ROOT, 'mobile', 'app');
  for (const f of walk(mobileDir, (x) => x.endsWith('.tsx'))) {
    rows.push({ surface: 'mobile', id: path.relative(mobileDir, f), domain: 'j', unitTests: null, harnessTests: null });
  }

  // Settings sections
  for (const s of extractSettingsSections(read('src/frontend/components/settings/SettingsModal.tsx'))) {
    rows.push({ surface: 'settings', id: s, domain: 'k', unitTests: null, harnessTests: null });
  }

  const unmapped = rows.filter((r) => !r.domain);
  const human: Record<string, HumanEntry> = fs.existsSync(HUMAN) ? JSON.parse(fs.readFileSync(HUMAN, 'utf8')) : {};

  return { markdown: render(rows as InventoryRow[], recon, human), unmapped };
}

const SURFACES: { key: Surface; title: string; testable: boolean }[] = [
  { key: 'rest', title: 'REST routes', testable: true },
  { key: 'mcp', title: 'MCP tools', testable: true },
  { key: 'rpc', title: 'Mobile RPC methods', testable: true },
  { key: 'component', title: 'Frontend components', testable: false },
  { key: 'mobile', title: 'Mobile screens', testable: false },
  { key: 'settings', title: 'Settings sections', testable: false },
];

function render(rows: InventoryRow[], recon: ReturnType<typeof reconcileTools>, human: Record<string, HumanEntry>): string {
  const L: string[] = [];
  L.push('# Phase 32 — Verification matrix');
  L.push('');
  L.push('> **Generated** by `npm run inventory` (`tools/inventory/`). Do not edit the');
  L.push('> tables by hand: the behaviour, UX and notes columns come from');
  L.push('> `tools/inventory/verification.json`, and `npm run inventory:check` fails when');
  L.push('> this file is stale. Stage 0 of [PHASE-32-EXECUTION.md](PHASE-32-EXECUTION.md).');
  L.push('');
  L.push('"Unit" and "Harness" count the test files that mention the row (a route path,');
  L.push('a quoted tool or method name). A mention is not proof of a meaningful test —');
  L.push('0.3 turns these into enforced guards and 0.4 checks behaviour — but "✗ none"');
  L.push('is proof of a gap.');
  L.push('');

  L.push('## Summary');
  L.push('');
  L.push('| Surface | Rows | No unit mention | No harness mention | Neither | Behaviour verified | UX checked |');
  L.push('|---|---|---|---|---|---|---|');
  for (const s of SURFACES) {
    const rs = rows.filter((r) => r.surface === s.key);
    const noUnit = s.testable ? rs.filter((r) => r.unitTests?.length === 0).length : NaN;
    const noHarness = s.testable ? rs.filter((r) => r.harnessTests?.length === 0).length : NaN;
    const neither = s.testable ? rs.filter((r) => r.unitTests?.length === 0 && r.harnessTests?.length === 0).length : NaN;
    const verified = rs.filter((r) => human[`${r.surface}:${r.id}`]?.behaviour).length;
    const ux = rs.filter((r) => human[`${r.surface}:${r.id}`]?.ux).length;
    const n = (x: number) => (Number.isNaN(x) ? 'n/a' : String(x));
    L.push(`| ${s.title} | ${rs.length} | ${n(noUnit)} | ${n(noHarness)} | ${n(neither)} | ${verified} | ${ux} |`);
  }
  L.push('');

  L.push('## By domain');
  L.push('');
  L.push('| Domain | REST | MCP | RPC | Components | Mobile | Settings |');
  L.push('|---|---|---|---|---|---|---|');
  for (const [k, title] of Object.entries(DOMAINS)) {
    const c = (s: Surface) => rows.filter((r) => r.surface === s && r.domain === k).length;
    L.push(`| 0.4${k} ${title} | ${c('rest')} | ${c('mcp')} | ${c('rpc')} | ${c('component')} | ${c('mobile')} | ${c('settings')} |`);
  }
  L.push('');

  L.push('## MCP tools: registry vs capability matrix');
  L.push('');
  L.push(`- Registered by the server: **${recon.registered}**`);
  L.push(`- Rows in \`TOOL_CAPABILITIES\`: **${recon.matrixRows}**`);
  L.push(`- Rows for tools the server does not register: ${recon.staleRows.length ? recon.staleRows.map((t) => `\`${t}\``).join(', ') : 'none'}`);
  L.push(`- Registered tools with no row (refused at call time): ${recon.unauthorised.length ? recon.unauthorised.map((t) => `\`${t}\``).join(', ') : 'none'}`);
  L.push('');

  for (const s of SURFACES) {
    const rs = rows
      .filter((r) => r.surface === s.key)
      .sort((a, b) => a.domain.localeCompare(b.domain) || a.id.localeCompare(b.id));
    L.push(`## ${s.title} (${rs.length})`);
    L.push('');
    L.push('| Domain | Item | Detail | Unit | Harness | Behaviour | UX | Notes |');
    L.push('|---|---|---|---|---|---|---|---|');
    for (const r of rs) {
      const h = human[`${r.surface}:${r.id}`] ?? {};
      L.push(
        `| ${r.domain} | \`${esc(r.id)}\` | ${esc(r.detail ?? '')} | ${cell(r.unitTests)} | ${cell(r.harnessTests)} | ${esc(h.behaviour ?? '')} | ${esc(h.ux ?? '')} | ${esc(h.notes ?? '')} |`,
      );
    }
    L.push('');
  }
  return L.join('\n');
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const { markdown, unmapped } = await build();
  if (unmapped.length) {
    console.error(`Rows with no domain (add them to tools/inventory/extract.ts):`);
    for (const r of unmapped) console.error(`  ${r.surface}  ${r.id}`);
    process.exit(1);
  }
  if (check) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (current !== markdown) {
      console.error('docs/PHASE-32-VERIFICATION.md is stale — run `npm run inventory` and commit it.');
      process.exit(1);
    }
    console.log('Verification matrix is up to date.');
    return;
  }
  fs.writeFileSync(OUT, markdown);
  console.log(`Wrote ${path.relative(ROOT, OUT)}`);
}

if (require.main === module) {
  main().then(
    () => process.exit(0),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
