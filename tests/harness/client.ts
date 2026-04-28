/**
 * Thin REST client for the harness. Wraps the most common backend
 * endpoints in typed helpers so the smoke + loop tests don't have
 * to reach for `fetch()` directly.
 *
 * The base URL comes from the harness's `RunningBackend.baseUrl`,
 * not a hardcoded string — every test gets a different port.
 */

export interface RestClient {
  baseUrl: string;
  scanProject(projectPath: string): Promise<ScanResult>;
  getStats(): Promise<DbStats>;
  getDependencyEdges(): Promise<unknown[]>;
  getCrossSystemEdges(): Promise<CrossSystemResponse['edges']>;
  getCrossSystem(): Promise<CrossSystemResponse>;
  searchSymbols(query: string): Promise<unknown[]>;
  listPlans(): Promise<PlanSummary[]>;
  createPlan(input: CreatePlanInput): Promise<PlanSummary>;
  getPlan(uid: string): Promise<PlanDetail>;
  getBuildInfo(): Promise<BuildInfo>;
  /** Raw escape hatch for endpoints we haven't typed yet. */
  raw(method: string, path: string, body?: unknown): Promise<Response>;
}

export interface ScanResult {
  /** Number of source files **walked** (includes non-parsed). */
  fileCount: number;
  /** AST stats — what the parser actually produced. */
  astStats: {
    fileCount: number;
    symbolCount: number;
    importCount: number;
    resolvedImports: number;
    [k: string]: unknown;
  };
  /** Monorepo discovery output (rooted at projectPath). */
  monorepoConfig: {
    workspaces?: Array<{ name: string; path: string; [k: string]: unknown }>;
    dependencyGraph?: Record<string, string[]>;
    [k: string]: unknown;
  };
  /** File tree as the scanner saw it. Loosely typed — varies in shape. */
  fileTree: unknown;
  /** Anything else the endpoint adds — typed loosely for forward-compat. */
  [k: string]: unknown;
}

export interface CrossSystemEdge {
  /** Absolute path to the calling file. */
  source: string;
  /** Absolute path to the called file (e.g. the matching FastAPI route file). */
  target: string;
  /** Repo-relative caller path. */
  sourceRelative: string;
  /** Repo-relative callee path. */
  targetRelative: string;
  /** `http`, `sql`, etc. */
  protocol: string;
  /** Human label, e.g. `GET /api/users`. */
  label: string;
  /** 0-1 — matcher's confidence in the pairing. */
  confidence: number;
  [k: string]: unknown;
}

export interface CrossSystemResponse {
  edges: CrossSystemEdge[];
  stats?: {
    edgeCount?: number;
    callsiteCount?: number;
    routeCount?: number;
    byProtocol?: Record<string, number>;
    [k: string]: unknown;
  };
}

export interface DbStats {
  fileCount: number;
  symbolCount: number;
  importCount: number;
  resolvedImportCount?: number;
  [k: string]: unknown;
}

export interface PlanSummary {
  uid: string;
  title: string;
  status: string;
  taskCount: number;
  [k: string]: unknown;
}

export interface PlanDetail extends PlanSummary {
  description?: string;
  tasks: Array<{
    uid: string;
    description: string;
    status: string;
    affectedFiles?: string[];
    [k: string]: unknown;
  }>;
  [k: string]: unknown;
}

export interface CreatePlanInput {
  title: string;
  description?: string;
  projectPath: string;
  tasks?: Array<{
    description: string;
    affectedFiles?: string[];
  }>;
}

export interface BuildInfo {
  version: string;
  buildTime: string;
  commit: string;
  commitShort: string;
  branch: string;
  dirty: boolean;
  [k: string]: unknown;
}

export function createClient(baseUrl: string): RestClient {
  const json = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const res = await raw(method, path, body);
    if (!res.ok) {
      let detail = '';
      try {
        detail = await res.text();
      } catch {
        /* ignore */
      }
      throw new Error(`${method} ${path} ${res.status}${detail ? ` — ${detail.slice(0, 500)}` : ''}`);
    }
    if (res.status === 204) return undefined;
    return res.json();
  };

  const raw = async (method: string, path: string, body?: unknown): Promise<Response> => {
    const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    return fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      // Test calls should fail fast, not hang.
      signal: AbortSignal.timeout(60000),
    });
  };

  return {
    baseUrl,
    raw,
    async scanProject(projectPath) {
      return (await json('POST', '/api/project/scan', { projectPath })) as ScanResult;
    },
    async getStats() {
      return (await json('GET', '/api/stats')) as DbStats;
    },
    async getDependencyEdges() {
      return (await json('GET', '/api/dependencies')) as unknown[];
    },
    async getCrossSystem() {
      return (await json('GET', '/api/cross-system')) as CrossSystemResponse;
    },
    async getCrossSystemEdges() {
      const resp = (await json('GET', '/api/cross-system')) as CrossSystemResponse;
      return resp.edges ?? [];
    },
    async searchSymbols(query) {
      return (await json('GET', `/api/symbols/search?q=${encodeURIComponent(query)}`)) as unknown[];
    },
    async listPlans() {
      return (await json('GET', '/api/plans')) as PlanSummary[];
    },
    async createPlan(input) {
      return (await json('POST', '/api/plans', input)) as PlanSummary;
    },
    async getPlan(uid) {
      return (await json('GET', `/api/plans/${uid}`)) as PlanDetail;
    },
    async getBuildInfo() {
      return (await json('GET', '/api/build-info')) as BuildInfo;
    },
  };
}
