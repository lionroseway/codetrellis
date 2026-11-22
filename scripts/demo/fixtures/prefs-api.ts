/**
 * The talk demos' sample repository: a small TypeScript API in three layers,
 * `src/endpoints/` → `src/services/` → `src/db/`, small enough to read from
 * the back of a room. The running example is customer preferences: the
 * endpoint that should go through `services/`, not import `db/` directly.
 *
 * Files are text here, not a folder in this repository, for the reason
 * `demo-fixtures.ts` gives: a fixture repo cannot be committed inside this
 * one. No real data, no dependencies: it is read and mapped, never run.
 */

// The id the Rules view's form gives "src/endpoints/ may not import src/db/", so re-entering the rule there changes this one.
export const PREFS_RULE_ID = 'src-endpoints-not-src-db';
export const PREFS_RULES = '.codetrellis/rules/architecture.yaml';
export const PREFS_REPO = 'src/db/preferencesRepo.ts';
export const PREFS_SERVICE = 'src/services/preferencesService.ts';
export const PREFS_ENDPOINT = 'src/endpoints/preferences.ts';

/** The endpoint as an agent first writes it: straight to the database. */
export const ENDPOINT_BREACH = `import { json, type Request, type Response } from '../http';
import { writePreferences } from '../db/preferencesRepo';

/** PUT /customers/:id/preferences */
export function putPreferences(req: Request): Response {
  const row = writePreferences({ customerId: req.params.id, ...req.body });
  return json(200, row);
}
`;

/** The same endpoint, through the service. */
export const ENDPOINT_FIXED = `import { json, type Request, type Response } from '../http';
import { savePreferences } from '../services/preferencesService';

/** PUT /customers/:id/preferences */
export function putPreferences(req: Request): Response {
  const row = savePreferences(req.params.id, req.body);
  return json(200, row);
}
`;

export const PREFS_API_FILES: Record<string, string> = {
  'package.json': `${JSON.stringify({
    name: 'acme-customer-api',
    version: '1.0.0',
    private: true,
    description: 'Customers and their preferences. Endpoints call services; services call the database.',
    type: 'module',
    scripts: { test: 'node --test' },
  }, null, 2)}\n`,
  'tsconfig.json': `${JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noEmit: true },
    include: ['src'],
  }, null, 2)}\n`,
  'README.md': `# Acme customer API

Three layers, one direction:

    src/endpoints/  →  src/services/  →  src/db/

An endpoint reads the request and answers it. A service decides what is
allowed. Only \`src/db/\` touches the tables.
`,
  [PREFS_RULES]: `# Owned by the platform team.
suite: architecture
because: Endpoints stay thin. The services decide what may be written.
rules:
  - id: ${PREFS_RULE_ID}
    from: src/endpoints/
    mayNotImport: src/db/
    strength: warn
    because: Endpoints go through services, which hold the validation.
    since: 2026-10-05T09:00:00.000Z
    by: Alex Kim
`,
  'src/http.ts': `export interface Request {
  params: Record<string, string>;
  body: Record<string, unknown>;
}

export interface Response {
  status: number;
  body: unknown;
}

export const json = (status: number, body: unknown): Response => ({ status, body });
`,
  'src/server.ts': `import type { Request, Response } from './http';
import { health } from './endpoints/health';
import { getCustomer } from './endpoints/customers';

type Handler = (req: Request) => Response;

export const routes: Record<string, Handler> = {
  'GET /health': health,
  'GET /customers/:id': getCustomer,
};
`,
  'src/endpoints/health.ts': `import { json, type Response } from '../http';

/** GET /health */
export function health(): Response {
  return json(200, { ok: true });
}
`,
  'src/endpoints/customers.ts': `import { json, type Request, type Response } from '../http';
import { customerById } from '../services/customerService';

/** GET /customers/:id */
export function getCustomer(req: Request): Response {
  const customer = customerById(req.params.id);
  return customer ? json(200, customer) : json(404, { error: 'no such customer' });
}
`,
  'src/services/customerService.ts': `import { findCustomer, type CustomerRow } from '../db/customersRepo';

export function customerById(id: string): CustomerRow | undefined {
  return findCustomer(id);
}

export function customerExists(id: string): boolean {
  return findCustomer(id) !== undefined;
}
`,
  [PREFS_SERVICE]: `import { readPreferences, writePreferences, type PreferencesRow } from '../db/preferencesRepo';
import { customerExists } from './customerService';

export type PreferencesChange = Partial<Omit<PreferencesRow, 'customerId'>>;

export function getPreferences(customerId: string): PreferencesRow {
  return readPreferences(customerId);
}

export function savePreferences(customerId: string, change: PreferencesChange): PreferencesRow {
  if (!customerExists(customerId)) throw new Error('no such customer');
  const current = readPreferences(customerId);
  return writePreferences({ ...current, ...change });
}
`,
  'src/db/client.ts': `export type Row = Record<string, unknown>;

const tables = new Map<string, Map<string, Row>>();

/** One table, by name. A stand-in for the database. */
export function table(name: string): Map<string, Row> {
  let rows = tables.get(name);
  if (!rows) {
    rows = new Map();
    tables.set(name, rows);
  }
  return rows;
}
`,
  'src/db/customersRepo.ts': `import { table } from './client';

export interface CustomerRow {
  id: string;
  name: string;
}

export function findCustomer(id: string): CustomerRow | undefined {
  return table('customers').get(id) as CustomerRow | undefined;
}
`,
  [PREFS_REPO]: `import { table } from './client';

export interface PreferencesRow {
  customerId: string;
  emailUpdates: boolean;
  language: string;
}

const LANGUAGES = ['en', 'fr', 'de'];

export function readPreferences(customerId: string): PreferencesRow {
  const row = table('preferences').get(customerId) as PreferencesRow | undefined;
  return row ?? { customerId, emailUpdates: true, language: 'en' };
}

export function writePreferences(row: PreferencesRow): PreferencesRow {
  if (!row.customerId) throw new Error('customerId is required');
  if (!LANGUAGES.includes(row.language)) throw new Error('unknown language');
  table('preferences').set(row.customerId, { ...row });
  return row;
}
`,
};
