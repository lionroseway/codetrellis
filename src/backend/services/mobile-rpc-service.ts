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
import {
  scanProject,
  getActiveProjectPath,
  readFilesSnapshot,
  getGitWorkingTreeStatus,
  broadcast,
} from '../server';

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
      return { plan, items, deviations };
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
      return item;
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
