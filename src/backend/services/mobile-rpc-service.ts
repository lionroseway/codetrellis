/**
 * Mobile RPC service — routes JSON-RPC requests from mobile clients
 * on the WebRTC `control` data channel to existing backend services.
 *
 * Wire protocol (same envelope as remote-interaction-service):
 *   { method: string, params: object, id: string }
 *   → { result: object, id: string }  or  { error: string, id: string }
 *
 * Methods:
 *   plan.list         — list all plans
 *   plan.get          — get plan + items
 *   plan.items        — list items for a plan
 *   deviation.list    — list deviations for a plan
 *   deviation.resolve — accept/ignore/revert a deviation
 *   project.open      — scan/open a project on the desktop
 *   project.list      — list recent projects
 *   terminal.list     — list active terminals
 *   terminal.write    — send input to a terminal
 *   terminal.read     — read recent output from a terminal
 *   channel.events    — list channel events for a plan
 *   channel.post      — post a channel event
 *   graph.overview    — architecture summary (dirs, languages, stats)
 *   graph.directory   — list files in a directory with symbol/connection counts
 *   graph.file        — file detail: symbols + imports + importedBy
 *   graph.search      — search symbols by name
 */

import { DATA_CHANNELS } from '../../shared/types';
import {
  onChannelMessage,
  sendToPeer,
} from './webrtc-service';
import * as planService from './plan-service';
import * as planItemService from './plan-item-service';
import * as channelEventService from './channel-event-service';
import * as deviationService from './deviation-service';
import * as terminalService from './terminal-service';
import * as recentProjectsService from './recent-projects-service';
import * as remoteInteractionService from './remote-interaction-service';
import * as planPhasesService from './plan-phases-service';
import * as planDocumentsService from './plan-documents-service';
import * as commentService from './comment-service';
import * as externalRefsService from './external-refs-service';
import * as taskAttachmentsService from './task-attachments-service';
import {
  getArchitectureSummary,
  getFileSymbols,
  getFileDependencies,
  getDependencyEdges,
  searchSymbols,
  getDb,
} from './database';
import { listCrossSystemEdges } from './cross-system-service';
import { captureSnapshot, computeDiff, getBaseline } from './diff-engine';
import { computeProjection } from './projection-service';
import {
  scanProject,
  getActiveProjectPath,
  readFilesSnapshot,
  getGitWorkingTreeStatus,
  broadcast,
} from '../server';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// --- Types -------------------------------------------------------------------

interface RpcRequest {
  method: string;
  params: Record<string, unknown>;
  id: string;
  /** Marker to distinguish RPC from other control messages. */
  rpc?: true;
}

interface RpcResponse {
  result?: unknown;
  error?: string;
  id: string;
  rpc: true;
}

// --- State -------------------------------------------------------------------

let running = false;
let unsubMessage: (() => void) | null = null;

// --- Public API --------------------------------------------------------------

export function startMobileRpc(): void {
  if (running) return;
  running = true;

  unsubMessage = onChannelMessage(DATA_CHANNELS.CONTROL, handleControlMessage);

  console.log('[MobileRPC] Started');
}

export function stopMobileRpc(): void {
  if (!running) return;
  running = false;

  if (unsubMessage) { unsubMessage(); unsubMessage = null; }

  console.log('[MobileRPC] Stopped');
}

// --- Message handling --------------------------------------------------------

function handleControlMessage(fingerprint: string, data: Buffer | string): void {
  try {
    const text = typeof data === 'string' ? data : data.toString('utf-8');
    const msg = JSON.parse(text);

    // Only handle messages with rpc marker and an id
    if (!msg.rpc || !msg.id) return;

    const req = msg as RpcRequest;
    handleRpc(fingerprint, req);
  } catch {
    // Not a valid RPC message — ignore (other control messages handled elsewhere)
  }
}

