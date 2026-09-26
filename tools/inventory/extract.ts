/**
 * Phase 32 stage 0.2 — the inventory's pure parts.
 *
 * Everything here takes source text or names and returns data, so it can be
 * tested without booting anything. `run.ts` does the I/O: it reads the
 * sources, asks the MCP server what it actually REGISTERS (not a list
 * someone typed), and writes `docs/PHASE-32-VERIFICATION.md`.
 *
 * Why an inventory at all: Phase 32 stage 0 is "don't trust what we have".
 * Every surface a user or agent can reach gets a row, a domain, and — in
 * 0.3 onwards — evidence that it is tested and works.
 */

export type Surface = 'rest' | 'mcp' | 'rpc' | 'component' | 'mobile' | 'settings';

/** The stage 0.4 sweep domains (PHASE-32-EXECUTION.md §3). */
export const DOMAINS = {
  a: 'Project and scan',
  b: 'Graph',
  c: 'Plans and items',
  d: 'Criteria and sign-off',
  e: 'Brief and viewer',
  f: 'Channels and presence',
  g: 'Agents and MCP',
  h: 'Drift, governance, review',
  i: 'Terminals and audio',
  j: 'Mobile surface',
  k: 'Settings, updates, privacy',
  l: 'System docs and intake',
} as const;

export type DomainKey = keyof typeof DOMAINS;

export interface InventoryRow {
  surface: Surface;
  /** Stable key: `GET /api/plans/:uid`, a tool name, an RPC method, a path. */
  id: string;
  domain: DomainKey;
  /** Extra context, e.g. the capability a tool or method needs. */
  detail?: string;
  /** Test files that mention this row. `null` = not measurable this way. */
  unitTests: string[] | null;
  harnessTests: string[] | null;
}

// ── Extraction ──────────────────────────────────────────────────────────────

export interface Route {
  method: string;
  path: string;
}

