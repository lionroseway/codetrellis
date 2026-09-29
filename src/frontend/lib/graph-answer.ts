/**
 * What the canvas does with an answer from `/api/dependencies?include=cross_system`.
 *
 * The backend's AST tables hold one project at a time, and a scan truncates
 * them before it refills them. So an answer can be "no edges" only because
 * a scan is running (of this project, or of another one another window
 * opened), or be another project's edges altogether. Taken as the graph,
 * either blanked a canvas that had been showing this project's graph, and
 * nothing fetched again: the broadcast after the other project's scan names
 * that project, which this window rightly ignores. Four PRs' browser runs
 * went red on it (Phase 32, the "blank graph on rescan" follow-up).
 *
 * So the backend says which it is: 503 `{ scanning: true }` while a scan
 * runs, and the project its edges belong to in `X-CodeTrellis-Project`. And
 * the canvas keeps what it has unless the answer is this project's graph.
 */

export const PROJECT_HEADER = 'X-CodeTrellis-Project';

export type GraphAnswer =
  | { kind: 'edges'; edges: unknown[] }
  /** A scan is running: keep the graph on screen and ask again shortly. */
  | { kind: 'scanning' }
  /** The backend holds another project's graph: keep this one's. */
  | { kind: 'other-project'; project: string }
  | { kind: 'error'; message: string };

const trim = (p: string) => p.replace(/[\\/]+$/, '');

/** Pure: the HTTP status, the parsed body, the project header, and the root this canvas shows. */
export function graphAnswer(status: number, body: unknown, projectHeader: string | null, forRoot: string): GraphAnswer {
  if (status === 503 && body && typeof body === 'object' && (body as { scanning?: unknown }).scanning === true) return { kind: 'scanning' };
  if (status < 200 || status >= 300) return { kind: 'error', message: `the server answered ${status}` };
  // Only a list is a graph; anything else is an error shape that happens to parse.
  if (!Array.isArray(body)) return { kind: 'error', message: 'the response was not a list of edges' };
  const project = projectHeader ? safeDecode(projectHeader) : '';
  // No header: an older backend, or nothing scanned yet. Taken as it is.
  if (project && trim(project) !== trim(forRoot)) return { kind: 'other-project', project };
  return { kind: 'edges', edges: body };
}

function safeDecode(v: string): string {
  try { return decodeURIComponent(v); } catch { return v; }
}

/** Fetch and read one answer for `forRoot`. Never throws. */
export async function fetchGraphAnswer(forRoot: string): Promise<GraphAnswer> {
  try {
    const r = await fetch('/api/dependencies?include=cross_system');
    const body = await r.json().catch(() => null);
    return graphAnswer(r.status, body, r.headers.get(PROJECT_HEADER), forRoot);
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