async function handleRpc(fingerprint: string, req: RpcRequest): Promise<void> {
  try {
    const result = await routeMethod(req.method, req.params ?? {});
    sendResponse(fingerprint, { result, id: req.id, rpc: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    sendResponse(fingerprint, { error: message, id: req.id, rpc: true });
  }
}

function sendResponse(fingerprint: string, response: RpcResponse): void {
  sendToPeer(fingerprint, DATA_CHANNELS.CONTROL, JSON.stringify(response));
}

// --- Method router -----------------------------------------------------------

async function routeMethod(method: string, params: Record<string, unknown>): Promise<unknown> {
  switch (method) {
    // --- Plans ---------------------------------------------------------------
    case 'plan.list': {
      const projectPath = params.projectPath as string | undefined;
      return planService.listPlans(projectPath).map((p) => {
        const items = planItemService.listAllItems(p.uid);
        return {
          uid: p.uid,
          title: p.title,
          status: p.status,
          projectPath: p.projectPath,
          itemCount: items.length,
          doneCount: items.filter((i) => i.status === 'done').length,
          inProgressCount: items.filter((i) => i.status === 'in_progress' || i.status === 'assigned').length,
          updatedAt: p.updatedAt,
          createdAt: p.createdAt,
        };
      });
    }

    case 'plan.get': {
      const uid = requireString(params, 'uid');
      const plan = planService.getPlan(uid);
      if (!plan) throw new Error(`Plan not found: ${uid}`);
      const items = planItemService.listAllItems(uid);
      const deviations = deviationService.getDeviations(uid);
      // Surface everything the desktop has about the plan.
      const phases = safe(() => planPhasesService.listPhases(uid), []);
      const documents = safe(() => planDocumentsService.listPlanDocumentSummaries(uid), []);
      const externalRefs = safe(() => externalRefsService.getExternalRefsByPlan(uid), []);
      const comments = safe(() => commentService.getComments(uid), []);
      return { plan, items, deviations, phases, documents, externalRefs, comments };
    }

    case 'plan.document': {
      const docUid = requireString(params, 'docUid');
      const doc = planDocumentsService.getPlanDocument(docUid);
      if (!doc) throw new Error(`Document not found: ${docUid}`);
      return doc;
    }

    case 'plan.items': {
      const planUid = requireString(params, 'planUid');
      return planItemService.listAllItems(planUid);
    }

    case 'plan.update': {
      const uid = requireString(params, 'uid');
      const plan = planService.getPlan(uid);
      if (!plan) throw new Error(`Plan not found: ${uid}`);
      const updates: Record<string, unknown> = {};
      if (params.title !== undefined) updates.title = params.title;
      if (params.status !== undefined) updates.status = params.status;
      planService.updatePlan(uid, updates as any, 'mobile-user');
      return { ok: true };
    }

    case 'plan.item.get': {
      const uid = requireString(params, 'uid');
      const item = planItemService.getItem(uid);
      if (!item) throw new Error(`Item not found: ${uid}`);
      const comments = safe(() => commentService.listItemComments(uid), []);
      const externalRefs = safe(() => externalRefsService.getExternalRefs(uid), []);
      const attachments = safe(() => taskAttachmentsService.listItemAttachments(uid), []);
      return { item, comments, externalRefs, attachments };
    }

    case 'plan.item.update': {
      const uid = requireString(params, 'uid');
      const updates: Record<string, unknown> = {};
      if (params.status !== undefined) updates.status = params.status;
      if (params.title !== undefined) updates.title = params.title;
      if (params.assignee !== undefined) updates.assignee = params.assignee;
      if (params.body !== undefined) updates.body = params.body;
      const updated = planItemService.updateItem(uid, updates as any);
      if (!updated) throw new Error(`Item not found: ${uid}`);
      return updated;
    }

    // --- Deviations ----------------------------------------------------------
    case 'deviation.list': {
      const planUid = requireString(params, 'planUid');
      return deviationService.getDeviations(planUid);
    }

    case 'deviation.resolve': {
      const id = params.id as number;
      const resolution = params.resolution as 'accepted' | 'reverted' | 'ignored';
      if (!id || !resolution) throw new Error('id and resolution required');
      deviationService.resolveDeviation(id, resolution);
      return { ok: true };
    }

    // --- Projects ------------------------------------------------------------
    case 'project.list': {
      return recentProjectsService.listRecentProjects();
    }

    case 'project.open': {
      const projectPath = requireString(params, 'projectPath');
      // Surface on the desktop too: broadcast the same event the MCP
      // open_project tool uses so the desktop opens a tab + switches to it
      // (companion-app principle — mobile actions show up on the desktop).
      broadcast('ui-open-project', { path: projectPath });
      const result = await scanProject(projectPath);
      return result;
    }

    case 'project.active': {
      const activePath = getActiveProjectPath();
      if (!activePath) return null;
      return recentProjectsService.getRecentProject(activePath);
    }

    // --- Terminals -----------------------------------------------------------
    case 'terminal.list': {
      return terminalService.listTerminals();
    }

    case 'terminal.create': {
      // Spawn a new terminal on the desktop. Defaults the working dir to
      // the active/most-recent project so it opens in a useful place.
      const preset = (params.preset as string) || 'shell';
      const cwd = (params.cwd as string)
        || getActiveProjectPath()
        || recentProjectsService.listRecentProjects()[0]?.path
        || undefined;
      const title = params.title as string | undefined;
      const term = terminalService.createTerminal({
        preset: preset as any,
        cwd,
        title,
      });
      // Companion-app sync: surface the new terminal on the DESKTOP UI too
      // (same broadcast the MCP tool / REST endpoint emit). Without this the
      // PTY spawns headless and never appears in the desktop terminal panel.
      try { broadcast('terminal-created', { session: term, focus: true }); } catch { /* */ }
      return term;
    }

    case 'terminal.write': {
      const id = requireString(params, 'id');
      const data = requireString(params, 'data');
      const ok = terminalService.writeTerminal(id, data);
      return { ok };
    }

    case 'terminal.kill': {
      const id = requireString(params, 'id');
      const ok = terminalService.killTerminal(id);
      // Companion-app sync: remove it from the desktop UI too.
      if (ok) { try { broadcast('terminal-killed', { id }); } catch { /* */ } }
      return { ok };
    }

    case 'terminal.read': {
      const id = requireString(params, 'id');
      const lines = (params.lines as number) ?? 100;
      // raw=true → keep ANSI so the mobile app colours it (parseAnsi).
      const output = terminalService.readTerminalOutput(id, lines, true);
      return { output };
    }

    case 'terminal.stream': {
      // Incremental raw output since a byte offset, for feeding xterm.js.
      const id = requireString(params, 'id');
      const since = typeof params.since === 'number' ? (params.since as number) : undefined;
      const delta = terminalService.readTerminalDelta(id, since);
      if (delta === null) throw new Error(`Terminal not found: ${id}`);
      return delta; // { data, total, reset }
    }

    case 'terminal.resize': {
      const id = requireString(params, 'id');
      const cols = (params.cols as number) ?? 80;
      const rows = (params.rows as number) ?? 24;
      const ok = terminalService.resizeTerminal(id, cols, rows);
      return { ok };
    }

    // --- Channel events ------------------------------------------------------
    case 'channel.events': {
      const planUid = requireString(params, 'planUid');
      const limit = (params.limit as number) ?? 50;
      return channelEventService.listChannelEvents(planUid, { limit });
    }

    case 'channel.post': {
      const planUid = requireString(params, 'planUid');
      const eventType = requireString(params, 'eventType');
      const message = (params.message as string) ?? '';
      const author = (params.author as string) ?? 'mobile-user';
      const respondsTo = (params.parentUid as string) || undefined;
      const event = channelEventService.postChannelEvent({
        planUid,
        eventType: eventType as any,
        payload: { message },
        author,
        authorType: 'human',
        respondsTo,
      });
      return event;
    }

    case 'channel.resolve': {
      const uid = requireString(params, 'uid');
      const status = (params.status as string) ?? 'resolved';
      const event = channelEventService.setChannelEventStatus(uid, status as any);
      return event;
    }

    case 'channel.thread': {
      const rootUid = requireString(params, 'rootUid');
      return channelEventService.listThread(rootUid);
    }

    case 'channel.get': {
      const uid = requireString(params, 'uid');
      const event = channelEventService.getChannelEvent(uid);
      if (!event) throw new Error(`Channel event not found: ${uid}`);
      return event;
    }

    // --- Input requests ------------------------------------------------------
    case 'input.respond': {
      const requestId = requireString(params, 'requestId');
      const response = requireString(params, 'response');
      remoteInteractionService.respondToInputRequest(requestId, response);
      return { ok: true };
    }

    // --- Graph ---------------------------------------------------------------
    case 'graph.overview': {
      const summary = getArchitectureSummary();
      // Enrich mostImported with resolved absolute paths (the raw
      // summary uses import source_path which is relative like './foo').
      const d = getDb();
      let enrichedMostImported = summary.mostImported;
      try {
        const r = d.exec(`
          SELECT i.resolved_path, COUNT(DISTINCT i.file_id) AS cnt
          FROM imports i
          WHERE i.resolved_path IS NOT NULL
          GROUP BY i.resolved_path
          ORDER BY cnt DESC
          LIMIT 10
        `);
        if (r[0]?.values.length) {
          enrichedMostImported = r[0].values.map((row: any[]) => ({
            path: row[0] as string,
            importerCount: row[1] as number,
          }));
        }
      } catch { /* resolved_path column may not exist */ }
      return { ...summary, mostImported: enrichedMostImported };
    }

    case 'graph.directory': {
      const dir = requireString(params, 'dir');
      return getDirectoryFiles(dir);
    }

    case 'graph.file': {
      const filePath = requireString(params, 'filePath');
      const symbols = getFileSymbols(filePath);
      const deps = getFileDependencies(filePath);
      // Get language from the files table
      const d = getDb();
      let language = 'unknown';
      try {
        const r = d.exec(`SELECT language FROM files WHERE path = ?`, [filePath]);
        if (r[0]?.values[0]) language = r[0].values[0][0] as string;
      } catch { /* */ }

      // Cross-system coupling edges (HTTP / SQL / subprocess) touching this
      // file. These are the runtime relationships beyond static imports —
      // e.g. "this file calls GET /api/users defined over there".
      let crossSystemOut: Array<{ path: string; relativePath: string; protocol: string; label: string }> = [];
      let crossSystemIn: Array<{ path: string; relativePath: string; protocol: string; label: string }> = [];
      try {
        const edges = listCrossSystemEdges();
        crossSystemOut = edges
          .filter((e) => e.source === filePath)
          .map((e) => ({ path: e.target, relativePath: e.targetRelative, protocol: e.protocol, label: e.label }));
        crossSystemIn = edges
          .filter((e) => e.target === filePath)
          .map((e) => ({ path: e.source, relativePath: e.sourceRelative, protocol: e.protocol, label: e.label }));
      } catch { /* cross-system table may not exist */ }

      return { filePath, language, symbols, ...deps, crossSystemOut, crossSystemIn };
    }

    // --- Changes / diff -------------------------------------------------------
    case 'changes.summary': {
      // Fall back to the most-recent project when the backend's in-memory
      // active path is null (e.g. after a restart that loaded the graph
      // from persistence without a fresh scan).
      const projectPath = (params.projectPath as string)
        || getActiveProjectPath()
        || recentProjectsService.listRecentProjects()[0]?.path;
      if (!projectPath) throw new Error('No active project on the desktop');

      const git = getGitWorkingTreeStatus(projectPath);

      // Architectural diff vs the captured baseline (added/removed/modified
      // files + blast radius). Mirrors the desktop /api/diff endpoint.
      let arch: ReturnType<typeof computeDiff> = null;
      const baseline = getBaseline();
      if (baseline) {
        try {
          const currentEdges = getDependencyEdges();
          const fileData = readFilesSnapshot(projectPath);
          arch = computeDiff(captureSnapshot(fileData, currentEdges));
        } catch { /* snapshot may fail if db not ready */ }
      }

      // Convenience union of changed relative paths (for badging the graph).
      const changed = new Set<string>();
      if (git) {
        for (const f of [
          ...git.stagedAdded, ...git.stagedModified, ...git.stagedDeleted,
          ...git.unstagedModified, ...git.unstagedDeleted, ...git.untracked,
        ]) changed.add(f);
      }
      if (arch) {
        for (const f of [...arch.addedFiles, ...arch.modifiedFiles]) changed.add(f);
      }

      return {
        hasBaseline: !!baseline,
        git,
        arch,
        changedFiles: [...changed],
      };
    }

    case 'graph.search': {
      const query = requireString(params, 'query');
      return searchSymbols(query);
    }

    // --- Filesystem browse (open a folder as a project from mobile) -----------
    case 'fs.browse': {
      // List directories under `dir` so the phone can navigate the desktop's
      // filesystem and pick a folder to open as a project. Defaults to $HOME.
      const dir = (params.dir as string) || os.homedir();
      return browseDirectory(dir);
    }

    // --- Renderable graph scene (cluster nodes + edges + planned/diverged) ----
    case 'graph.scene': {
      const planUid = (params.planUid as string) || undefined;
      const mode = (params.mode as string) || 'live'; // live | planned | diff
      return buildGraphScene(mode, planUid);
    }

    default:
      throw new Error(`Unknown RPC method: ${method}`);
  }
}

// --- Helpers -----------------------------------------------------------------

function requireString(params: Record<string, unknown>, key: string): string {
  const val = params[key];
  if (typeof val !== 'string' || !val) {
    throw new Error(`Missing required string parameter: ${key}`);
  }
  return val;
}

/** Run a getter, returning a fallback if it throws (service not ready / no rows). */
function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

// --- Filesystem browse -------------------------------------------------------

interface BrowseEntry {
  name: string;
  path: string;
  isGitRepo: boolean;
  hasProjectMarker: boolean; // package.json / Cargo.toml / pom.xml / go.mod / pyproject.toml
}

const PROJECT_MARKERS = ['package.json', 'Cargo.toml', 'pom.xml', 'go.mod', 'pyproject.toml', 'composer.json', 'build.gradle'];

/**
 * List sub-directories of `dir` so the mobile app can navigate the desktop
 * filesystem and open a folder as a project. Hidden dirs (except a few
 * common ones) and noisy build dirs are filtered out. Each entry is flagged
 * if it looks like a project root (git repo or has a known manifest).
 */
function browseDirectory(dir: string): {
  path: string;
  parent: string | null;
  home: string;
  entries: BrowseEntry[];
} {
  const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache', 'target', '.venv', 'venv', '__pycache__', 'Library', '.Trash']);
  let entries: BrowseEntry[] = [];
  try {
    const dirents = fs.readdirSync(dir, { withFileTypes: true });
    entries = dirents
      .filter((e) => e.isDirectory() && !SKIP.has(e.name) && (!e.name.startsWith('.') || e.name === '.codetrellis'))
      .map((e) => {
        const full = path.join(dir, e.name);
        return {
          name: e.name,
          path: full,
          isGitRepo: safe(() => fs.existsSync(path.join(full, '.git')), false),
          hasProjectMarker: safe(() => PROJECT_MARKERS.some((m) => fs.existsSync(path.join(full, m))), false),
        };
      })
      .sort((a, b) => {
        // Project-looking dirs first, then alphabetical.
        const ap = a.isGitRepo || a.hasProjectMarker ? 0 : 1;
        const bp = b.isGitRepo || b.hasProjectMarker ? 0 : 1;
        return ap - bp || a.name.localeCompare(b.name);
      });
  } catch {
    // Unreadable dir — return empty so the UI shows "nothing here" rather than crash.
  }
  const parent = path.dirname(dir);
  return {
    path: dir,
    parent: parent === dir ? null : parent,
    home: os.homedir(),
    entries,
  };
}

// --- Graph scene (cluster-level, render-ready for mobile) ---------------------

type NodeState = 'normal' | 'changed' | 'planned_add' | 'planned_modify' | 'planned_remove';

interface SceneNode {
  id: string;        // cluster id (relative path prefix) or `ghost:<path>`
  label: string;
  fileCount: number;
  state: NodeState;
  ghost?: boolean;
}
interface SceneEdge { source: string; target: string; weight: number; planned?: boolean }

/** Cluster key for a relative path — first two segments (or one for top-level). */
function clusterKey(rel: string): string {
  const parts = rel.split('/');
  if (parts.length <= 1) return '(root)';
  if (parts.length === 2) return parts[0];
  return `${parts[0]}/${parts[1]}`;
}

/**
 * Build a mobile-render-ready graph scene: directory clusters as nodes,
 * aggregated cross-cluster imports as edges. Overlays planned state (from a
 * plan's projection) and diverged state (git working-tree + arch diff) so the
 * phone can show Live / Planned / Diff visually with state-coloured nodes.
 */
function buildGraphScene(mode: string, planUid?: string): {
  mode: string;
  projectPath: string | null;
  nodes: SceneNode[];
  edges: SceneEdge[];
  counts: { nodes: number; edges: number; changed: number; planned: number };
} {
  const projectPath = getActiveProjectPath()
    || recentProjectsService.listRecentProjects()[0]?.path
    || null;

  const depEdges = safe(() => getDependencyEdges(), [] as ReturnType<typeof getDependencyEdges>);

  const clusters = new Map<string, { fileCount: number; files: Set<string>; state: NodeState }>();
  const ensure = (key: string) => {
    let c = clusters.get(key);
    if (!c) { c = { fileCount: 0, files: new Set(), state: 'normal' }; clusters.set(key, c); }
    return c;
  };
  const addFile = (rel: string) => { const c = ensure(clusterKey(rel)); if (!c.files.has(rel)) { c.files.add(rel); c.fileCount++; } };

  const edgeAgg = new Map<string, { source: string; target: string; weight: number; planned?: boolean }>();
  for (const e of depEdges) {
    addFile(e.sourceRelative);
    addFile(e.targetRelative);
    const s = clusterKey(e.sourceRelative);
    const t = clusterKey(e.targetRelative);
    if (s === t) continue;
    const key = `${s}->${t}`;
    const agg = edgeAgg.get(key);
    if (agg) agg.weight++;
    else edgeAgg.set(key, { source: s, target: t, weight: 1 });
  }

  // --- Diverged overlay (git working tree + arch diff vs baseline) ---
  let changedCount = 0;
  if (mode === 'diff' || mode === 'live') {
    const changed = new Set<string>();
    if (projectPath) {
      const git = safe(() => getGitWorkingTreeStatus(projectPath), null);
      if (git) {
        for (const f of [
          ...git.stagedAdded, ...git.stagedModified, ...git.stagedDeleted,
          ...git.unstagedModified, ...git.unstagedDeleted, ...git.untracked,
        ]) changed.add(f);
      }
      const baseline = safe(() => getBaseline(), null);
      if (baseline) {
        const arch = safe(() => {
          const currentEdges = getDependencyEdges();
          const fileData = readFilesSnapshot(projectPath);
          return computeDiff(captureSnapshot(fileData, currentEdges));
        }, null);
        if (arch) for (const f of [...arch.addedFiles, ...arch.modifiedFiles]) changed.add(f);
      }
    }
    for (const f of changed) {
      const c = clusters.get(clusterKey(f));
      if (c && c.state === 'normal') { c.state = 'changed'; }
    }
    changedCount = changed.size;
  }

  // --- Planned overlay (projection of a plan's actions) ---
  let plannedCount = 0;
  if ((mode === 'planned' || planUid) && planUid) {
    const proj = safe(() => computeProjection(planUid), null);
    if (proj) {
      const mark = (relPath: string, state: NodeState, ghostOk: boolean) => {
        const key = clusterKey(relPath);
        let c = clusters.get(key);
        if (!c && ghostOk) { c = ensure(key); c.fileCount = c.fileCount; }
        if (c) c.state = state;
      };
      for (const g of proj.ghostFiles) { ensure(clusterKey(g.path)).state = 'planned_add'; }
      for (const m of proj.modifiedFiles) mark(m.path, 'planned_modify', false);
      for (const r of proj.removedFiles) mark(r.path, 'planned_remove', false);
      plannedCount = proj.ghostFiles.length + proj.modifiedFiles.length + proj.removedFiles.length;
    }
  }

  const nodes: SceneNode[] = [...clusters.entries()].map(([id, c]) => ({
    id,
    label: id,
    fileCount: c.fileCount,
    state: c.state,
  }));
  const edges: SceneEdge[] = [...edgeAgg.values()];

  return {
    mode,
    projectPath,
    nodes,
    edges,
    counts: { nodes: nodes.length, edges: edges.length, changed: changedCount, planned: plannedCount },
  };
}

// --- Graph helpers -----------------------------------------------------------

/**
 * List files in a directory with symbol counts and connection counts.
 * `dir` is a relative directory prefix (e.g. "src/backend").
 */
function getDirectoryFiles(dir: string): {
  dir: string;
  files: Array<{
    path: string;
    relativePath: string;
    language: string;
    symbolCount: number;
    importCount: number;
    importedByCount: number;
  }>;
  subdirectories: Array<{ name: string; fileCount: number }>;
} {
  const d = getDb();
  const prefix = dir.endsWith('/') ? dir : `${dir}/`;

  // Files directly in this directory (not in subdirectories)
  const filesResult = d.exec(`
    SELECT f.path, f.relative_path, f.language,
      (SELECT COUNT(*) FROM symbols s WHERE s.file_id = f.id AND s.parent_symbol_id IS NULL) AS sym_count,
      (SELECT COUNT(*) FROM imports i WHERE i.file_id = f.id) AS import_count,
      (SELECT COUNT(DISTINCT i2.file_id) FROM imports i2 WHERE i2.resolved_path = f.path) AS imported_by_count
    FROM files f
    WHERE f.relative_path LIKE ? AND f.relative_path NOT LIKE ?
    ORDER BY f.relative_path
  `, [`${prefix}%`, `${prefix}%/%`]);

  const files = (filesResult[0]?.values ?? []).map((row: any[]) => ({
    path: row[0] as string,
    relativePath: row[1] as string,
    language: row[2] as string,
    symbolCount: row[3] as number,
    importCount: row[4] as number,
    importedByCount: row[5] as number,
  }));

  // Subdirectories (next level only)
  const subdirResult = d.exec(`
    SELECT
      SUBSTR(f.relative_path, LENGTH(?) + 1,
        INSTR(SUBSTR(f.relative_path, LENGTH(?) + 1), '/') - 1
      ) AS subdir,
      COUNT(*) AS cnt
    FROM files f
    WHERE f.relative_path LIKE ?
      AND SUBSTR(f.relative_path, LENGTH(?) + 1) LIKE '%/%'
    GROUP BY subdir
    HAVING subdir != ''
    ORDER BY cnt DESC
  `, [prefix, prefix, `${prefix}%`, prefix]);

  const subdirectories = (subdirResult[0]?.values ?? []).map((row: any[]) => ({
    name: row[0] as string,
    fileCount: row[1] as number,
  }));

  return { dir, files, subdirectories };
}