/** Every `app.<verb>('<path>'` in the Express server source. */
export function extractRoutes(serverSource: string): Route[] {
  const re = /\bapp\.(get|post|put|patch|delete)\(\s*(['"`])(.+?)\2/gs;
  const out: Route[] = [];
  for (const m of serverSource.matchAll(re)) {
    out.push({ method: m[1].toUpperCase(), path: m[3] });
  }
  return out;
}

/**
 * Tool → the `// ── <file>-tools ──` section it sits under in
 * `TOOL_CAPABILITIES`. The matrix is grouped by registering file, so the
 * section is the tool's home file.
 */
export function extractToolSections(capabilitiesSource: string): Map<string, string> {
  const start = capabilitiesSource.indexOf('TOOL_CAPABILITIES');
  const end = capabilitiesSource.indexOf('});', start);
  const body = capabilitiesSource.slice(start, end);
  const out = new Map<string, string>();
  let section = 'unknown';
  for (const line of body.split('\n')) {
    const heading = line.match(/\/\/\s*──\s*([a-z-]+)\s/);
    if (heading) {
      section = heading[1].replace(/-tools$/, '');
      continue;
    }
    const row = line.match(/^\s*['"]?([a-z_][a-z0-9_]*)['"]?\s*:\s*'([a-z]+)'/);
    if (row) out.set(row[1], section);
  }
  return out;
}

/** Every `'area.method': '<capability>'` row in `METHOD_CAPABILITIES`. */
export function extractRpcMethods(peerCapabilitiesSource: string): { method: string; capability: string }[] {
  const start = peerCapabilitiesSource.indexOf('METHOD_CAPABILITIES');
  const end = peerCapabilitiesSource.indexOf('});', start);
  const body = peerCapabilitiesSource.slice(start, end);
  const out: { method: string; capability: string }[] = [];
  for (const m of body.matchAll(/^\s*'([a-zA-Z]+\.[a-zA-Z.]+)'\s*:\s*'([a-z]+)'/gm)) {
    out.push({ method: m[1], capability: m[2] });
  }
  return out;
}

/** The `type Section = 'a' | 'b' …` union in the settings modal. */
export function extractSettingsSections(settingsSource: string): string[] {
  const m = settingsSource.match(/type Section\s*=\s*([^;]+);/);
  if (!m) return [];
  return [...m[1].matchAll(/'([a-z-]+)'/g)].map((x) => x[1]);
}

// ── Domains ─────────────────────────────────────────────────────────────────

/** First path segment after `/api/` → domain. */
const REST_DOMAINS: Record<string, DomainKey> = {
  project: 'a', 'project-config': 'a', 'recent-projects': 'a', 'auto-detect': 'a', fs: 'a',
  identity: 'a', 'onboarding-state': 'a', stats: 'a', health: 'a', 'build-info': 'a', git: 'a',
  'architecture-summary': 'b', dependencies: 'b', symbols: 'b', file: 'b', trellis: 'b',
  playback: 'b', 'cross-system': 'b', systems: 'b', coverage: 'b', diff: 'b',
  plans: 'c', items: 'c', tasks: 'c', 'plan-docs': 'c', 'plan-history': 'c', 'plan-phases': 'c',
  'plan-templates': 'c', comments: 'c', attachments: 'c', refs: 'c', 'team-activity': 'c',
  contributions: 'c', 'contributor-branch': 'c', pantry: 'c',
  criteria: 'd',
  artefacts: 'e',
  channels: 'f', presence: 'f', 'screenshot-response': 'f',
  agent: 'g', mcp: 'g', sessions: 'g', sensors: 'g',
  baseline: 'h', comparands: 'h', compare: 'h', conflicts: 'h', freeze: 'h',
  terminals: 'i', audio: 'i',
  pairing: 'j', peers: 'j', sync: 'j',
  settings: 'k', updates: 'k', logs: 'k', power: 'k',
  'system-docs': 'l',
};

export function domainForRoute(path: string): DomainKey | null {
  const seg = path.startsWith('/api/') ? path.split('/')[2] : path.split('/')[1];
  return REST_DOMAINS[seg] ?? null;
}

/** Registering file → domain, with name overrides for the big mixed files. */
const TOOL_FILE_DOMAINS: Record<string, DomainKey> = {
  architecture: 'b', graph: 'b',
  plan: 'c', 'plan-item': 'c', contribution: 'c',
  channel: 'f', presence: 'f',
  session: 'g', ui: 'g', budget: 'g',
  'project-config': 'a',
  drift: 'h', governance: 'h', review: 'h', git: 'h',
  terminal: 'i', audio: 'i',
  mobile: 'j', peer: 'j',
  'system-docs': 'l', intake: 'l',
};

export function domainForTool(name: string, section: string | undefined): DomainKey | null {
  if (/criteri|signoff|worklist|run_checks|approve_gate/.test(name)) return 'd';
  if (/brief|material|artefact/.test(name)) return 'e';
  return section ? TOOL_FILE_DOMAINS[section] ?? null : null;
}

const RPC_DOMAINS: Record<string, DomainKey> = {
  project: 'a', fs: 'a', diagnostics: 'a',
  graph: 'b', changes: 'b',
  plan: 'c', item: 'c', comment: 'c',
  criteria: 'd', criterion: 'd',
  artefact: 'e',
  channel: 'f', input: 'f',
  deviation: 'h', review: 'h',
  terminal: 'i',
  settings: 'k', power: 'k',
  sysdoc: 'l',
};

/**
 * RPC methods are all part of the mobile surface (domain j) for the sweep,
 * but the area they act on decides which domain's journeys cover them.
 * `domainForRpc` returns the area; the matrix shows both.
 */
export function domainForRpc(method: string): DomainKey | null {
  return RPC_DOMAINS[method.split('.')[0]] ?? null;
}

const COMPONENT_DIR_DOMAINS: Record<string, DomainKey> = {
  graph: 'b', inspector: 'b',
  plan: 'c',
  artefact: 'e', brief: 'e',
  presence: 'f',
  layout: 'g', guide: 'g',
  terminal: 'i', audio: 'i',
  pairing: 'j',
  settings: 'k',
  'system-docs': 'l',
};

/** `plan/v2/PlanSwitcher.tsx` → its top directory's domain; root files → g. */
export function domainForComponent(relPath: string): DomainKey | null {
  const parts = relPath.split('/');
  if (parts.length === 1) return 'g';
  return COMPONENT_DIR_DOMAINS[parts[0]] ?? null;
}

// ── Test references ─────────────────────────────────────────────────────────

/**
 * A pattern that finds a route in test source, in a string or a template
 * literal: `:param` matches any one segment (including `${id}`), and the
 * route must end where the string ends or a query begins — so `/api/plans`
 * does not match a test of `/api/plans/${uid}`.
 */
export function routePattern(path: string): RegExp {
  const escaped = path
    .split('/')
    .map((seg) => (seg.startsWith(':') ? '[^/\'"`?]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`['"\`]${escaped}(?=['"\`?])`);
}

/** A quoted name: `'get_brief'`, `"plan.list"`, `` `x` ``. */
export function quotedPattern(name: string): RegExp {
  return new RegExp(`['"\`]${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`);
}

export function filesMatching(pattern: RegExp, files: Map<string, string>): string[] {
  const hits: string[] = [];
  for (const [file, text] of files) if (pattern.test(text)) hits.push(file);
  return hits.sort();
}

/**
 * Test helpers call routes and tools on a test's behalf — `client.getPlan(uid)`
 * hits `GET /api/plans/:uid` — so a plain text search of test files misses
 * them. This splits a helper module into `{ name, body }` chunks, one per
 * method, so a test calling `.getPlan(` can be credited with whatever that
 * method's body reaches.
 */
export function helperChunks(source: string): { name: string; body: string }[] {
  const re = /^[ \t]+(?:async[ \t]+)?([a-zA-Z_]\w*)[ \t]*\([^)]*\)[ \t]*(?::[^{\n]+)?\{/gm;
  const heads = [...source.matchAll(re)].filter((m) => !['if', 'for', 'while', 'switch', 'catch', 'function'].includes(m[1]));
  return heads.map((m, i) => ({
    name: m[1],
    body: source.slice(m.index!, i + 1 < heads.length ? heads[i + 1].index! : source.length),
  }));
}

/**
 * Test files that reach `pattern`, directly or through a helper method whose
 * body matches it.
 */
export function filesReaching(
  pattern: RegExp,
  files: Map<string, string>,
  helpers: { name: string; body: string }[],
): string[] {
  const viaHelpers = helpers.filter((h) => pattern.test(h.body)).map((h) => new RegExp(`\\.${h.name}\\(`));
  const hits: string[] = [];
  for (const [file, text] of files) {
    if (pattern.test(text) || viaHelpers.some((re) => re.test(text))) hits.push(file);
  }
  return hits.sort();
}

// ── Reconciliation ──────────────────────────────────────────────────────────

export interface ToolReconciliation {
  registered: number;
  matrixRows: number;
  /** In `TOOL_CAPABILITIES` but not registered by the server. */
  staleRows: string[];
  /** Registered but with no capability row (the server refuses these). */
  unauthorised: string[];
}

export function reconcileTools(registered: string[], matrix: string[]): ToolReconciliation {
  const reg = new Set(registered);
  const mat = new Set(matrix);
  return {
    registered: reg.size,
    matrixRows: mat.size,
    staleRows: [...mat].filter((t) => !reg.has(t)).sort(),
    unauthorised: [...reg].filter((t) => !mat.has(t)).sort(),
  };
}
