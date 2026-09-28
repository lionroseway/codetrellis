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
  agent: 'g', mcp: 'g', sessions: 'g', sensors: 'g', workstreams: 'g', awareness: 'g',
  baseline: 'h', comparands: 'h', compare: 'h', conflicts: 'h', freeze: 'h',
  terminals: 'i', audio: 'i',
  pairing: 'j', peers: 'j', sync: 'j',
  settings: 'k', updates: 'k', logs: 'k', power: 'k',
  'system-docs': 'l',
};

export function domainForRoute(path: string): DomainKey | null {
  // Nested under /api/plans/:uid by URL, but they are what 0.4d and 0.4g
  // cover: the sign-off pack and worklist, and the agent budget.
  if (/\/(signoff-pack|worklist)\b/.test(path)) return 'd';
  if (/\/budget\//.test(path)) return 'g';
  // An item's recorded files are Brief materials (0.4e).
  if (/\/artefacts\b/.test(path)) return 'e';
  const seg = path.startsWith('/api/') ? path.split('/')[2] : path.split('/')[1];
  return REST_DOMAINS[seg] ?? null;
}

/** Registering file → domain, with name overrides for the big mixed files. */
const TOOL_FILE_DOMAINS: Record<string, DomainKey> = {
  architecture: 'b', graph: 'b',
  plan: 'c', 'plan-item': 'c', contribution: 'c',
  channel: 'f', presence: 'f',
  session: 'g', ui: 'g', budget: 'g', awareness: 'g',
  'project-config': 'a',
  drift: 'h', governance: 'h', review: 'h', git: 'h',
  terminal: 'i', audio: 'i',
  mobile: 'j', peer: 'j',
  'system-docs': 'l', intake: 'l',
};

export function domainForTool(name: string, section: string | undefined): DomainKey | null {
  if (/criteri|signoff|worklist|run_checks|approve_gate/.test(name)) return 'd';
  if (/brief|material|artefact/.test(name)) return 'e';
  // The project lifecycle lives in session-tools and ui-tools by file, but
  // it is what 0.4a covers: open, rescan, close, and the recent-projects list.
  if (/^(open|close|rescan|pin|unpin)_project$|recent_projects?$|^(get|set|refresh)_repo_(identity|alias|origin)$/.test(name)) return 'a';
  return section ? TOOL_FILE_DOMAINS[section] ?? null : null;
}

const RPC_DOMAINS: Record<string, DomainKey> = {
  project: 'a', fs: 'a', diagnostics: 'a',
  graph: 'b', changes: 'b',
  plan: 'c', item: 'c', comment: 'c',
  criteria: 'd', criterion: 'd',
  artefact: 'e',
  channel: 'f', input: 'f',
  budget: 'g',
  deviation: 'h', review: 'h', freeze: 'h',
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

/** What one test source sends: tool and RPC names, and requests. */
export interface Calls {
  names: Set<string>;
  routes: { method: string; arg: string }[];
}

export function callsIn(source: string): Calls {
  return { names: invokedNames(source), routes: invokedRoutes(source) };
}

/** Whether `calls` sends `method` to the route `path`. */
export function callsRoute(calls: Calls, method: string, path: string): boolean {
  const p = routePattern(path);
  return calls.routes.some((r) => r.method === method && p.test(r.arg));
}

export interface TestFile {
  text: string;
  calls: Calls;
}

/**
 * Test files that call what `hit` accepts, directly or through a helper
 * method that does (`client.getPlan(uid)` sends `GET /api/plans/:uid`).
 */
export function filesCalling(
  hit: (calls: Calls) => boolean,
  files: Map<string, TestFile>,
  helpers: { name: string; calls: Calls }[] = [],
): string[] {
  const viaHelpers = helpers.filter((h) => hit(h.calls)).map((h) => new RegExp(`\\.${h.name}\\(`));
  const out: string[] = [];
  for (const [file, f] of files) if (hit(f.calls) || viaHelpers.some((re) => re.test(f.text))) out.push(file);
  return out.sort();
}

/**
 * Remove unconditionally skipped tests from test source, so a mention inside
 * one doesn't count as coverage. Phase 32 §0.3b found 8 routes that looked
 * tested only because a `test.describe.skip` file named them.
 *
 * Removes `test.skip('name', …)`, `test.describe.skip('name', …)`,
 * `describe.skip(…)` and `it.skip(…)` calls whose first argument is a
 * string — i.e. a skipped test, not a conditional `test.skip(!ok, 'why')`
 * guard inside a running one. Parens are matched with string, template and
 * comment awareness, which is all test files need.
 */
export function stripSkippedTests(source: string): string {
  const head = /\b(?:test\.describe|test|describe|it)\.skip\(\s*(['"`])/g;
  let out = '';
  let from = 0;
  for (let m = head.exec(source); m; m = head.exec(source)) {
    const open = source.indexOf('(', m.index);
    const close = matchParen(source, open);
    if (close < 0) break;
    out += source.slice(from, m.index);
    from = close + 1;
    head.lastIndex = from;
  }
  return out + source.slice(from);
}

/** Index of the `)` matching the `(` at `open`, or -1. */
function matchParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === '`') {
      i = skipString(s, i);
      continue;
    }
    if (c === '/' && s[i + 1] === '/') { i = s.indexOf('\n', i); if (i < 0) return -1; continue; }
    if (c === '/' && s[i + 1] === '*') { i = s.indexOf('*/', i + 2) + 1; if (i <= 0) return -1; continue; }
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return -1;
}

function skipString(s: string, start: number): number {
  const q = s[start];
  for (let i = start + 1; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (q === '`' && s[i] === '$' && s[i + 1] === '{') {
      const end = matchBrace(s, i + 1);
      if (end < 0) return s.length;
      i = end;
      continue;
    }
    if (s[i] === q) return i;
  }
  return s.length;
}

function matchBrace(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(s, i); continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

// ── Calls, not mentions ─────────────────────────────────────────────────────

/**
 * What actually sends a tool call or an RPC request in a test: the scripted
 * agent's `callTool`, the paired phone's `rpc` / `rpcError`, and the peer
 * services' `handle…Method` entry points that unit tests drive directly.
 */
const BASE_INVOKERS = /^(?:callTool|rpc|rpcError|handle[A-Z]\w*Method)$/;

/**
 * The quoted names a test source actually invokes: a string that is a
 * top-level argument of a call to an invoker. Phase 32 §0.7 found three MCP
 * tools credited as tested because a unit test that phrases tool calls for
 * the Timeline (`toolCall('search_items', …)`) named them; nothing ran them
 * (bug 49). A name only counts here where the test sends it.
 *
 * An invoker is one of `BASE_INVOKERS`, or a function defined in the same
 * source whose body calls an invoker — the `json(…)` and `refused(…)`
 * wrappers tests define around `callTool`. A `for (const x of [...])` loop
 * whose body passes `x` to an invoker invokes every name in the array.
 */
export function invokedNames(source: string): Set<string> {
  const src = stripComments(source);
  const invokers = new Set<string>();
  const isInvoker = (name: string) => BASE_INVOKERS.test(name) || invokers.has(name);

  // Local wrappers, to a fixpoint: a wrapper of a wrapper is a wrapper.
  const defs = [...src.matchAll(/\b(?:(?:const|let)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>|(?:async\s+)?function\s+([a-zA-Z_$][\w$]*)\s*\()/g)]
    .map((m) => ({ name: m[1] ?? m[2], body: definitionBody(src, m.index! + m[0].length) }));
  for (let grew = true; grew; ) {
    grew = false;
    for (const d of defs) {
      if (invokers.has(d.name) || BASE_INVOKERS.test(d.name)) continue;
      if (callsOf(d.body, isInvoker).length > 0) { invokers.add(d.name); grew = true; }
    }
  }

  const names = new Set<string>();
  for (const args of callsOf(src, isInvoker)) {
    for (const a of args) {
      const s = stringLiteral(a) ?? namedInObject(a);
      if (s !== null) names.add(s);
    }
  }

  // for (const x of ['a', 'b']) { …invoker(x)… }, the same over a const array,
  // and table-driven tests: for (const [tool, args] of cases) { …invoker(tool, args)… }
  // credits the strings in the position the invoked variable takes.
  for (const m of src.matchAll(/\bfor\s*\(\s*(?:const|let)\s+(\[[^\]]*\]|[a-zA-Z_$][\w$]*)\s+of\s+/g)) {
    const pattern = m[1];
    const vars = pattern.startsWith('[') ? splitArgs(pattern.slice(1, -1)).map((v) => v.trim()) : [pattern];
    const headClose = matchParen(src, src.indexOf('(', m.index!));
    if (headClose < 0) continue;
    const list = arrayLiteralOf(src, src.slice(m.index! + m[0].length, headClose).trim());
    if (!list) continue;
    let bodyStart = headClose + 1;
    while (/\s/.test(src[bodyStart] ?? '')) bodyStart++;
    const bodyEnd = src[bodyStart] === '{' ? matchBrace(src, bodyStart) : src.indexOf(';', bodyStart);
    if (bodyEnd < 0) continue;
    const calls = callsOf(src.slice(bodyStart, bodyEnd + 1), isInvoker);
    vars.forEach((v, i) => {
      if (!v || !calls.some((args) => args.some((a) => a.trim() === v))) return;
      for (const el of splitArgs(list.slice(1, -1))) {
        const e = el.trim();
        const at = pattern.startsWith('[') ? (e.startsWith('[') ? splitArgs(e.slice(1, -1))[i] : undefined) : e;
        const s = at === undefined ? null : stringLiteral(at);
        if (s !== null) names.add(s);
      }
    });
  }
  return names;
}

/** The MCP SDK's `callTool({ name: 'x', arguments })`: the `name` of an object argument. */
function namedInObject(arg: string): string | null {
  const a = arg.trim();
  if (!a.startsWith('{')) return null;
  const m = /^\{[^{}]*?\bname\s*:\s*(['"`])([^'"`\\$]+)\1/.exec(a);
  return m ? m[2] : null;
}

/** `[ … ]` itself, or the array literal a `const` of that name is declared as. */
function arrayLiteralOf(src: string, iterable: string): string | null {
  if (iterable.startsWith('[')) return iterable;
  if (!/^[a-zA-Z_$][\w$]*$/.test(iterable)) return null;
  const decl = new RegExp(`\\b(?:const|let)\\s+${iterable.replace(/\$/g, '\\$')}\\s*(?::[^=]+)?=\\s*\\[`).exec(src);
  if (!decl) return null;
  const open = decl.index + decl[0].length - 1;
  const end = matchBracket(src, open);
  return end > 0 ? src.slice(open, end + 1) : null;
}

const HTTP_VERBS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
/** Where a route is DEFINED, not called: Express fixtures, Go handler fixtures. */
const ROUTE_DEFINERS = /(?:\bapp|\brouter|\bhttp|\bmux|\bserver)\.\s*$/;

/**
 * Every request a test source sends, as its method and the literal (string
 * or template) it passes as the path. Crediting a route by its path alone
 * let a test of `GET /api/plans/:uid/budget` cover `PUT` on the same path.
 *
 * A call sends a request when it names its method: a verb literal among its
 * arguments (`raw('PUT', …)`, and every local `req(method, url)` wrapper), a
 * verb-named function (`get(url)`, supertest's `.post(url)`), or
 * `fetch(url, { method })` (GET when none is given). A table row
 * `{ method: 'GET', path: … }` is a request too; the table's loop sends it.
 */
export function invokedRoutes(source: string): { method: string; arg: string }[] {
  const src = stripComments(source);
  const out: { method: string; arg: string }[] = [];
  for (const m of src.matchAll(/([a-zA-Z_$][\w$]*)\s*\(/g)) {
    if (ROUTE_DEFINERS.test(src.slice(Math.max(0, m.index! - 12), m.index!))) continue;
    if (/\bfunction\s+$/.test(src.slice(Math.max(0, m.index! - 10), m.index!))) continue;
    const open = m.index! + m[0].length - 1;
    const close = matchParen(src, open);
    if (close < 0) continue;
    const args = splitArgs(src.slice(open + 1, close));
    const callee = m[1];
    const verb = args.map(stringLiteral).find((a) => a !== null && HTTP_VERBS.has(a))
      ?? (HTTP_VERBS.has(callee.toUpperCase()) && callee === callee.toLowerCase() ? callee.toUpperCase() : undefined)
      ?? (/^(?:fetch|authFetch)$/.test(callee)
        ? (args.map((a) => /\bmethod\s*:\s*['"`]([A-Z]+)['"`]/.exec(a)?.[1]).find(Boolean) ?? 'GET')
        : undefined);
    if (!verb) continue;
    // The path may be built: `h.backend.baseUrl + \`/api/…\``. The route's pattern
    // needs its quote and its end, so a longer path in the same argument can't match.
    for (const a of args) if (!HTTP_VERBS.has(stringLiteral(a) ?? '')) out.push({ method: verb, arg: a.trim() });
  }
  // A table of endpoints its loop requests: for (const ep of ENDPOINTS) { raw('GET', ep.path(…)) }.
  for (const m of src.matchAll(/\bfor\s*\(\s*(?:const|let)\s+(\[[^\]]*\]|\{[^}]*\}|[a-zA-Z_$][\w$]*)\s+of\s+/g)) {
    const headClose = matchParen(src, src.indexOf('(', m.index!));
    if (headClose < 0) continue;
    const list = arrayLiteralOf(src, src.slice(m.index! + m[0].length, headClose).trim());
    if (!list) continue;
    let bodyStart = headClose + 1;
    while (/\s/.test(src[bodyStart] ?? '')) bodyStart++;
    if (src[bodyStart] !== '{') continue;
    const bodyEnd = matchBrace(src, bodyStart);
    if (bodyEnd < 0) continue;
    const verbs = new Set(invokedRoutes(src.slice(bodyStart, bodyEnd + 1)).map((r) => r.method));
    for (const lit of list.matchAll(/(['"`])(\/api\/[^'"`]*)\1/g)) for (const v of verbs) out.push({ method: v, arg: lit[0] });
  }
  for (const m of src.matchAll(/\{[^{}]*?\bmethod\s*:\s*['"`]([A-Z]+)['"`][^{}]*\}/g)) {
    for (const p of m[0].matchAll(/\b(?:path|url)\s*:\s*(?:\(\)\s*=>\s*)?(['"`][^'"`]*['"`])/g)) out.push({ method: m[1], arg: p[1] });
  }
  return out;
}

/** The top-level argument texts of every call to a name `isInvoker` accepts. */
function callsOf(src: string, isInvoker: (name: string) => boolean): string[][] {
  const out: string[][] = [];
  for (const m of src.matchAll(/([a-zA-Z_$][\w$]*)\s*\(/g)) {
    if (!isInvoker(m[1])) continue;
    const open = m.index! + m[0].length - 1;
    const close = matchParen(src, open);
    if (close > 0) out.push(splitArgs(src.slice(open + 1, close)));
  }
  return out;
}

function splitArgs(s: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(s, i); continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) { args.push(s.slice(from, i)); from = i + 1; }
  }
  args.push(s.slice(from));
  return args;
}

/** `'x'`, `"x"` or a template with no substitution, as its text; otherwise null. */
function stringLiteral(arg: string): string | null {
  const m = /^\s*(['"`])([^'"`\\$]*)\1\s*$/.exec(arg);
  return m ? m[2] : null;
}

/** The body of an arrow function or function whose head ends at `at`. */
function definitionBody(src: string, at: number): string {
  let i = at;
  if (src[i - 1] === '(') {
    // function name( … ) — skip the parameters and any return type.
    const close = matchParen(src, i - 1);
    if (close < 0) return '';
    i = src.indexOf('{', close);
    if (i < 0) return '';
  }
  while (i < src.length && /\s/.test(src[i])) i++;
  if (src[i] === '{') {
    const end = matchBrace(src, i);
    return end > 0 ? src.slice(i, end + 1) : '';
  }
  // An expression-bodied arrow: up to a `;` or line end outside any bracket.
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '"' || c === "'" || c === '`') { j = skipString(src, j); continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (--depth < 0) return src.slice(i, j); }
    else if ((c === ';' || c === '\n' || c === ',') && depth === 0) return src.slice(i, j);
  }
  return src.slice(i);
}

function matchBracket(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(s, i); continue; }
    if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return i;
  }
  return -1;
}

/** Remove `//` and block comments, leaving strings alone. */
function stripComments(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === '`') { const end = skipString(s, i); out += s.slice(i, end + 1); i = end; continue; }
    if (c === '/' && s[i + 1] === '/') { const nl = s.indexOf('\n', i); if (nl < 0) break; i = nl - 1; continue; }
    if (c === '/' && s[i + 1] === '*') { const end = s.indexOf('*/', i + 2); if (end < 0) break; i = end + 1; continue; }
    out += c;
  }
  return out;
}

// ── Coverage guard ──────────────────────────────────────────────────────────

export interface CoverageDelta {
  /** Untested today and not on the allowlist: a new gap. */
  newlyUntested: string[];
  /** On the allowlist but now tested: the list must shrink. */
  nowTested: string[];
  /** On the allowlist but no longer exists. */
  gone: string[];
}

/**
 * Compare today's untested set with the allowlist. Only an exact match
 * passes, so the allowlist can only shrink, and only on purpose.
 */
export function compareCoverage(untested: string[], allowlist: string[], existing: string[]): CoverageDelta {
  const u = new Set(untested);
  const a = new Set(allowlist);
  const e = new Set(existing);
  return {
    newlyUntested: [...u].filter((x) => !a.has(x)).sort(),
    nowTested: [...a].filter((x) => e.has(x) && !u.has(x)).sort(),
    gone: [...a].filter((x) => !e.has(x)).sort(),
  };
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
