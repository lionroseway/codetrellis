// [codemod] hoisted lazy requires → static namespace imports for bundling
import * as _lazy___services_settings_service from './services/settings-service';
import * as _lazy___services_project_config_service from './services/project-config-service';
import * as _lazy___services_external_pointer_service from './services/external-pointer-service';
import * as _lazy___services_system_docs_service from './services/system-docs-service';
import * as _lazy___services_recent_projects_service from './services/recent-projects-service';
import * as _lazy___services_git_identity from './services/git-identity';
import * as _lazy___services_mdns_service from './services/mdns-service';
import * as _lazy___services_mobile_api_server from './services/mobile-api-server';
import * as _lazy___services_personal_sync_service from './services/personal-sync-service';
import * as _lazy___services_git_activity_service from './services/git-activity-service';
import * as _lazy___services_plan_history_service from './services/plan-history-service';
import * as _lazy___services_plan_conflict_service from './services/plan-conflict-service';
import * as _lazy___services_freeze_service from './services/freeze-service';
import * as _lazy___services_audio_buffer_service from './services/audio-buffer-service';
import * as _lazy___services_pantry_resolution_service from './services/pantry-resolution-service';
import * as _lazy___services_contribution_service from './services/contribution-service';
import * as _lazy___services_sensor_bridge_service from './services/sensor-bridge-service';
import * as _lazy___services_channel_dispatcher_service from './services/channel-dispatcher-service';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { WebSocketServer, WebSocket } from 'ws';
import { scanDirectory, countFiles, collectFilePaths } from './services/project-scanner';
import { detectMonorepo } from './services/monorepo-detector';
import { initParser, parseFiles, parseVirtualFile, computeFileHash, getParserHealth } from './services/ast-parser';
import { localAuthMiddleware, isUpgradeAuthorised } from './middleware/local-auth';
import { isSafeGitRef } from './services/git-safety';
import { readFileWithin, isWithin, isInside, ConfinementError } from './services/confined-fs';

/** Cap on /api/fs/browse output — a huge directory must not stall the backend. */
const MAX_BROWSE_ENTRIES = 1000;
import { resolveTrustedProjectRoot, listTrustedRoots, setActiveProjectRoot, projectRelative } from './services/trusted-roots';
import { getCoverageReport } from './services/coverage-service';
import * as externalIntakeService from './services/external-intake-service';
import { initCapabilityToken, getTokenFilePath } from './services/capability-token';
import { initDatabase, storeParsedFile, searchSymbols, getFileSymbols, getDbStats, getArchitectureSummary, resolveImports, getDependencyEdges, getFileDependencies, clearAstData, getAllFileHashes, removeStaleFiles } from './services/database';
import { startWatching } from './services/file-watcher';
import { startClaudeCodeWatcher, getWatcherStatus } from './agent/claude-code-watcher';
import { captureSnapshot, setBaseline, computeDiff, getBaseline } from './services/diff-engine';
import { startMcpServer, getMcpStatus, getMcpConfig } from './mcp/server';
import { startAutoSave, saveNow } from './services/persistence';
import { exportDatabase } from './services/database';
import * as planService from './services/plan-service';
import * as budgetService from './services/budget-service';
import { compareSnapshots, listComparands, readFileAt } from './services/snapshot-compare-service';
import { reviewPlan, renderReviewMarkdown } from './services/plan-review-service';
import { buildPrDraft } from './services/pr-draft-service';
import { buildFileOverlay, relativeTo } from './services/plan-overlay-service';
import { buildPlaybackSequence } from './services/playback-service';
import * as commentService from './services/comment-service';
import * as sessionService from './services/session-service';
import * as taskAttachmentsService from './services/task-attachments-service';
// Phase 15 §C — unified Object/Action surface backing the V2 frontend.
import * as planItemService from './services/plan-item-service';
import * as planEventService from './services/plan-event-service';
import * as channelEventService from './services/channel-event-service';
import { exportChannelEvent } from './services/channel-event-file-service';
import { dispatchChannelEvent } from './services/channel-dispatcher-service';
import {
  recordProjectOpen,
  listRecentProjects,
  removeRecentProject,
  setRecentProjectPinned,
} from './services/recent-projects-service';
import { discoverSystems, buildAliasMap } from './services/system-discovery';
// Top-of-file imports for everything that used to be lazy-required.
// Vite's Electron main bundle doesn't statically resolve runtime
// `_lazy___services____` paths, so they fail at runtime
// (MODULE_NOT_FOUND from inside `.vite/build/main.js`). Static
// imports get bundled cleanly. The original lazy-require pattern
// existed to dodge import cycles that no longer apply.
import { recomputeCrossSystemEdges, listCrossSystemEdges, getCrossSystemStats } from './services/cross-system-service';
import { startPlanFileWatcher, exportPlan, importPlan, discoverPlanDirs, unlinkPlan, getLinkedPlanDir, reconcilePlanState, pruneOrphanedDirs } from './services/plan-file-service';
import { getAllGraphEdges, getDb } from './services/database';
import { getSettings, updateSettings, getAuthorKey, readGitIdentity } from './services/settings-service';
import { captureCurrentTrellis, listSnapshots, computeTrellisDiff, getSnapshot } from './services/trellis-service';
import { computeProjection } from './services/projection-service';
import { getDeviations, resolveDeviation } from './services/deviation-service';
import * as presenceService from './services/presence-service';
import { applyTemplate } from './services/plan-templates-service';
import { listTemplates } from './services/plan-templates';
import { publishPlanAsTemplate } from './services/plan-template-publish-service';
import {
  createPhase, updatePhase, deletePhase, listPhases,
} from './services/plan-phases-service';
import {
  createPlanDocument, updatePlanDocument, deletePlanDocument,
  getPlanDocument, getPlanDocumentByType, getPlanDocumentVersions,
  listPlanDocuments, listPlanDocumentSummaries, searchPlanDocuments,
} from './services/plan-documents-service';
import { listProposedChanges, summarizeChanges, getChange } from './services/plan-changes-service';
import * as externalRefsService from './services/external-refs-service';
import * as terminalService from './services/terminal-service';
import * as powerService from './services/power-service';
import * as terminalHistoryService from './services/terminal-history-service';
import * as planImportService from './services/plan-import-service';
import { tailLog, getCurrentLogPath, getLogDir } from './services/logger';
import {
  getUpdateState,
  checkForUpdate,
  startUpdatePolling,
} from './services/update-service';
import {
  startUpdateDownload,
  getUpdateDownloadState,
  cancelUpdateDownload,
} from './services/update-download-service';
import { BUILD_INFO } from '../shared/build-info';
import * as peerService from './services/peer-connection-service';
import { setDeviceCapabilities } from './services/paired-device-service';
import { listPeerAudit } from './services/peer-audit-service';

const app = express();
app.use(express.json());

/**
 * Origin / Host / capability-token enforcement.
 *
 * This REPLACED a middleware that reflected the caller's origin back with
 * `Access-Control-Allow-Credentials: true`, on the stated reasoning that
 * "we already gate access at the bind level (loopback only)".
 *
 * That reasoning was wrong, and it was the root of most of the Phase 19
 * register. Loopback keeps out other machines; it does not keep out the
 * user's own browser. Any page the user visited could call this API and,
 * because of the reflection, read the responses.
 *
 * The packaged renderer does not need permissive CORS — it talks over IPC,
 * not HTTP (`electron-ipc-shim.ts`). Only the dev server needs an origin,
 * and it gets an exact one.
 *
 * See src/backend/middleware/local-auth.ts for the three layers.
 */
app.use(localAuthMiddleware);

/**
 * CONFINED TO OPENED PROJECTS (Phase 19).
 *
 * A project root is **never caller-nominated**. The rule in CLAUDE.md is
 * worded "never accept `projectRoot` / `projectPath` from a request
 * body" — but a query parameter is exactly as caller-nominated as a body
 * field. The wording was narrower than the rule, and twenty-six handlers
 * read `req.query.project` and passed it straight on.
 *
 * It is not theoretical. Several of those paths become a process working
 * directory: `listComparands` runs `git log` in one, so the value
 * selects the repository a command executes in. That compounds with the
 * standing Phase 19 position that **loopback is not an authorisation
 * boundary** — any page in any browser on the machine can reach this
 * server.
 *
 * `resolveTrustedProjectRoot` canonicalises the candidate and requires
 * it to be one of the opened projects, so a symlink or a `..` cannot
 * walk out of one.
 *
 * ## Why these are the only two readers
 *
 * Fixing twenty-six call sites leaves a twenty-seventh to be written
 * next month. `server-confinement.test.ts` asserts that
 * `req.query.project` appears **nowhere else in this file**, so a new
 * handler cannot quietly read it raw. That is the same move as
 * `getParseableExtensions()` and `flattenSymbols()` elsewhere in this
 * codebase: derive it or assert it, rather than asking the next person
 * to remember.
 *
 * ## `null` and `undefined` are different answers
 *
 * Both helpers respond on refusal and return `null` — the caller must
 * stop. `optionalProjectRoot` returns `undefined` when the caller
 * supplied nothing, which is a legitimate state for the few endpoints
 * that run before a project is open (the first-run wizard reading git
 * identity, for one). Callers therefore compare with `=== null`, never
 * falsy.
 */
function confineRoot(
  candidate: unknown,
  res: express.Response,
  label = 'projectPath',
): string | null {
  if (candidate === undefined || candidate === null || candidate === '') {
    res.status(400).json({ error: `${label} is required` });
    return null;
  }
  try {
    return resolveTrustedProjectRoot(candidate, label);
  } catch (err) {
    res.status(err instanceof ConfinementError ? 403 : 400).json({
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * The same check where a body-supplied root is genuinely optional.
 *
 * Attachments are the case: `resolveAttachmentDir` handles an undefined
 * root explicitly — without one there is simply no per-project layer and
 * the attachment lands in the user directory. Making it required would
 * have broken adding an attachment outside a project, which is why the
 * sweep classified each body site by whether it already guarded rather
 * than assuming.
 */
function confineRootOptional(
  candidate: unknown,
  res: express.Response,
  label = 'projectRoot',
): string | undefined | null {
  if (candidate === undefined || candidate === null || candidate === '') return undefined;
  return confineRoot(candidate, res, label);
}

/**
 * The same check for the handlers that spell the parameter `?path=`
 * rather than `?project=` — the six `git/*` routes among them, which
 * run git with it as `cwd`.
 */
function requireProjectPath(req: express.Request, res: express.Response): string | null {
  return confineRoot(req.query.path, res, 'path');
}

function requireProjectRoot(req: express.Request, res: express.Response): string | null {
  // "You sent no parameter" is a client error, not a refusal — see
  // confineRoot, which keeps the two apart. Collapsing them onto 403
  // told a caller who simply forgot the parameter that they were denied.
  const raw = req.query.project;
  if (raw === undefined || raw === null || raw === '') {
    res.status(400).json({ error: 'project query param required' });
    return null;
  }
  return confineRoot(raw, res, 'project');
}

/**
 * The same check where the parameter is optional.
 *
 * Absent stays absent — this never invents a root. Present is confined,
 * so "optional" never comes to mean "unchecked".
 */
function optionalProjectRoot(
  req: express.Request,
  res: express.Response,
): string | undefined | null {
  const raw = req.query.project;
  if (raw === undefined || raw === null || raw === '') return undefined;
  try {
    return resolveTrustedProjectRoot(raw, 'project');
  } catch (err) {
    res.status(err instanceof ConfinementError ? 403 : 400).json({
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

const server = http.createServer(app);

// WebSocket servers — use `noServer` mode so we can manually route
// the HTTP upgrade event.  Two WSS instances bound to the same
// `server` via `{ server, path }` both fire on every upgrade and
// one corrupts the other's handshake → "Invalid frame header".
const wss = new WebSocketServer({ noServer: true });
const clients = new Set<WebSocket>();

/**
 * Maximum concurrent WebSocket clients on the event channel.
 * Each Playwright test page opens 1-2 WS connections; a sustained
 * test suite can accumulate hundreds. Unbounded growth causes
 * O(n) broadcast cost per event and memory pressure.
 */
const MAX_WS_CLIENTS = 100;

/**
 * When a client has more than this many bytes queued in the kernel
 * send buffer, skip it during broadcast. Prevents a single slow
 * consumer (e.g. a disconnecting browser tab) from blocking the
 * event loop via backpressure.
 */
const WS_BACKPRESSURE_THRESHOLD = 64 * 1024; // 64 KB

wss.on('connection', (ws) => {
  if (clients.size >= MAX_WS_CLIENTS) {
    console.warn(`[WS] Client limit reached (${MAX_WS_CLIENTS}) — rejecting connection`);
    ws.close(1013, 'Server busy');
    return;
  }
  clients.add(ws);
  ws.on('error', (err) => {
    console.error('[WS] Client socket error:', err.message);
    clients.delete(ws);
  });
  ws.on('close', () => clients.delete(ws));
});

wss.on('error', (err) => {
  console.error('[WS] Server error:', err.message);
});

/**
 * Extra broadcast targets — anything that wants to receive `broadcast()`
 * events alongside the WS clients. Electron's main process registers
 * the renderer's `webContents.send` here so backend events reach the
 * renderer without a WebSocket connection.
 */
export type BroadcastTarget = (message: { type: string; payload: unknown }) => void;
const extraBroadcastTargets = new Set<BroadcastTarget>();

export function addBroadcastTarget(target: BroadcastTarget): () => void {
  extraBroadcastTargets.add(target);
  return () => extraBroadcastTargets.delete(target);
}

export function broadcast(type: string, payload: unknown): number {
  const message = JSON.stringify({ type, payload });
  let sent = 0;
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      // Skip clients whose send buffer is backed up — a slow consumer
      // (disconnecting tab, overloaded browser) shouldn't stall the
      // broadcast loop or cause unbounded kernel buffer growth.
      if (client.bufferedAmount > WS_BACKPRESSURE_THRESHOLD) continue;
      client.send(message);
      sent++;
    }
  }
  // Also fan out to any non-WS targets (Electron renderer via IPC, etc.).
  if (extraBroadcastTargets.size > 0) {
    const decoded = { type, payload };
    for (const target of extraBroadcastTargets) {
      try {
        target(decoded);
        sent++;
      } catch {
        // A bad target shouldn't take down the broadcast loop; the
        // worst case is that one renderer misses an event.
      }
    }
  }
  return sent;
}

// --- Terminal WebSocket (separate from the event broadcast WS) ---
// Terminal I/O is high-bandwidth binary; we keep it on its own WS
// path so it doesn't clog the `/ws` event channel.
const terminalWss = new WebSocketServer({ noServer: true });

// Map terminal ID → connected frontend WS(s)
const terminalClients = new Map<string, Set<WebSocket>>();

terminalWss.on('connection', (ws, req) => {
  // Client connects with ?id=<terminal-id>
  const url = new URL(req.url ?? '', 'http://localhost');
  const termId = url.searchParams.get('id');
  if (!termId) {
    ws.close(4000, 'Missing terminal id query param');
    return;
  }

  // Register this WS for the terminal
  if (!terminalClients.has(termId)) {
    terminalClients.set(termId, new Set());
  }
  terminalClients.get(termId)!.add(ws);

  ws.on('message', (msg) => {
    // Messages from frontend → write to PTY
    const data = msg.toString();
    try {
      const parsed = JSON.parse(data);
      if (parsed.type === 'input') {
        terminalService.writeTerminal(termId, parsed.data);
      } else if (parsed.type === 'resize') {
        terminalService.resizeTerminal(termId, parsed.cols, parsed.rows);
      }
    } catch {
      // Raw text — treat as input
      terminalService.writeTerminal(termId, data);
    }
  });

  ws.on('close', () => {
    const set = terminalClients.get(termId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) terminalClients.delete(termId);
    }
  });
});

// Wire terminal service output → connected WS clients
terminalService.onTerminalData((id, data) => {
  const set = terminalClients.get(id);
  if (!set) return;
  const msg = JSON.stringify({ type: 'output', data });
  for (const ws of set) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
});

terminalService.onTerminalExit((id, code) => {
  const set = terminalClients.get(id);
  if (!set) return;
  const msg = JSON.stringify({ type: 'exit', code });
  for (const ws of set) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
  terminalClients.delete(id);
});

// --- Manual HTTP upgrade routing ---
// Route each incoming WebSocket upgrade to the correct WSS based on
// the request pathname.  This avoids the "Invalid frame header" bug
// that occurs when two WSS instances both bind to `{ server }`.
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url ?? '', 'http://localhost').pathname;

  // AUTHENTICATE BEFORE ROUTING.
  //
  // Upgrades never touch Express, so the middleware above does not see them.
  // Without this check the WebSocket is an unauthenticated way around every
  // control on the HTTP side — and `/terminal-ws` carries live PTY I/O, so
  // that is the most valuable socket in the app to leave open.
  //
  // Browsers cannot set headers on a WebSocket handshake, so the token
  // arrives as a query parameter here (see capability-token.ts).
  const auth = isUpgradeAuthorised(
    request.headers as Record<string, string | string[] | undefined>,
    request.url,
  );
  if (!auth.ok) {
    // Answer with a real HTTP status rather than a bare destroy, so a
    // legitimate client that forgot its token gets a diagnosable failure
    // instead of a silent disconnect.
    socket.write(
      `HTTP/1.1 401 Unauthorized\r\n` +
        `Connection: close\r\n` +
        `Content-Type: text/plain\r\n\r\n` +
        `${auth.reason}\n`,
    );
    socket.destroy();
    return;
  }

  if (pathname === '/terminal-ws') {
    terminalWss.handleUpgrade(request, socket, head, (ws) => {
      terminalWss.emit('connection', ws, request);
    });
  } else if (pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    // Not a known WS path — destroy the socket
    socket.destroy();
  }
});

// --- Terminal REST API ---

app.get('/api/terminals', (_req, res) => {
  res.json(terminalService.listTerminals());
});

app.post('/api/terminals', (req, res) => {
  try {
    const { preset, cwd, cols, rows, title } = req.body ?? {};
    const session = terminalService.createTerminal({ preset, cwd, cols, rows, title });
    broadcast('terminal-created', { session });
    res.json(session);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[terminal] Failed to create terminal:', message);
    const status = message.includes('limit reached') ? 503 : 500;
    res.status(status).json({ error: 'Failed to create terminal', detail: message });
  }
});

app.post('/api/terminals/:id/inject', (req, res) => {
  const { text } = req.body;
  if (!text) { res.status(400).json({ error: 'text required' }); return; }
  const ok = terminalService.injectPrompt(req.params.id, text);
  if (!ok) { res.status(404).json({ error: 'Terminal not found or dead' }); return; }
  res.json({ ok: true });
});

app.delete('/api/terminals/:id', (req, res) => {
  const ok = terminalService.killTerminal(req.params.id);
  if (!ok) { res.status(404).json({ error: 'Terminal not found' }); return; }
  broadcast('terminal-killed', { id: req.params.id });
  res.json({ ok: true });
});

// --- Screenshot response endpoint (MCP screenshot tool) ---
// The MCP `screenshot` tool broadcasts a request to the frontend;
// the frontend captures the viewport and POSTs the base64 PNG here.
app.post('/api/screenshot-response', (req, res) => {
  const { nonce, data } = req.body || {};
  if (!nonce) {
    res.status(400).json({ error: 'nonce is required' });
    return;
  }
  const resolver = (globalThis as any).__screenshotResolve as
    ((nonce: string, data: string) => void) | undefined;
  if (resolver) {
    // If data is empty the capture failed — still resolve with empty
    // string so the MCP tool can return an error instead of timing out.
    resolver(nonce, data || '');
  }
  res.json({ ok: true });
});

// --- Presence Pane endpoints ---

// Get all presence cards (for initial hydration)
app.get('/api/presence/cards', (_req, res) => {
  res.json(presenceService.getCards());
});

// Ack a presence card — resolves the pending await_ack promise
app.post('/api/presence/ack', (req, res) => {
  const { cardId, via } = req.body || {};
  if (!cardId || !via) {
    res.status(400).json({ error: 'cardId and via are required' });
    return;
  }
  const card = presenceService.ackCard(cardId, via);
  if (!card) { res.status(404).json({ error: 'Card not found' }); return; }

  // Resolve the pending await_ack promise
  const nonce = `ack-${cardId}`;
  const resolver = (globalThis as any).__presenceResolve as
    ((nonce: string, data: string) => void) | undefined;
  if (resolver) {
    resolver(nonce, JSON.stringify({ acked: true, via, card_id: cardId }));
  }

  broadcast('presence-acked', { cardId, via });
  res.json({ ok: true });
});

// User reply — resolves the pending await_user_input promise
app.post('/api/presence/reply', (req, res) => {
  const { text } = req.body || {};
  if (!text) {
    res.status(400).json({ error: 'text is required' });
    return;
  }
  const reply = presenceService.postReply(text);

  // Resolve the pending await_user_input promise if one exists
  const nonce = (globalThis as any).__presenceReplyNonce as string | undefined;
  if (nonce) {
    const resolver = (globalThis as any).__presenceResolve as
      ((nonce: string, data: string) => void) | undefined;
    if (resolver) {
      resolver(nonce, JSON.stringify({ text: reply.text, at: reply.createdAt }));
    }
    (globalThis as any).__presenceReplyNonce = undefined;
  }

  broadcast('presence-reply', { reply });
  res.json({ ok: true, reply });
});

// --- API Routes ---

// Health check
app.get('/api/health', (_req, res) => {
  const heap = process.memoryUsage();
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    parser: getParserHealth(),
    memory: {
      heapUsedMB: Math.round(heap.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(heap.heapTotal / 1024 / 1024),
      rssMB: Math.round(heap.rss / 1024 / 1024),
      externalMB: Math.round(heap.external / 1024 / 1024),
    },
    connections: {
      wsClients: clients.size,
      terminalSessions: terminalService.listTerminals().length,
    },
  });
});

// Get git branch for a path
app.get('/api/git/branch', (req, res) => {
  const projectPath = requireProjectPath(req, res);
  if (!projectPath) return;

  try {
    const headPath = path.join(projectPath, '.git', 'HEAD');
    if (fs.existsSync(headPath)) {
      const head = fs.readFileSync(headPath, 'utf-8').trim();
      const match = head.match(/^ref: refs\/heads\/(.+)$/);
      res.json({ branch: match ? match[1] : 'detached' });
    } else {
      res.json({ branch: null });
    }
  } catch {
    res.json({ branch: null });
  }
});

// List git branches and worktrees for a project
app.get('/api/git/info', (req, res) => {
  const projectPath = requireProjectPath(req, res);
  if (!projectPath) return;

  const gitDir = path.join(projectPath, '.git');
  if (!fs.existsSync(gitDir)) { res.json({ branches: [], worktrees: [], status: null }); return; }

  // Current branch
  let currentBranch: string | null = null;
  try {
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf-8').trim();
    const match = head.match(/^ref: refs\/heads\/(.+)$/);
    currentBranch = match ? match[1] : 'detached';
  } catch { /* ignore */ }

  // List branches
  const branches: string[] = [];
  const refsDir = path.join(gitDir, 'refs', 'heads');
  if (fs.existsSync(refsDir)) {
    try {
      const readBranches = (dir: string, prefix = '') => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            readBranches(path.join(dir, entry.name), `${prefix}${entry.name}/`);
          } else {
            branches.push(`${prefix}${entry.name}`);
          }
        }
      };
      readBranches(refsDir);
    } catch { /* ignore */ }
  }

  // List worktrees
  const worktrees: Array<{ path: string; branch: string | null }> = [];
  const worktreesDir = path.join(gitDir, 'worktrees');
  if (fs.existsSync(worktreesDir)) {
    try {
      for (const entry of fs.readdirSync(worktreesDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const wtDir = path.join(worktreesDir, entry.name);
        let wtBranch: string | null = null;
        try {
          const head = fs.readFileSync(path.join(wtDir, 'HEAD'), 'utf-8').trim();
          const match = head.match(/^ref: refs\/heads\/(.+)$/);
          wtBranch = match ? match[1] : null;
        } catch { /* ignore */ }
        // Read gitdir to find worktree path
        let wtPath: string | null = null;
        try {
          wtPath = fs.readFileSync(path.join(wtDir, 'gitdir'), 'utf-8').trim();
          wtPath = path.dirname(wtPath); // gitdir points to .git inside worktree
        } catch { /* ignore */ }
        worktrees.push({ path: wtPath || entry.name, branch: wtBranch });
      }
    } catch { /* ignore */ }
  }

  // Git status summary (untracked, modified, staged counts)
  let untracked = 0;
  try {
    // Quick scan — check if index exists
    const indexExists = fs.existsSync(path.join(gitDir, 'index'));
    if (!indexExists) {
      // No index = no commits yet, everything is untracked
      untracked = -1; // signal "no commits"
    }
  } catch { /* ignore */ }

  res.json({ currentBranch, branches, worktrees, hasCommits: untracked !== -1 });
});

app.get('/api/git/status', (req, res) => {
  const projectPath = requireProjectPath(req, res);
  if (!projectPath) return;

  res.json(getGitWorkingTreeStatus(projectPath) || {
    staged: [],
    unstaged: [],
    untracked: [],
    stagedAdded: [],
    stagedModified: [],
    stagedDeleted: [],
    unstagedModified: [],
    unstagedDeleted: [],
    commitHash: null,
    shortCommitHash: null,
  });
});

app.get('/api/git/head', (req, res) => {
  const projectPath = requireProjectPath(req, res);
  if (!projectPath) return;

  res.json(getGitHeadCommit(projectPath) || { commitHash: null, shortCommitHash: null });
});

// Resolve a branch name to its tip commit. Used by the branch popover to set
// the diff baseline to "branch X's HEAD" without checking it out.
app.get('/api/git/branch-tip', (req, res) => {
  const projectPath = requireProjectPath(req, res);
  if (!projectPath) return;
  const branch = req.query.branch as string;
  if (!branch) {
    res.status(400).json({ error: 'branch query param required' });
    return;
  }
  // `git rev-parse <branch>` reads any argument starting with `-` as a flag
  // (Phase 19, finding 10). execFileSync stops shell injection, not option
  // injection, and there is no `--` position that protects this operand.
  if (!isSafeGitRef(branch)) {
    res.status(400).json({ error: 'Invalid branch name' });
    return;
  }

  try {
    const commitHash = execFileSync(
      'git',
      ['-C', projectPath, 'rev-parse', branch],
      { encoding: 'utf8' },
    ).trim();
    if (!commitHash) {
      res.json({ commitHash: null, shortCommitHash: null });
      return;
    }
    res.json({ commitHash, shortCommitHash: commitHash.slice(0, 7) });
  } catch {
    res.json({ commitHash: null, shortCommitHash: null });
  }
});

app.get('/api/git/commits', (req, res) => {
  const projectPath = requireProjectPath(req, res);
  if (!projectPath) return;
  const limitParam = Number(req.query.limit);

  res.json({
    commits: getRecentGitCommits(projectPath, Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 20),
  });
});

// Auto-detect ALL active Claude Code sessions
app.get('/api/auto-detect', (_req, res) => {
  const sessionsDir = path.join(os.homedir(), '.claude', 'sessions');
  if (!fs.existsSync(sessionsDir)) { res.json({ sessions: [] }); return; }

  const sessionFiles = fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.json'));
  const activeSessions: Array<{ projectPath: string; sessionId: string; name: string; branch: string | null }> = [];
  const seenPaths = new Set<string>();

  for (const file of sessionFiles) {
    try {
      const session = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf-8'));
      try { process.kill(session.pid, 0); } catch { continue; }
      if (!session.cwd || !fs.existsSync(session.cwd)) continue;
      if (seenPaths.has(session.cwd)) continue;
      seenPaths.add(session.cwd);

      // Get branch
      let branch: string | null = null;
      try {
        const headPath = path.join(session.cwd, '.git', 'HEAD');
        if (fs.existsSync(headPath)) {
          const head = fs.readFileSync(headPath, 'utf-8').trim();
          const match = head.match(/^ref: refs\/heads\/(.+)$/);
          branch = match ? match[1] : 'detached';
        }
      } catch { /* ignore */ }

      activeSessions.push({
        projectPath: session.cwd,
        sessionId: session.sessionId,
        name: session.name || session.cwd.split('/').pop() || 'project',
        branch,
      });
    } catch { continue; }
  }

  res.json({ sessions: activeSessions });
});

// Recent projects — list, remove, pin
app.get('/api/recent-projects', (_req, res) => {
  res.json({ projects: listRecentProjects() });
});

/**
 * NOT CONFINED, deliberately — and this is the distinction that matters.
 *
 * Confinement protects a path that is USED as a path: opened, walked, or
 * made the working directory of a command. Here the string is only a KEY
 * into the recent-projects list. Nothing is read, written or executed.
 *
 * Confining it would add no security and would actively break the case a
 * user most wants: removing a stale entry whose directory has been
 * deleted. `resolveTrustedProjectRoot` requires a path to canonicalise,
 * so a project you removed from disk could never be removed from the
 * list. The first sweep did exactly that, and the harness caught it.
 */
app.delete('/api/recent-projects', (req, res) => {
  const { projectPath } = req.body || {};
  if (!projectPath || typeof projectPath !== 'string') {
    res.status(400).json({ error: 'projectPath is required' });
    return;
  }
  removeRecentProject(projectPath);
  res.json({ ok: true });
});

/** Not confined, for the same reason as DELETE above: a list key. */
app.post('/api/recent-projects/pin', (req, res) => {
  const { projectPath, pinned } = req.body || {};
  if (!projectPath || typeof projectPath !== 'string') {
    res.status(400).json({ error: 'projectPath is required' });
    return;
  }
  setRecentProjectPinned(projectPath, Boolean(pinned));
  res.json({ ok: true });
});

// Onboarding state — what steps the user has completed for a given project.
// Used by the Getting Started checklist to reflect real backend state instead
// of static brochure steps.
app.get('/api/onboarding-state', (req, res) => {
  const projectPath = requireProjectRoot(req, res);
  if (!projectPath) return;

  sessionService.cleanStaleSessions();
  const sessions = sessionService.getActiveSessions();
  const plans = planService.listPlans(projectPath);

  res.json({
    hasMcpSession: sessions.length > 0,
    activeMcpSessionCount: sessions.length,
    hasPlan: plans.length > 0,
    planCount: plans.length,
  });
});


// Discovered systems for a project — npm packages, Python projects,
// Rust crates, etc. Used by the graph scope picker so the user can
// focus the canvas on one system at a time instead of trying to
// render a whole monorepo.
app.get('/api/systems', (req, res) => {
  const projectPath = requireProjectRoot(req, res);
  if (!projectPath) return;
  const systems = discoverSystems(projectPath);
  res.json({ systems });
});

// Browse directories (for folder picker)
app.get('/api/fs/browse', (req, res) => {
  const dirPath = (req.query.path as string) || os.homedir();
  try {
    const resolved = path.resolve(dirPath);

    // NOT confined to opened projects, and deliberately so (Phase 19,
    // finding 5). This endpoint exists so the user can CHOOSE a project,
    // which necessarily means looking outside the ones already open —
    // confining it would make opening a new project impossible.
    //
    // What makes that acceptable now is Gate 1.1: the capability token means
    // the caller is a local process that already has filesystem access, not
    // a web page. What it must still not become is a convenient amplifier,
    // so:
    //
    //   - browsing is limited to the user's own home directory. Nothing in
    //     the folder picker needs /etc, /var or another user's home;
    //   - directory symlinks are not followed out of it;
    //   - the listing is capped, so a directory with a million entries
    //     cannot be used to stall the backend.
    const home = fs.realpathSync.native(os.homedir());
    let canonical: string;
    try {
      canonical = fs.realpathSync.native(resolved);
    } catch {
      res.status(400).json({ error: `Cannot read: ${dirPath}` });
      return;
    }
    if (!isInside(home, canonical)) {
      res.status(403).json({
        error: 'Browsing is limited to your home directory',
      });
      return;
    }

    const entries = fs.readdirSync(canonical, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => ({ name: e.name, path: path.join(canonical, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, MAX_BROWSE_ENTRIES);

    // `parent` never escapes home either, or the UI would offer a way out.
    const parent = isInside(home, path.dirname(canonical)) ? path.dirname(canonical) : canonical;
    res.json({ current: canonical, parent, dirs });
  } catch {
    res.status(400).json({ error: `Cannot read: ${dirPath}` });
  }
});

// Scan a project directory
/**
 * The scan currently running, if any — so a second caller JOINS it rather
 * than being refused.
 *
 * It was a boolean, and a concurrent scan threw "A scan is already in
 * progress". That is a real condition with two ordinary causes: the MCP
 * `open_project` tool scans and then tells the UI to open the project,
 * which scans again; and any two clients can ask at once. Refusing the
 * second caller turned a timing overlap into an error the caller had to
 * understand and retry, and the AST pass logged it as a failure.
 *
 * Coalescing is the honest answer: both callers want the same work done on
 * the same directory, and one of them is already doing it.
 */
let scanInFlight: { path: string; promise: Promise<ScanStats> } | null = null;

interface ScanStats {
  fileCount: number;
  symbolCount: number;
  importCount: number;
  resolvedImports: number;
}
/** The project that the in-memory DB currently holds AST data for.
 *  When the user switches projects we must do a full (non-incremental)
 *  scan; when they rescan the *same* project we can skip unchanged files. */
let lastScannedProject: string | null = null;

/** Return the path of the project currently open in the scanner. */
export function getActiveProjectPath(): string | null {
  return lastScannedProject;
}

/**
 * Core scan logic — callable both from the REST endpoint and MCP tool.
 * Throws on validation errors; callers should catch and surface appropriately.
 */
export async function scanProject(projectPath: string): Promise<ScanStats> {
  if (!projectPath || typeof projectPath !== 'string') {
    throw new Error('projectPath is required');
  }
  if (!fs.existsSync(projectPath)) {
    throw new Error(`Path does not exist: ${projectPath}`);
  }

  if (scanInFlight) {
    // Same directory: join the running scan and share its result.
    if (scanInFlight.path === projectPath) return scanInFlight.promise;
    // A DIFFERENT directory is a genuine conflict — the AST tables hold one
    // project at a time, so two projects scanning at once would interleave
    // into a graph belonging to neither. Still refused, and now the message
    // says which project is holding the scanner.
    throw new Error(
      `A scan of ${scanInFlight.path} is already in progress; wait for it before scanning ${projectPath}`,
    );
  }

  const run = runScan(projectPath);
  scanInFlight = { path: projectPath, promise: run };
  try {
    return await run;
  } finally {
    scanInFlight = null;
  }
}

async function runScan(projectPath: string): Promise<ScanStats> {
    const isSameProject = lastScannedProject === projectPath;
    console.log(`[Scan] Scanning project: ${projectPath}${isSameProject ? ' (incremental)' : ' (full)'}`);

    try {
      const branchInfo = getGitBranchName(projectPath);
      recordProjectOpen(projectPath, branchInfo);
    } catch (err) {
      console.warn('[Scan] Failed to record recent project:', err);
    }

    // First-run identity seed: if settings.identity is empty, populate
    // from the project's git config. Docs (06-agent-identity-and-attribution)
    // promise this behaviour; this is the implementation. One-time per
    // empty field — user-set values are preserved.
    try {
      const { maybeSeedIdentityFromGit } = _lazy___services_settings_service;
      if (maybeSeedIdentityFromGit(projectPath)) {
        console.log('[Scan] Seeded identity from git config for', projectPath);
      }
    } catch (err) {
      console.warn('[Scan] Failed to seed identity from git:', err);
    }

    const _monorepoConfig = detectMonorepo(projectPath);
    const fileTree = scanDirectory(projectPath);
    const filePaths = collectFilePaths(fileTree);

    let parsedFiles: Awaited<ReturnType<typeof parseFiles>>;

    if (isSameProject) {
      const storedHashes = getAllFileHashes();
      const diskFileSet = new Set(filePaths);
      const stalePaths = [...storedHashes.keys()].filter((p) => !diskFileSet.has(p));
      if (stalePaths.length > 0) {
        removeStaleFiles(stalePaths);
        console.log(`[Scan] Removed ${stalePaths.length} stale file(s) from DB`);
      }
      const toParse: string[] = [];
      for (const fp of filePaths) {
        const storedHash = storedHashes.get(fp);
        if (!storedHash) {
          toParse.push(fp);
        } else {
          const diskHash = computeFileHash(fp);
          if (diskHash && diskHash !== storedHash) {
            toParse.push(fp);
          }
        }
      }
      console.log(`[Scan] Incremental: ${toParse.length} changed / ${filePaths.length} total files (${stalePaths.length} removed)`);
      parsedFiles = await parseFiles(toParse);
      for (const parsed of parsedFiles) {
        storeParsedFile(parsed, projectPath);
      }
    } else {
      clearAstData();
      parsedFiles = await parseFiles(filePaths);
      for (const parsed of parsedFiles) {
        storeParsedFile(parsed, projectPath);
      }
    }

    lastScannedProject = projectPath;
    // Publish to trusted-roots, which cannot import this module (cycle).
    // Anything deriving a project root from trusted state reads it there.
    setActiveProjectRoot(projectPath);

    const systems = discoverSystems(projectPath);
    const aliasMap = buildAliasMap(systems);
    console.log(`[Scan] Discovered ${systems.length} systems, ${aliasMap.length} aliases`);

    resolveImports(projectPath, aliasMap, systems);

    try {
      recomputeCrossSystemEdges();
    } catch (err) {
      console.warn('[Scan] Cross-system pass failed:', err);
    }

    const stats = getDbStats();
    console.log(`[Scan] Parsed ${stats.fileCount} files, ${stats.symbolCount} symbols, ${stats.importCount} imports, ${stats.resolvedImports} resolved`);

    const depEdges = getDependencyEdges();
    const allHashes = getAllFileHashes();
    const fileData = [...allHashes.entries()].map(([absPath, hash]) => ({
      path: absPath.startsWith('/') ? path.relative(projectPath, absPath) : absPath,
      hash,
      symbolCount: 0,
    }));
    setBaseline(captureSnapshot(fileData, depEdges), getGitHeadCommit(projectPath) || undefined);

    // Awaited: the scan response is the signal that CodeTrellis is
    // live on this project, and a caller (or an agent that was just
    // pointed at the repo) may start editing the moment it lands.
    // Returning before the watcher is ready meant those first edits
    // were silently dropped. `startWatching` bounds its own wait.
    await startWatching(projectPath);
    startClaudeCodeWatcher(projectPath);

    // Repopulate plans from their on-disk YAML manifests when the DB has
    // none for this project. The plan file watcher binds with
    // `ignoreInitial`, so it never imports plans that already exist on
    // disk — which means a fresh DB (first open, or after a self-heal
    // rebuild of a corrupt data.db) would otherwise show zero plans even
    // though the manifests are right there under .codetrellis/plans/.
    // Guarded on an empty DB so steady-state opens keep the DB as the
    // live source and we don't churn re-imports on every scan.
    try {
      if (planService.listPlans(projectPath).length === 0) {
        const planDirs = discoverPlanDirs(projectPath);
        let imported = 0;
        for (const dir of planDirs) {
          try { importPlan(dir); imported++; }
          catch (err) { console.warn(`[Scan] Plan re-import failed for ${dir}:`, err); }
        }
        if (imported > 0) console.log(`[Scan] Re-imported ${imported} plan(s) from disk into a fresh DB`);
      }
    } catch (err) {
      console.warn('[Scan] Plan re-import pass failed:', err);
    }

    try {
      startPlanFileWatcher(projectPath);
    } catch (err) {
      console.warn('[Scan] Plan file watcher failed to start:', err);
    }

    try {
      const { startProjectConfigWatcher } = _lazy___services_project_config_service;
      startProjectConfigWatcher(projectPath);
    } catch (err) {
      console.warn('[Scan] Project config watcher failed to start:', err);
    }

    try {
      const { startPointerWatcher } = _lazy___services_external_pointer_service;
      startPointerWatcher(projectPath);
    } catch (err) {
      console.warn('[Scan] External pointer watcher failed to start:', err);
    }

    try {
      const { indexProjectDocs, startSystemDocsWatcher } = _lazy___services_system_docs_service;
      indexProjectDocs(projectPath);
      startSystemDocsWatcher(projectPath);
    } catch (err) {
      console.warn('[Scan] System docs watcher failed to start:', err);
    }

  return stats;
}

app.post('/api/project/scan', async (req, res) => {
  // THE ONE EXEMPTION from root confinement, and deliberately so: this
  // is the door through which a path BECOMES an opened project, so
  // checking it against the opened-project list would make it
  // impossible to open anything. Its control is the capability token
  // every local transport requires (Phase 19) plus the fact that a
  // human picked the folder.
  //
  // What it was missing is any validation at all — a non-string or a
  // path that is not a directory reached the scanner and failed deep
  // inside it.
  const { projectPath } = req.body ?? {};
  if (typeof projectPath !== 'string' || projectPath.trim() === '') {
    res.status(400).json({ error: 'projectPath is required' });
    return;
  }
  try {
    const stat = fs.statSync(projectPath);
    if (!stat.isDirectory()) {
      res.status(400).json({ error: 'projectPath is not a directory' });
      return;
    }
  } catch {
    res.status(400).json({ error: 'projectPath does not exist' });
    return;
  }
  try {
    // The file tree is pure filesystem — compute it FIRST and
    // independently of the AST/DB pass. The explorer depends only on
    // this, so it must render even when parsing or the database is
    // unhealthy (e.g. a corrupt data.db). Decoupling the two is what
    // stops a DB error from collapsing the sidebar to changed-files-only.
    const monorepoConfig = detectMonorepo(projectPath);
    const fileTree = scanDirectory(projectPath);
    const fileCount = countFiles(fileTree);
    const depGraph: Record<string, string[]> = {};
    monorepoConfig.dependencyGraph.forEach((v, k) => { depGraph[k] = v; });

    // AST parse + DB write — best-effort. If it throws (corrupt DB,
    // parser fault, or a scan already in progress), we still return the
    // file tree so the UI stays usable, with a non-fatal `astError` the
    // frontend can surface. A genuinely corrupt DB also self-heals on the
    // next process start (see database.ts initDatabase).
    let astStats: Awaited<ReturnType<typeof scanProject>> | null = null;
    let astError: string | null = null;
    try {
      astStats = await scanProject(projectPath);
    } catch (err) {
      astError = err instanceof Error ? err.message : String(err);
      console.error('[Scan] AST/DB pass failed — serving file tree only:', astError);
    }

    res.json({
      monorepoConfig: { ...monorepoConfig, dependencyGraph: depGraph },
      fileTree,
      fileCount,
      astStats,
      astError,
    });
  } catch (err) {
    // Only a filesystem-level failure (missing / unreadable path) reaches
    // here — the file tree itself couldn't be built.
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes('required') || msg.includes('does not exist') ? 400 : 500;
    if (!res.headersSent) {
      res.status(status).json({ error: msg });
    }
  }
});

// Symbol search
app.get('/api/symbols/search', (req, res) => {
  const query = req.query.q as string;
  if (!query) { res.json([]); return; }
  res.json(searchSymbols(query));
});

// Get symbols for a specific file
app.get('/api/symbols/file', (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath) { res.json([]); return; }
  res.json(getFileSymbols(filePath));
});

// Read raw file content for the inspector code preview. Caps at 256KB.
// Optional ?start=&end= slices to a 1-indexed inclusive line range.
// Optional ?project= triggers per-line git annotations + plan drift status.
app.get('/api/file/content', (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath || typeof filePath !== 'string') {
    res.status(400).json({ error: 'path query param required' });
    return;
  }

  // CONFINED TO OPENED PROJECTS (Phase 19, finding 5).
  //
  // This endpoint read ANY path on the machine. Unlike /api/fs/browse —
  // which exists so the user can CHOOSE a project and therefore has to see
  // outside one — there is no reason to read file CONTENT outside a project
  // the user has opened. The viewer only ever displays files from the graph.
  //
  // The root is not taken from the request: it is whichever opened project
  // contains the path. A caller cannot nominate one (Gate 2.2), and the read
  // goes through the confined helper so a symlink cannot escape it (A2).
  let contents: Buffer;
  try {
    // Which opened project owns this path? `isWithin` canonicalises both
    // ends and refuses links, so a file reached through a symlink in a
    // project does not count as being in it.
    const owningRoot = listTrustedRoots().find((r) => isWithin(r, filePath));
    if (!owningRoot) {
      res.status(403).json({
        error: 'Refusing to read a file outside every opened project',
      });
      return;
    }
    contents = readFileWithin(owningRoot, filePath, 'file/content');
  } catch (err) {
    if (err instanceof ConfinementError) {
      res.status(403).json({ error: err.message });
      return;
    }
    res.status(404).json({ error: 'File not found' });
    return;
  }

  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      res.status(400).json({ error: 'Path is a directory' });
      return;
    }
    const MAX_BYTES = 256 * 1024;
    const truncated = stat.size > MAX_BYTES;
    // Use the buffer the CONFINED read produced. Reading again here would
    // reopen the time-of-check/time-of-use gap that readFileWithin closed:
    // a link swapped in between the two reads would be followed by the
    // second one.
    const buffer = contents;
    const content = (truncated ? buffer.subarray(0, MAX_BYTES) : buffer).toString('utf-8');

    const startParam = req.query.start ? parseInt(String(req.query.start), 10) : undefined;
    const endParam = req.query.end ? parseInt(String(req.query.end), 10) : undefined;
    const projectPath = optionalProjectRoot(req, res);
    if (projectPath === null) return;

    const allLines = content.split('\n');
    const fullLineCount = allLines.length;

    let body = content;
    let start = 1;
    let end = fullLineCount;
    if (Number.isFinite(startParam) && Number.isFinite(endParam)) {
      const s = Math.max(1, startParam!);
      const e = Math.min(fullLineCount, endParam!);
      body = allLines.slice(s - 1, e).join('\n');
      start = s;
      end = e;
    }

    const language = detectLanguage(filePath);

    // Compute git per-line annotations vs HEAD if a project root is known.
    let annotations: Array<'unchanged' | 'added' | 'modified'> | undefined;
    let deletedBefore: Record<number, number> | undefined;
    let isDirty = false;
    if (projectPath) {
      const git = computeGitLineAnnotations(projectPath, filePath, fullLineCount);
      if (git) {
        annotations = git.annotations.slice(start - 1, end);
        isDirty = git.annotations.some((a) => a !== 'unchanged')
          || Object.keys(git.deletedBefore).length > 0;

        // Re-base the deletion anchors onto the window being served. A
        // marker outside it is dropped rather than clamped to the edge,
        // which would claim lines vanished somewhere they did not.
        deletedBefore = {};
        for (const [line, count] of Object.entries(git.deletedBefore)) {
          const n = Number(line);
          if (n >= start && n <= end + 1) deletedBefore[n - start + 1] = count;
        }
      }
    }

    // Compute plan drift status. If ?plan= is given, scope drift to that one
    // plan (the user explicitly picked a comparison target). Otherwise fall
    // back to "any active plan" — useful when no plan is selected yet.
    const planScope = (req.query.plan as string) || undefined;
    let drift: undefined | {
      status: 'on_track' | 'pending' | 'unexpected' | 'untouched' | 'no_plan';
      activePlanUids: string[];
      activeTaskUids: string[];
      hasActivePlan: boolean;
      comparedAgainstPlanUid: string | null;
      comparedAgainstPlanTitle: string | null;
    };
    if (projectPath) {
      drift = computeFileDrift(projectPath, filePath, isDirty, planScope);
    }

    res.json({
      path: filePath,
      content: body,
      startLine: start,
      endLine: end,
      lineCount: body.split('\n').length,
      bytes: stat.size,
      truncated,
      language,
      annotations,
      deletedBefore,
      drift,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript', '.jsx': 'jsx',
    '.json': 'json', '.css': 'css', '.scss': 'scss', '.html': 'markup',
    '.py': 'python', '.rs': 'rust', '.go': 'go', '.java': 'java',
    '.php': 'php', '.rb': 'ruby', '.rake': 'ruby', '.sh': 'bash', '.md': 'markdown',
    '.yml': 'yaml', '.yaml': 'yaml', '.toml': 'toml', '.sql': 'sql',
    '.cs': 'csharp', '.kt': 'kotlin', '.kts': 'kotlin', '.swift': 'swift',
  };
  return map[ext] || 'plaintext';
}

/**
 * Returns a status array (one entry per line in the working-tree file) marking
 * lines added or modified relative to HEAD. Returns null if the file isn't
 * tracked yet (whole file is implicitly 'added' — caller can detect via
 * isDirty=true) or if git fails.
 */
/**
 * Per-line git state for a file, plus the deletions that have no line.
 *
 * A removal is not a property of a line — the line is gone. It sits
 * BETWEEN two surviving lines, which is why the per-line array could
 * never express it and why deleted code was invisible in the reader. A
 * refactor that cut forty lines and added two rendered as two modified
 * lines and no other trace.
 *
 * `deletedBefore` maps a 1-based line number to how many lines were
 * removed immediately above it, so the renderer can put a marker in the
 * gap where they used to be.
 */
export interface GitLineAnnotations {
  annotations: Array<'unchanged' | 'added' | 'modified'>;
  deletedBefore: Record<number, number>;
}

export function computeGitLineAnnotations(
  projectPath: string,
  filePath: string,
  lineCount: number,
): GitLineAnnotations | null {
  try {
    const relative = path.relative(projectPath, filePath);
    if (relative.startsWith('..')) return null;

    // Untracked files: every line is "added"
    try {
      const lsOut = execFileSync(
        'git',
        ['-C', projectPath, 'ls-files', '--error-unmatch', relative],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      );
      if (!lsOut) {
        return { annotations: Array(lineCount).fill('added'), deletedBefore: {} };
      }
    } catch {
      return { annotations: Array(lineCount).fill('added'), deletedBefore: {} };
    }

    // Diff against HEAD (working tree, not index) with zero context
    const diffOut = execFileSync(
      'git',
      ['-C', projectPath, 'diff', '--no-color', '-U0', 'HEAD', '--', relative],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );

    const annotations: Array<'unchanged' | 'added' | 'modified'> = Array(lineCount).fill('unchanged');
    const deletedBefore: Record<number, number> = {};

    // Both sides of the hunk header are needed now. `-oldStart,oldLen`
    // says how much was there; `+newStart,newLen` says how much remains.
    // The old side used to be discarded, which is precisely the
    // information a deletion consists of.
    const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;
    let match: RegExpExecArray | null;
    while ((match = HUNK_RE.exec(diffOut)) !== null) {
      const oldLen = match[2] != null ? parseInt(match[2], 10) : 1;
      const startLine = parseInt(match[3], 10);
      const newLen = match[4] != null ? parseInt(match[4], 10) : 1;

      const blockStart = match.index + match[0].length;
      const nextHunk = diffOut.indexOf('\n@@', blockStart);
      const block = diffOut.slice(blockStart, nextHunk === -1 ? undefined : nextHunk);
      const hasRemoval = /^-/m.test(block);
      const status = hasRemoval ? 'modified' : 'added';

      for (let i = 0; i < newLen; i += 1) {
        const idx = startLine - 1 + i;
        if (idx >= 0 && idx < annotations.length) {
          annotations[idx] = status;
        }
      }

      // More went than came back. Record the surplus against the line it
      // vanished above, so the gap is visible rather than implied.
      //
      // `newLen === 0` is a pure deletion: git reports `+N,0` meaning
      // "after line N", so the marker belongs before N+1. Otherwise the
      // block shrank, and the marker belongs after what survived.
      if (oldLen > newLen) {
        const anchor = newLen === 0 ? startLine + 1 : startLine + newLen;
        const clamped = Math.min(Math.max(anchor, 1), lineCount + 1);
        deletedBefore[clamped] = (deletedBefore[clamped] ?? 0) + (oldLen - newLen);
      }
    }
    return { annotations, deletedBefore };
  } catch {
    return null;
  }
}

/**
 * Decide whether this file's working-tree state is on-plan, off-plan, or just
 * untouched. If `planScopeUid` is provided, drift is scoped to that single
 * plan only (the user explicitly picked a comparison target). Otherwise we
 * fall back to "any active plan." File-level for v1 — no per-line drift.
 */
function computeFileDrift(
  projectPath: string,
  filePath: string,
  isDirty: boolean,
  planScopeUid?: string,
): {
  status: 'on_track' | 'pending' | 'unexpected' | 'untouched' | 'no_plan';
  activePlanUids: string[];
  activeTaskUids: string[];
  hasActivePlan: boolean;
  comparedAgainstPlanUid: string | null;
  comparedAgainstPlanTitle: string | null;
} {
  const relative = path.relative(projectPath, filePath);

  // Resolve which plans to consider
  let plans;
  if (planScopeUid) {
    const single = planService.getPlan(planScopeUid);
    plans = single ? [single] : [];
  } else {
    plans = planService.listPlans(projectPath).filter(
      (p) => p.status === 'approved' || p.status === 'in_progress' || p.status === 'review' || p.status === 'draft',
    );
  }

  if (plans.length === 0) {
    return {
      status: isDirty ? 'unexpected' : 'no_plan',
      activePlanUids: [],
      activeTaskUids: [],
      hasActivePlan: false,
      comparedAgainstPlanUid: planScopeUid ?? null,
      comparedAgainstPlanTitle: null,
    };
  }

  const planUids: string[] = [];
  const taskUids: string[] = [];
  for (const plan of plans) {
    const tasks = planService.getTasksByPlan(plan.uid);
    const matching = tasks.filter(
      (t) => t.affectedFiles.some((f) => f === relative || f === filePath),
    );
    if (matching.length > 0) {
      planUids.push(plan.uid);
      for (const t of matching) taskUids.push(t.uid);
    }
  }

  // When the user picked a single plan, the comparison label always reflects
  // that plan even if the file isn't in it. When unscoped, label tracks the
  // first matching plan (or null if none matched).
  const comparedPlan = planScopeUid
    ? plans[0]
    : (planUids[0] ? plans.find((p) => p.uid === planUids[0]) || null : null);

  if (planUids.length === 0) {
    return {
      status: isDirty ? 'unexpected' : 'untouched',
      activePlanUids: [],
      activeTaskUids: [],
      hasActivePlan: true,
      comparedAgainstPlanUid: comparedPlan?.uid ?? planScopeUid ?? null,
      comparedAgainstPlanTitle: comparedPlan?.title ?? null,
    };
  }

  return {
    status: isDirty ? 'on_track' : 'pending',
    activePlanUids: planUids,
    activeTaskUids: taskUids,
    hasActivePlan: true,
    comparedAgainstPlanUid: comparedPlan?.uid ?? null,
    comparedAgainstPlanTitle: comparedPlan?.title ?? null,
  };
}

// File-to-file dependency edges
app.get('/api/dependencies', (req, res) => {
  // Optional `?include=cross_system` returns the merged list with
  // `kind` discriminator. Default keeps the legacy import-only shape
  // so existing callers don't change.
  if (req.query.include === 'cross_system') {
    res.json(getAllGraphEdges());
    return;
  }
  res.json(getDependencyEdges());
});

app.get('/api/cross-system', (_req, res) => {
  res.json({ edges: listCrossSystemEdges(), stats: getCrossSystemStats() });
});

// Dependencies for a specific file
app.get('/api/dependencies/file', (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath) { res.json({ imports: [], importedBy: [] }); return; }
  res.json(getFileDependencies(filePath));
});

// Architecture diff — compare current state to baseline
app.get('/api/diff', async (req, res) => {
  const baseline = getBaseline();
  if (!baseline) {
    res.json({ error: 'No baseline captured yet. Scan a project first.' });
    return;
  }

  const projectPath = requireProjectRoot(req, res);
  if (!projectPath) return;

  // Read current state from the DB instead of re-running a full
  // scan + parse + resolveImports on every poll. The file watcher
  // already keeps individual files up-to-date as they change. The
  // old behavior re-parsed all 2k+ files every 10 seconds AND called
  // resolveImports with no alias map (which wiped out every
  // workspace-aliased + Python edge each cycle).
  const currentEdges = getDependencyEdges();
  const fileData = readFilesSnapshot(projectPath);

  const currentSnapshot = captureSnapshot(fileData, currentEdges);
  const diff = computeDiff(currentSnapshot);
  res.json({
    ...(diff || { summary: { added: 0, removed: 0, modified: 0, edgesAdded: 0, edgesRemoved: 0 } }),
    git: getGitWorkingTreeStatus(projectPath),
  });
});

/** Read current files (path + hash + symbol count) from the DB. */
export function readFilesSnapshot(projectPath: string): Array<{ path: string; hash: string; symbolCount: number }> {
  const d = getDb();
  const result = d.exec(`
    SELECT f.path, f.content_hash, COUNT(s.id) as symbol_count
    FROM files f
    LEFT JOIN symbols s ON s.file_id = f.id
    GROUP BY f.id
  `);
  if (!result[0]) return [];
  return result[0].values.map((row: any[]) => ({
    path: projectRelative(projectPath, row[0] as string) || (row[0] as string),
    hash: row[1] as string,
    symbolCount: (row[2] as number) || 0,
  }));
}

// Baseline snapshot captured during scan
app.get('/api/baseline', (_req, res) => {
  const baseline = getBaseline();
  if (!baseline) {
    res.status(404).json({ error: 'No baseline captured yet. Scan a project first.' });
    return;
  }

  res.json({
    id: 0,
    name: 'Baseline',
    commitHash: baseline.commitHash || null,
    shortCommitHash: baseline.shortCommitHash || null,
    data: {
      files: [...baseline.files.entries()].map(([path, info]) => ({
        path,
        contentHash: info.hash,
        symbolCount: info.symbolCount,
      })),
      edges: [...baseline.edges].map((edge) => {
        const [source, target] = edge.split('->');
        return { source, target, specifiers: [] };
      }),
    },
  });
});

app.post('/api/baseline/capture', async (req, res) => {
  const { projectPath: rawProjectPath, commitHash } = req.body || {};
  const projectPath = confineRoot(rawProjectPath, res, 'projectPath');
  if (!projectPath) return;
  if (!projectPath || typeof projectPath !== 'string') {
    res.status(400).json({ error: 'projectPath is required' });
    return;
  }

  if (commitHash && typeof commitHash !== 'string') {
    res.status(400).json({ error: 'commitHash must be a string when provided' });
    return;
  }

  if (commitHash) {
    const commitSnapshot = await captureGitCommitSnapshot(projectPath, commitHash);
    if (!commitSnapshot) {
      res.status(400).json({ error: 'Unable to capture baseline for the selected commit' });
      return;
    }
    setBaseline(commitSnapshot.snapshot, {
      commitHash: commitSnapshot.commitHash,
      shortCommitHash: commitSnapshot.shortCommitHash,
    });
  } else {
    const fileTree = scanDirectory(projectPath);
    const filePaths = collectFilePaths(fileTree);
    const parsedFiles = await parseFiles(filePaths);

    for (const parsed of parsedFiles) {
      storeParsedFile(parsed, projectPath);
    }
    resolveImports(projectPath);

    const depEdges = getDependencyEdges();
    const fileData = parsedFiles.map((f) => ({
      path: path.relative(projectPath, f.path),
      hash: f.contentHash,
      symbolCount: f.symbols.length,
    }));
    const snapshot = captureSnapshot(fileData, depEdges);
    const head = getGitHeadCommit(projectPath);
    setBaseline(snapshot, head || undefined);
  }

  const baseline = getBaseline();
  res.json({
    id: 0,
    name: 'Baseline',
    commitHash: baseline?.commitHash || null,
    shortCommitHash: baseline?.shortCommitHash || null,
    data: {
      files: [...(baseline?.files.entries() || [])].map(([filePath, info]) => ({
        path: filePath,
        contentHash: info.hash,
        symbolCount: info.symbolCount,
      })),
      edges: [...(baseline?.edges || [])].map((edge) => {
        const [source, target] = edge.split('->');
        return { source, target, specifiers: [] };
      }),
    },
  });
});

// --- Plan API ---

// List plans
app.get('/api/plans', (req, res) => {
  const projectPath = optionalProjectRoot(req, res);
  if (projectPath === null) return;
  const status = req.query.status as string | undefined;
  res.json(planService.listPlans(projectPath, status));
});

// Create plan
app.post('/api/plans', (req, res) => {
  const { title, description, tasks, projectPath: rawProjectPath } = req.body;
  const projectPath = confineRoot(rawProjectPath, res, 'projectPath');
  if (!projectPath) return;
  if (!title || !projectPath) { res.status(400).json({ error: 'title and projectPath required' }); return; }
  // Phase 13 §E: prefer the configured identity (email) over the
  // legacy "user" role. `getAuthorKey` falls back to "human" if the
  // user hasn't set an identity yet, so old behaviour stays valid.
  const plan = planService.createPlan({ title, description: description || '', tasks: tasks || [] }, getAuthorKey('human'), 'human', projectPath);
  broadcast('plan-created', { plan });
  saveNow(() => exportDatabase());
  res.json(plan);
});

// Discover plan directories (must be before /:uid to avoid "discover" matching as uid)
app.get('/api/plans/discover', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  res.json(discoverPlanDirs(projectRoot));
});

// DB ↔ disk reconciliation
app.get('/api/plans/reconcile', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  res.json(reconcilePlanState(projectRoot));
});

// CDev Phase 3.6 — read the per-project config (just `repoRole` for
// the UI today; more fields will land here as they're added).
app.get('/api/project-config', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  try {
    const { getProjectConfig } = _lazy___services_project_config_service;
    res.json(getProjectConfig(projectRoot));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// CDev Phase 3.5 — cross-repo stitched plan list. Returns the
// project's local plans alongside external pointers, with each
// pointer tagged "resolved" when its homeRepo matches a recent
// project the user has on this machine. The frontend uses this to
// render a "Plans from other repos" section.
app.get('/api/plans/stitched', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  try {
    const { discoverPointers } = _lazy___services_external_pointer_service;
    const { findRecentProjectByOriginUrl } = _lazy___services_recent_projects_service;
    const { getNormalisedOriginUrl } = _lazy___services_git_identity;

    const localPlans = planService.listPlans(projectRoot);
    const ownOriginUrl: string | null = getNormalisedOriginUrl(projectRoot) ?? null;
    const pointers = discoverPointers(projectRoot);

    const stitchedPointers = pointers.map((entry: any) => {
      const pointer = entry.pointer;
      const resolved = pointer.homeRepo
        ? findRecentProjectByOriginUrl(pointer.homeRepo)
        : null;
      return {
        filePath: entry.filePath,
        pointer,
        resolved: resolved ? {
          projectPath: resolved.path,
          displayName: resolved.displayName,
        } : null,
      };
    });

    res.json({
      projectPath: projectRoot,
      ownOriginUrl,
      localPlans,
      pointers: stitchedPointers,
    });
  } catch (err) {
    console.warn('[stitched] failed:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Prune orphaned plan directories from disk
app.post('/api/plans/prune-orphans', (req, res) => {
  const { dirPaths } = req.body || {};
  if (!Array.isArray(dirPaths) || dirPaths.length === 0) {
    res.status(400).json({ error: 'dirPaths must be a non-empty array of absolute paths' });
    return;
  }
  const removed = pruneOrphanedDirs(dirPaths);
  res.json({ ok: true, removed });
});

// Get plan
app.get('/api/plans/:uid', (req, res) => {
  const plan = planService.getPlan(req.params.uid);
  if (!plan) { res.status(404).json({ error: 'Plan not found' }); return; }
  res.json(plan);
});

// Update plan
app.put('/api/plans/:uid', (req, res) => {
  // Phase 15 §15.D — accept the git-context fields alongside the
  // existing title/description/status. Each is optional; missing
  // means "leave alone", `null` clears.
  const {
    title, description, status,
    baseRef, targetBranch, targetWorktree, autoCreateBranch,
  } = req.body;
  const plan = planService.getPlan(req.params.uid);
  planService.updatePlan(
    req.params.uid,
    { title, description, status, baseRef, targetBranch, targetWorktree, autoCreateBranch },
    'user',
  );

  // Auto-capture trellis snapshot when plan is approved
  if (status === 'approved' && plan?.projectPath) {
    try {
      const snapshot = captureCurrentTrellis(plan.projectPath, req.params.uid, `Baseline for "${plan.title}"`);
      broadcast('trellis-captured', { snapshot: { id: snapshot.id, name: snapshot.name } });
    } catch (err) {
      console.warn('[API] Failed to capture trellis snapshot:', err);
    }
  }

  broadcast('plan-updated', { planUid: req.params.uid, status });
  saveNow(() => exportDatabase());
  res.json({ ok: true });
});

// Delete (archive) plan
app.delete('/api/plans/:uid', (req, res) => {
  const planUid = req.params.uid;
  const plan = planService.getPlan(planUid);
  const removeDisk = req.query.disk !== 'false'; // default: also remove disk files

  planService.deletePlan(planUid);

  // Also remove on-disk .codetrellis/plans/<slug>/ if the plan has a project path
  let diskRemoved = false;
  if (removeDisk && plan?.projectPath) {
    try {
      const result = unlinkPlan(planUid, plan.projectPath);
      diskRemoved = result.removed;
    } catch { /* best-effort */ }
  }

  broadcast('plan-deleted', { planUid });
  saveNow(() => exportDatabase());
  res.json({ ok: true, diskRemoved });
});

// Bulk delete plans
app.post('/api/plans/bulk-delete', (req, res) => {
  const { uids } = req.body || {};
  if (!Array.isArray(uids) || uids.length === 0) {
    res.status(400).json({ error: 'uids must be a non-empty array' });
    return;
  }
  let deleted = 0;
  for (const uid of uids) {
    try {
      const plan = planService.getPlan(uid);
      planService.deletePlan(uid);
      // Also clean up disk files
      if (plan?.projectPath) {
        try { unlinkPlan(uid, plan.projectPath); } catch { /* best-effort */ }
      }
      broadcast('plan-deleted', { planUid: uid });
      deleted++;
    } catch {
      // skip plans that don't exist
    }
  }
  saveNow(() => exportDatabase());
  res.json({ ok: true, deleted });
});

// List tasks for a plan
app.get('/api/plans/:uid/tasks', (req, res) => {
  res.json(planService.getTasksByPlan(req.params.uid));
});

// Update task — accepts the full set of task fields, including the
// Phase 14 §A task-as-context fields.
app.put('/api/plans/:uid/tasks/:taskUid', (req, res) => {
  const {
    status, assignee, assigneeType, assigneeModel, description,
    affectedFiles, affectedSymbols, newConnections, removedConnections,
    dependencies, fileSpec, symbolSpecs, phaseUid,
    // Phase 14 §A
    parentTaskUid, body, prompt, scopePath, fileSpecs,
    progressPercent, blockedReason,
  } = req.body;
  planService.updateTask(req.params.taskUid, {
    status, assignee, assigneeType, assigneeModel, description,
    affectedFiles, affectedSymbols, newConnections, removedConnections,
    dependencies, fileSpec, symbolSpecs, phaseUid,
    parentTaskUid, body, prompt, scopePath, fileSpecs,
    progressPercent, blockedReason,
  });
  broadcast('task-updated', { planUid: req.params.uid, taskUid: req.params.taskUid, status });
  saveNow(() => exportDatabase());
  res.json({ ok: true });
});

// Append a code reference (path + line range + note) to an existing task.
app.post('/api/plans/:uid/tasks/:taskUid/code-reference', (req, res) => {
  const { filePath, startLine, endLine, note, codeSnippet } = req.body || {};
  if (!filePath || typeof filePath !== 'string') {
    res.status(400).json({ error: 'filePath is required' });
    return;
  }
  const task = planService.appendTaskCodeReference(req.params.taskUid, {
    filePath, startLine, endLine, note, codeSnippet,
  });
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  broadcast('task-updated', { planUid: req.params.uid, taskUid: req.params.taskUid });
  saveNow(() => exportDatabase());
  res.json(task);
});

// Append a brand-new task to a plan (used by the "Add to plan as new task" flow).
app.post('/api/plans/:uid/tasks', (req, res) => {
  const {
    description, affectedFiles, affectedSymbols, fileSpec,
    // Phase 14 §A
    body, prompt, scopePath, fileSpecs, parentTaskUid,
  } = req.body || {};
  if (!description || typeof description !== 'string') {
    res.status(400).json({ error: 'description is required' });
    return;
  }
  const task = planService.appendTaskToPlan(req.params.uid, {
    description, affectedFiles, affectedSymbols, fileSpec,
    body, prompt, scopePath, fileSpecs, parentTaskUid,
  });
  if (!task) {
    res.status(404).json({ error: 'Plan not found' });
    return;
  }
  broadcast('task-updated', { planUid: req.params.uid, taskUid: task.uid });
  saveNow(() => exportDatabase());
  res.json(task);
});

// Claim task
app.post('/api/plans/:uid/tasks/:taskUid/claim', (req, res) => {
  const { agentId, agentType, model } = req.body;
  const result = planService.claimTask(req.params.taskUid, agentId, agentType, model);
  if (result.ok) {
    broadcast('task-claimed', { planUid: req.params.uid, taskUid: req.params.taskUid, agentId });
    if (result.conflicts) {
      broadcast('conflict-detected', { planUid: req.params.uid, taskUid: req.params.taskUid, message: result.conflicts.join('; ') });
    }
  }
  res.json(result);
});

// Get next available task
app.get('/api/plans/:uid/next-task', (req, res) => {
  const task = planService.getNextTask(req.params.uid);
  res.json(task || { none: true });
});

// --- Phase 14 §A — Task-as-context endpoints ---
// REST mirrors of the new MCP tools so the frontend Plan Workspace
// can hydrate task context, attachments, comments, and subtasks
// without going through the SSE wire.

/** Full task context: task + parent + subtasks + phase + attachments + comments. */
app.get('/api/tasks/:taskUid/full', (req, res) => {
  const taskUid = req.params.taskUid;
  const task = planService.getTaskByUid(taskUid);
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
  const parent = task.parentTaskUid ? planService.getTaskByUid(task.parentTaskUid) : null;
  const subtasks = planService.getSubtasks(taskUid);
  const attachments = taskAttachmentsService.listTaskAttachments(taskUid);
  const comments = commentService.listCommentsFlat(taskUid);
  res.json({ task, parent, subtasks, attachments, comments });
});

/** List task attachments. */
app.get('/api/tasks/:taskUid/attachments', (req, res) => {
  res.json(taskAttachmentsService.listTaskAttachments(req.params.taskUid));
});

/** Add a task attachment (URL, file_ref, code_block, transcript, image-via-base64). */
app.post('/api/tasks/:taskUid/attachments', (req, res) => {
  const { kind, value, label, contentType, dataBase64, projectRoot: rawProjectRoot } = req.body || {};
  // Optional here: an attachment with no project root lands in the user
  // directory rather than a per-project one. Absent stays absent.
  const projectRoot = confineRootOptional(rawProjectRoot, res);
  if (projectRoot === null) return;
  if (!kind || value == null) {
    res.status(400).json({ error: 'kind and value are required' });
    return;
  }
  try {
    const attachment = taskAttachmentsService.addAttachment({
      targetType: 'task',
      targetUid: req.params.taskUid,
      kind,
      value,
      label,
      contentType,
      dataBase64,
      projectRoot,
      author: getAuthorKey('human'),
      authorType: 'human',
    });
    const planUid = planService.getTaskByUid(req.params.taskUid)?.planUid ?? null;
    broadcast('task-attachment-added', { planUid, taskUid: req.params.taskUid, attachment });
    saveNow(() => exportDatabase());
    res.json(attachment);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Delete a task attachment. */
app.delete('/api/attachments/:uid', (req, res) => {
  const ok = taskAttachmentsService.deleteAttachment(req.params.uid);
  if (!ok) { res.status(404).json({ error: 'Attachment not found' }); return; }
  broadcast('task-attachment-removed', { uid: req.params.uid });
  saveNow(() => exportDatabase());
  res.json({ ok: true });
});

/** List task comments (flat, ordered, includes Phase 14 kind/source/metadata). */
app.get('/api/tasks/:taskUid/comments', (req, res) => {
  res.json(commentService.listCommentsFlat(req.params.taskUid));
});

/** Add a structured task comment (kind: note / blocker / progress / question). */
app.post('/api/tasks/:taskUid/comments', (req, res) => {
  const { kind, body, parentCommentUid, source } = req.body || {};
  if (!body || typeof body !== 'string') {
    res.status(400).json({ error: 'body is required' });
    return;
  }
  // Map the Phase 14 §A kind onto the legacy commentType chip so old
  // UI keeps showing something sensible.
  const legacyType = kind === 'progress' ? 'status_update'
    : kind === 'blocker' ? 'concern'
    : kind === 'question' ? 'suggestion'
    : 'comment';
  const comment = commentService.addComment(
    'task', req.params.taskUid, getAuthorKey('human'), 'human', body,
    { kind, source: source ?? 'human', commentType: legacyType, parentUid: parentCommentUid },
  );
  const planUid = planService.getTaskByUid(req.params.taskUid)?.planUid ?? null;
  broadcast('task-comment-added', { planUid, taskUid: req.params.taskUid, comment });
  saveNow(() => exportDatabase());
  res.json(comment);
});

/** Report mid-task progress: 0–100 + optional message. */
app.post('/api/tasks/:taskUid/progress', (req, res) => {
  const { percent, message } = req.body || {};
  if (typeof percent !== 'number' || percent < 0 || percent > 100) {
    res.status(400).json({ error: 'percent must be a number between 0 and 100' });
    return;
  }
  planService.updateTask(req.params.taskUid, { progressPercent: percent });
  const body = (typeof message === 'string' && message.trim()) ? message.trim() : `Progress: ${percent}%`;
  const comment = commentService.addComment(
    'task', req.params.taskUid, getAuthorKey('human'), 'human', body,
    { kind: 'progress', source: 'human', commentType: 'status_update', metadata: { progressPercent: percent } },
  );
  const planUid = planService.getTaskByUid(req.params.taskUid)?.planUid ?? null;
  broadcast('task-progress', { planUid, taskUid: req.params.taskUid, percent, message: body, commentUid: comment.uid });
  broadcast('task-comment-added', { planUid, taskUid: req.params.taskUid, comment });
  saveNow(() => exportDatabase());
  res.json({ ok: true, percent, message: body, commentUid: comment.uid });
});

/** Mark a task blocked with a reason. */
app.post('/api/tasks/:taskUid/blocked', (req, res) => {
  const { reason } = req.body || {};
  if (!reason || typeof reason !== 'string') {
    res.status(400).json({ error: 'reason is required' });
    return;
  }
  planService.updateTask(req.params.taskUid, { status: 'blocked', blockedReason: reason });
  const comment = commentService.addComment(
    'task', req.params.taskUid, getAuthorKey('human'), 'human', reason,
    { kind: 'blocker', source: 'human', commentType: 'concern' },
  );
  const planUid = planService.getTaskByUid(req.params.taskUid)?.planUid ?? null;
  broadcast('task-blocked', { planUid, taskUid: req.params.taskUid, reason, commentUid: comment.uid });
  broadcast('task-updated', { planUid, taskUid: req.params.taskUid, status: 'blocked' });
  broadcast('task-comment-added', { planUid, taskUid: req.params.taskUid, comment });
  saveNow(() => exportDatabase());
  res.json({ ok: true });
});

/** Add a subtask under an existing task. */
app.post('/api/tasks/:taskUid/subtasks', (req, res) => {
  const parent = planService.getTaskByUid(req.params.taskUid);
  if (!parent) { res.status(404).json({ error: 'Parent task not found' }); return; }
  const { description, body, prompt, scopePath, fileSpecs } = req.body || {};
  if (!description || typeof description !== 'string') {
    res.status(400).json({ error: 'description is required' });
    return;
  }
  const subtask = planService.appendTaskToPlan(parent.planUid, {
    description, body, prompt,
    scopePath: scopePath ?? parent.scopePath ?? null,
    fileSpecs,
    parentTaskUid: req.params.taskUid,
  });
  if (!subtask) { res.status(500).json({ error: 'Failed to create subtask' }); return; }
  broadcast('task-created', { planUid: parent.planUid, task: subtask, parentTaskUid: req.params.taskUid });
  saveNow(() => exportDatabase());
  res.json(subtask);
});

/** Direct subtask listing (useful for refreshing without /full). */
app.get('/api/tasks/:taskUid/subtasks', (req, res) => {
  res.json(planService.getSubtasks(req.params.taskUid));
});

// =============================================================================
// Phase 15 §C — unified Object/Action REST surface for `plan_items`.
// =============================================================================
// REST mirrors of the new MCP tools so the V2 frontend (15.D) can hydrate
// the workspace without going through SSE. Old endpoints (above) keep
// working in parallel during the cutover; aliases / deprecation are 15.F.

/** List items (cheap tree query — title + kind + status + childCount, no bodies). */
app.get('/api/plans/:planUid/items', (req, res) => {
  const summaries = planItemService.listItemSummaries(req.params.planUid);
  let filtered = summaries;
  if (typeof req.query.parent_uid === 'string') {
    const target = req.query.parent_uid === '' ? null : req.query.parent_uid;
    filtered = filtered.filter((i) => i.parentUid === target);
  }
  if (typeof req.query.kind === 'string') {
    filtered = filtered.filter((i) => i.kind === req.query.kind);
  }
  res.json(filtered);
});

/** Plan timeline (plan_events feed). */
app.get('/api/plans/:planUid/timeline', (req, res) => {
  const sinceMs = typeof req.query.since_ms === 'string' ? Number(req.query.since_ms) : undefined;
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
  const kindsRaw = req.query.kinds;
  const kinds = typeof kindsRaw === 'string' ? kindsRaw.split(',').filter(Boolean) : undefined;
  res.json(planEventService.listPlanEvents(req.params.planUid, {
    sinceMs: Number.isFinite(sinceMs) ? sinceMs : undefined,
    eventTypes: kinds as any,
    limit: Number.isFinite(limit) ? limit : undefined,
  }));
});

// --- Channel events (CDev Phase 1.3 / 1.4) ---------------------------------
//
// HTTP surface for the frontend. Mirrors the MCP tools but with attribution
// derived from settings.identity (frontend users are always humans here —
// agent posts go via MCP).

/** List channel events for a plan. */
app.get('/api/plans/:planUid/channels', (req, res) => {
  const sinceMs = typeof req.query.since_ms === 'string' ? Number(req.query.since_ms) : undefined;
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
  const eventTypesRaw = req.query.event_types;
  const statusRaw = req.query.status;
  const eventTypes = typeof eventTypesRaw === 'string' ? eventTypesRaw.split(',').filter(Boolean) : undefined;
  const status = typeof statusRaw === 'string' ? statusRaw.split(',').filter(Boolean) : undefined;
  const itemUid = typeof req.query.item_uid === 'string' ? req.query.item_uid : undefined;
  try {
    res.json(channelEventService.listChannelEvents(req.params.planUid, {
      sinceMs: Number.isFinite(sinceMs) ? sinceMs : undefined,
      eventTypes: eventTypes as any,
      status: status as any,
      itemUid,
      limit: Number.isFinite(limit) ? limit : undefined,
    }));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Get a full thread (root + descendants, chronological). */
app.get('/api/channels/:eventUid/thread', (req, res) => {
  res.json(channelEventService.listThread(req.params.eventUid));
});

/** Post a new channel event from the frontend (human author). */
app.post('/api/plans/:planUid/channels', (req, res) => {
  const { event_type, message, item_uid, attempted, options, responds_to } = req.body || {};
  if (!event_type || !message) {
    res.status(400).json({ error: 'event_type and message are required' });
    return;
  }
  try {
    const identity = getSettings().identity;
    const author = identity.email || 'human';
    const payload: any = { message };
    if (Array.isArray(attempted) && attempted.length) payload.attempted = attempted;
    if (Array.isArray(options) && options.length) payload.options = options;

    const created = channelEventService.postChannelEvent({
      planUid: req.params.planUid,
      itemUid: item_uid ?? null,
      eventType: event_type,
      payload,
      author,
      authorType: 'human',
      agentModel: null,
      respondsTo: responds_to ?? null,
    });

    // Auto-export when the plan is shared (linked to disk).
    try {
      const plan = planService.getPlan(created.planUid);
      if (plan && getLinkedPlanDir(created.planUid, plan.projectPath)) {
        exportChannelEvent(created, plan.projectPath);
      }
    } catch (err) {
      console.warn('[Channels] auto-export failed:', err);
    }

    broadcast('channel-event-posted', {
      uid: created.uid,
      planUid: created.planUid,
      itemUid: created.itemUid,
      eventType: created.eventType,
      respondsTo: created.respondsTo,
    });

    // Phase 2.3 — fire any matching routing rules.
    dispatchChannelEvent(created).catch((err) => console.warn('[Channels] dispatch failed:', err));

    res.json(created);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Change channel event status (resolve / dismiss / reopen). */
app.post('/api/channels/:eventUid/status', (req, res) => {
  const { status } = req.body || {};
  if (!status) {
    res.status(400).json({ error: 'status is required' });
    return;
  }
  try {
    const updated = channelEventService.setChannelEventStatus(req.params.eventUid, status);
    try {
      const plan = planService.getPlan(updated.planUid);
      if (plan && getLinkedPlanDir(updated.planUid, plan.projectPath)) {
        exportChannelEvent(updated, plan.projectPath);
      }
    } catch (err) {
      console.warn('[Channels] auto-export failed:', err);
    }
    broadcast('channel-event-status-changed', {
      uid: updated.uid,
      planUid: updated.planUid,
      status: updated.status,
    });
    // Phase 2.3 — status changes can also match rules (e.g., "page on
    // resolved" or "alert on dismissed").
    dispatchChannelEvent(updated).catch((err) => console.warn('[Channels] dispatch failed:', err));
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Create an item (Object or Action). */
app.post('/api/plans/:planUid/items', (req, res) => {
  const {
    kind, parentUid, sortOrder, title, body, template,
    status, scopePath, fileSpecs, newConnections, removedConnections, dependencies,
  } = req.body || {};
  if (!kind || !title) {
    res.status(400).json({ error: 'kind and title are required' });
    return;
  }
  try {
    const item = planItemService.createItem({
      planUid: req.params.planUid,
      kind,
      parentUid: parentUid ?? null,
      sortOrder,
      title,
      body: body ?? '',
      template: template ?? null,
      status,
      scopePath: scopePath ?? null,
      fileSpecs,
      newConnections,
      removedConnections,
      dependencies,
      author: getAuthorKey('human'),
      authorType: 'human',
    });
    broadcast('plan-item-created', { planUid: item.planUid, item });
    saveNow(() => exportDatabase());
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Get a single item (without children / attachments / comments). */
app.get('/api/items/:uid', (req, res) => {
  const item = planItemService.getItem(req.params.uid);
  if (!item) { res.status(404).json({ error: 'Item not found' }); return; }
  res.json(item);
});

/** Read full bundle: item + parent + children + attachments + comments + recent versions. */
app.get('/api/items/:uid/full', (req, res) => {
  const item = planItemService.getItem(req.params.uid);
  if (!item) { res.status(404).json({ error: 'Item not found' }); return; }
  const parent = item.parentUid ? planItemService.getItem(item.parentUid) : null;
  const children = planItemService.getChildren(item.planUid, req.params.uid);
  const attachments = taskAttachmentsService.listItemAttachments(req.params.uid);
  const comments = commentService.listItemComments(req.params.uid);
  const versions = planItemService.listItemVersions(req.params.uid).slice(0, 10);
  res.json({ item, parent, children, attachments, comments, versions });
});

/** Update any field on an item. */
app.put('/api/items/:uid', (req, res) => {
  const body = req.body ?? {};
  const item = planItemService.updateItem(req.params.uid, {
    title: body.title,
    body: body.body,
    template: body.template,
    status: body.status,
    assignee: body.assignee,
    progressPercent: body.progressPercent,
    blockedReason: body.blockedReason,
    scopePath: body.scopePath,
    fileSpecs: body.fileSpecs,
    newConnections: body.newConnections,
    removedConnections: body.removedConnections,
    dependencies: body.dependencies,
    parentUid: body.parentUid,
    sortOrder: body.sortOrder,
    changeSummary: body.changeSummary,
    author: getAuthorKey('human'),
    authorType: 'human',
  });
  if (!item) { res.status(404).json({ error: 'Item not found' }); return; }
  broadcast('plan-item-updated', { planUid: item.planUid, itemUid: item.uid, kind: item.kind, changes: body });
  saveNow(() => exportDatabase());
  res.json(item);
});

/** Move (re-parent + reorder, single event). */
app.post('/api/items/:uid/move', (req, res) => {
  const { newParentUid, newSortOrder } = req.body || {};
  const item = planItemService.moveItem(req.params.uid, {
    newParentUid: newParentUid === undefined ? undefined : (newParentUid === '' ? null : newParentUid),
    newSortOrder,
    author: getAuthorKey('human'),
    authorType: 'human',
  });
  if (!item) { res.status(404).json({ error: 'Item not found' }); return; }
  broadcast('plan-item-moved', { planUid: item.planUid, itemUid: item.uid, toParentUid: item.parentUid, sortOrder: item.sortOrder });
  saveNow(() => exportDatabase());
  res.json(item);
});

/** Delete (cascade by default; pass ?cascade=false to require empty children). */
app.delete('/api/items/:uid', (req, res) => {
  const target = planItemService.getItem(req.params.uid);
  if (!target) { res.status(404).json({ error: 'Item not found' }); return; }
  const cascade = req.query.cascade !== 'false';
  if (!cascade) {
    const kids = planItemService.getChildren(target.planUid, req.params.uid);
    if (kids.length > 0) {
      res.status(409).json({ error: `Item has ${kids.length} children; pass ?cascade=true to remove the subtree.` });
      return;
    }
  }
  const cascadedUids = planItemService.deleteItem(req.params.uid, {
    cascade,
    author: getAuthorKey('human'),
    authorType: 'human',
  });
  broadcast('plan-item-deleted', { planUid: target.planUid, itemUid: req.params.uid, cascadedUids });
  saveNow(() => exportDatabase());
  res.json({ ok: true, deleted: cascadedUids });
});

/** Atomically claim an Action. */
app.post('/api/items/:uid/claim', (req, res) => {
  const { agentId, agentType, model } = req.body || {};
  const result = planItemService.claimItem(
    req.params.uid,
    agentId || getAuthorKey('human'),
    agentType || 'human',
    model,
  );
  if (result.ok) {
    const item = planItemService.getItem(req.params.uid);
    if (item) {
      broadcast('plan-item-claimed', { planUid: item.planUid, itemUid: item.uid, agentId: agentId || 'human', agentType: agentType || 'human' });
      if (result.conflicts) {
        broadcast('conflict-detected', { planUid: item.planUid, itemUid: item.uid, message: result.conflicts.join('; ') });
      }
    }
    saveNow(() => exportDatabase());
  }
  res.json(result);
});

/** Restore item to a prior version. */
app.post('/api/items/:uid/restore-version/:version', (req, res) => {
  const v = Number(req.params.version);
  if (!Number.isFinite(v)) { res.status(400).json({ error: 'invalid version' }); return; }
  const item = planItemService.restoreItemVersion(req.params.uid, v, getAuthorKey('human'), 'human');
  if (!item) { res.status(404).json({ error: 'Item or version not found' }); return; }
  broadcast('plan-item-version-saved', { planUid: item.planUid, itemUid: item.uid, restoredFrom: v });
  saveNow(() => exportDatabase());
  res.json(item);
});

/** List item versions (history drawer). */
app.get('/api/items/:uid/versions', (req, res) => {
  res.json(planItemService.listItemVersions(req.params.uid));
});

/** List item events (per-item shift drawer). */
app.get('/api/items/:uid/events', (req, res) => {
  res.json(planEventService.listItemEvents(req.params.uid));
});

// --- Item-context endpoints (renamed task-context for V2) -------------------

/** Comments. */
app.get('/api/items/:uid/comments', (req, res) => {
  res.json(commentService.listItemComments(req.params.uid));
});
app.post('/api/items/:uid/comments', (req, res) => {
  const { kind, body, parentCommentUid, source } = req.body || {};
  if (!body || typeof body !== 'string') { res.status(400).json({ error: 'body is required' }); return; }
  const item = planItemService.getItem(req.params.uid);
  if (!item) { res.status(404).json({ error: 'Item not found' }); return; }
  const legacyType =
    kind === 'progress' ? 'status_update' :
    kind === 'blocker' ? 'concern' :
    kind === 'question' ? 'suggestion' : 'comment';
  const comment = commentService.addComment(
    'item',
    req.params.uid,
    getAuthorKey('human'),
    'human',
    body,
    { kind, source: source ?? 'human', commentType: legacyType, parentUid: parentCommentUid },
  );
  broadcast('plan-item-comment-added', { planUid: item.planUid, itemUid: req.params.uid, comment });
  saveNow(() => exportDatabase());
  res.json(comment);
});

/** Mid-task progress (Action only). */
app.post('/api/items/:uid/progress', (req, res) => {
  const { percent, message } = req.body || {};
  if (typeof percent !== 'number' || percent < 0 || percent > 100) {
    res.status(400).json({ error: 'percent must be a number 0-100' });
    return;
  }
  const item = planItemService.getItem(req.params.uid);
  if (!item) { res.status(404).json({ error: 'Item not found' }); return; }
  if (item.kind !== 'action') { res.status(400).json({ error: 'Progress only applies to Actions.' }); return; }
  planItemService.updateItem(req.params.uid, { progressPercent: percent, author: getAuthorKey('human'), authorType: 'human' });
  const body = (typeof message === 'string' && message.trim()) ? message.trim() : `Progress: ${percent}%`;
  const comment = commentService.addComment('item', req.params.uid, getAuthorKey('human'), 'human', body, {
    kind: 'progress', source: 'human', commentType: 'status_update', metadata: { progressPercent: percent },
  });
  broadcast('plan-item-progress', { planUid: item.planUid, itemUid: req.params.uid, percent, message: body, commentUid: comment.uid });
  broadcast('plan-item-comment-added', { planUid: item.planUid, itemUid: req.params.uid, comment });
  saveNow(() => exportDatabase());
  res.json({ ok: true, percent, message: body, commentUid: comment.uid });
});

/** Block an Action with a reason. */
app.post('/api/items/:uid/blocked', (req, res) => {
  const { reason } = req.body || {};
  if (!reason || typeof reason !== 'string') { res.status(400).json({ error: 'reason is required' }); return; }
  const item = planItemService.getItem(req.params.uid);
  if (!item) { res.status(404).json({ error: 'Item not found' }); return; }
  if (item.kind !== 'action') { res.status(400).json({ error: 'Only Actions can be blocked.' }); return; }
  planItemService.updateItem(req.params.uid, { status: 'blocked', blockedReason: reason, author: getAuthorKey('human'), authorType: 'human' });
  const comment = commentService.addComment('item', req.params.uid, getAuthorKey('human'), 'human', reason, {
    kind: 'blocker', source: 'human', commentType: 'concern',
  });
  broadcast('plan-item-blocked', { planUid: item.planUid, itemUid: req.params.uid, reason, commentUid: comment.uid });
  broadcast('plan-item-updated', { planUid: item.planUid, itemUid: req.params.uid, kind: 'action', changes: { status: 'blocked' } });
  broadcast('plan-item-comment-added', { planUid: item.planUid, itemUid: req.params.uid, comment });
  saveNow(() => exportDatabase());
  res.json({ ok: true });
});

/** Item attachments. */
app.get('/api/items/:uid/attachments', (req, res) => {
  res.json(taskAttachmentsService.listItemAttachments(req.params.uid));
});
app.post('/api/items/:uid/attachments', (req, res) => {
  const { kind, value, label, contentType, dataBase64, projectRoot: rawProjectRoot } = req.body || {};
  // Optional here: an attachment with no project root lands in the user
  // directory rather than a per-project one. Absent stays absent.
  const projectRoot = confineRootOptional(rawProjectRoot, res);
  if (projectRoot === null) return;
  if (!kind || value == null) { res.status(400).json({ error: 'kind and value are required' }); return; }
  const item = planItemService.getItem(req.params.uid);
  if (!item) { res.status(404).json({ error: 'Item not found' }); return; }
  try {
    const attachment = taskAttachmentsService.addAttachment({
      targetType: 'item',
      targetUid: req.params.uid,
      kind, value, label, contentType, dataBase64, projectRoot,
      author: getAuthorKey('human'),
      authorType: 'human',
    });
    broadcast('plan-item-attachment-added', { planUid: item.planUid, itemUid: req.params.uid, attachment });
    saveNow(() => exportDatabase());
    res.json(attachment);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * Phase 15 §15.D — serve raw bytes of an inline image / video
 * attachment so the V2 canvas can `<img src>` / `<video>` it.
 *
 * Looks up the attachment by uid, resolves its stored `value` to an
 * absolute path on disk (handles both `.codetrellis/...` project-
 * relative and `userdata://...` user-data forms), and streams the
 * file. Returns 404 for any attachment whose value isn't a file
 * (URL / file_ref pointing at project files / code_block / transcript).
 *
 * The endpoint exists so the renderer doesn't need direct filesystem
 * access — works in both Electron and dev/web mode.
 */
app.get('/api/attachments/:uid/file', (req, res) => {
  const db = getDb();
  const r = db.exec(
    `SELECT value, target_uid, content_type FROM attachments WHERE uid = ?`,
    [req.params.uid],
  );
  const row = r[0]?.values[0];
  if (!row) { res.status(404).json({ error: 'Attachment not found' }); return; }
  const value = row[0] as string;
  const targetUid = row[1] as string;
  const contentType = (row[2] as string | null) ?? 'application/octet-stream';

  // Resolve project root from the parent item -> plan -> project_path.
  // Cheap join — runs once per attachment fetch.
  let projectRoot: string | undefined;
  const parent = db.exec(
    `SELECT p.project_path FROM plan_items i JOIN plans p ON p.uid = i.plan_uid WHERE i.uid = ?`,
    [targetUid],
  );
  const projectPath = parent[0]?.values[0]?.[0] as string | undefined;
  if (projectPath) projectRoot = projectPath;

  const abs = taskAttachmentsService.resolveAttachmentAbsPath(value, projectRoot);
  if (!abs) {
    res.status(404).json({ error: 'Attachment value is not a file', value });
    return;
  }
  if (!fs.existsSync(abs)) {
    res.status(404).json({ error: 'Attachment file missing on disk', path: abs });
    return;
  }
  // Caching is fine — the file is immutable (uid in the path).
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Content-Type', contentType);
  fs.createReadStream(abs).pipe(res);
});

// Plan versions
app.get('/api/plans/:uid/versions', (req, res) => {
  res.json(planService.getPlanVersions(req.params.uid));
});

// Plan projection
app.get('/api/plans/:uid/projection', (req, res) => {
  res.json(computeProjection(req.params.uid));
});

// Plan deviations
app.get('/api/plans/:uid/deviations', (req, res) => {
  res.json(getDeviations(req.params.uid));
});

// Reconcile deviations
app.post('/api/plans/:uid/reconcile', (req, res) => {
  const { deviations } = req.body; // [{id, action}]
  if (!Array.isArray(deviations)) { res.status(400).json({ error: 'deviations array required' }); return; }
  for (const d of deviations) {
    resolveDeviation(d.id, d.action);
  }
  res.json({ ok: true, resolved: deviations.length });
});

// --- Plan Spec Documents API ---

app.get('/api/plans/:uid/docs', (req, res) => {
  if (req.query.summary === '1') {
    res.json(listPlanDocumentSummaries(req.params.uid));
  } else {
    res.json(listPlanDocuments(req.params.uid));
  }
});

app.post('/api/plans/:uid/docs', (req, res) => {
  const { docType, title, body, author, authorType, orderHint, parentDocUid } = req.body || {};
  if (!docType || !title) {
    res.status(400).json({ error: 'docType and title are required' });
    return;
  }
  const doc = createPlanDocument({
    planUid: req.params.uid,
    docType,
    title,
    body: body ?? '',
    author: author ?? getAuthorKey('human'),
    authorType: authorType ?? 'human',
    orderHint: orderHint ?? null,
    parentDocUid: parentDocUid ?? null,
  });
  broadcast('plan-doc-created', { doc });
  saveNow(() => exportDatabase());
  res.json(doc);
});

app.get('/api/plans/:uid/docs/by-type/:docType', (req, res) => {
  const doc = getPlanDocumentByType(req.params.uid, req.params.docType);
  if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }
  res.json(doc);
});

app.get('/api/plans/:uid/docs/search', (req, res) => {
  const q = (req.query.q as string) || '';
  res.json(searchPlanDocuments(req.params.uid, q));
});

app.get('/api/plan-docs/:docUid', (req, res) => {
  const doc = getPlanDocument(req.params.docUid);
  if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }
  res.json(doc);
});

app.put('/api/plan-docs/:docUid', (req, res) => {
  const { title, body, docType, changeSummary, author, orderHint, parentDocUid } = req.body || {};
  const doc = updatePlanDocument(req.params.docUid, {
    title, body, docType, changeSummary, author, orderHint, parentDocUid,
  });
  if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }
  broadcast('plan-doc-updated', { doc });
  saveNow(() => exportDatabase());
  res.json(doc);
});

app.delete('/api/plan-docs/:docUid', (req, res) => {
  deletePlanDocument(req.params.docUid);
  broadcast('plan-doc-deleted', { docUid: req.params.docUid });
  saveNow(() => exportDatabase());
  res.json({ ok: true });
});

app.get('/api/plan-docs/:docUid/versions', (req, res) => {
  res.json(getPlanDocumentVersions(req.params.docUid));
});

// --- Plan Phases API ---

app.get('/api/plans/:uid/phases', (req, res) => {
  res.json(listPhases(req.params.uid));
});

app.post('/api/plans/:uid/phases', (req, res) => {
  const { title, scope, prerequisites, gitCheckpoint, acceptanceCriteria, status, phaseNumber } = req.body || {};
  if (!title) {
    res.status(400).json({ error: 'title is required' });
    return;
  }
  const phase = createPhase({
    planUid: req.params.uid,
    title,
    scope,
    prerequisites,
    gitCheckpoint,
    acceptanceCriteria,
    status,
    phaseNumber,
  });
  broadcast('plan-phase-created', { phase });
  saveNow(() => exportDatabase());
  res.json(phase);
});

app.put('/api/plan-phases/:phaseUid', (req, res) => {
  const phase = updatePhase(req.params.phaseUid, req.body || {});
  if (!phase) { res.status(404).json({ error: 'Phase not found' }); return; }
  broadcast('plan-phase-updated', { phase });
  saveNow(() => exportDatabase());
  res.json(phase);
});

app.delete('/api/plan-phases/:phaseUid', (req, res) => {
  deletePhase(req.params.phaseUid);
  broadcast('plan-phase-deleted', { phaseUid: req.params.phaseUid });
  saveNow(() => exportDatabase());
  res.json({ ok: true });
});

// --- Proposed Changes API (Phase 12 §B) ---

app.get('/api/plans/:uid/changes', (req, res) => {
  if (req.query.summary === '1') {
    res.json(summarizeChanges(req.params.uid));
  } else {
    res.json(listProposedChanges(req.params.uid));
  }
});

// --- Fast-forward (Phase 26, layer C) ---
//
// An ordered sequence of points plus the delta between each consecutive
// pair. Discrete by design: between two frames a file either has a
// recorded state or it does not, and a tween of source code would be
// fiction.
app.get('/api/playback', (req, res) => {
  const projectPath = requireProjectRoot(req, res);
  if (!projectPath) return;

  const limitRaw = Number(req.query.limit);
  res.json(
    buildPlaybackSequence({
      projectPath,
      limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
      includeCheckpoints: req.query.checkpoints !== '0',
    }),
  );
});

// --- File at a point in time (Phase 26, the diff editor's backing call) ---
//
// A checkpoint and the baseline store content HASHES, not blobs, so they
// can say which files changed but never how. This says so rather than
// falling back to the live file, which would diff a file against itself
// and render as "no changes" — a confident wrong answer where the honest
// one is "cannot".
app.get('/api/file/at', (req, res) => {
  const projectPath = optionalProjectRoot(req, res);
  if (projectPath === null) return;
  const relativePath = req.query.path as string;
  const at = (req.query.at as string) || 'live';
  if (!projectPath || !relativePath) {
    res.status(400).json({ error: 'project and path query params required' });
    return;
  }

  // The path is project-RELATIVE and read through the confined helper, so a
  // caller cannot nominate a root (checked here) or escape one (checked there).
  // The '..' test below is a cheap early refusal, NOT the containment control —
  // it does not see an absolute path or a symlink. `readFileAt` is what confines.
  const owningRoot = listTrustedRoots().find((r) => isWithin(r, projectPath) || r === projectPath);
  if (!owningRoot) {
    res.status(403).json({ error: 'Refusing to read from a project that is not open' });
    return;
  }
  if (relativePath.includes('..')) {
    res.status(400).json({ error: 'Relative path must not traverse upwards' });
    return;
  }

  try {
    res.json(readFileAt(at, owningRoot, relativePath));
  } catch (err) {
    if (err instanceof ConfinementError) {
      res.status(403).json({ error: err.message });
      return;
    }
    res.status(400).json({ error: err instanceof Error ? err.message : 'Could not read file' });
  }
});

// --- Plan overlay on code (Phase 26) ---
//
// FileSpec.edits[] has carried lineRange and symbol since Phase 15 §M2
// and nothing ever drew it. This projects that intent onto a file's
// lines so a developer reading code can see what is planned for it.
app.get('/api/file/overlay', (req, res) => {
  const filePath = req.query.path as string;
  const projectPath = optionalProjectRoot(req, res);
  if (projectPath === null) return;
  if (!filePath || !projectPath) {
    res.status(400).json({ error: 'path and project query params required' });
    return;
  }

  // The plan uid, when given, only NARROWS the result — it never widens
  // access, and the file itself is read through the same confined route
  // the content endpoint uses.
  const planUid = (req.query.plan as string) || null;

  // Same confinement as /api/file/content (Phase 19, finding 5): the
  // owning root is derived from the opened projects, never nominated by
  // the caller, and the read goes through the confined helper so a
  // symlink cannot escape it.
  let lineCount = 0;
  try {
    const owningRoot = listTrustedRoots().find((r) => isWithin(r, filePath));
    if (!owningRoot) {
      res.status(403).json({ error: 'Refusing to read a file outside every opened project' });
      return;
    }
    const contents = readFileWithin(owningRoot, filePath, 'file/overlay');
    lineCount = contents.toString('utf-8').split('\n').length;
  } catch (err) {
    if (err instanceof ConfinementError) {
      res.status(403).json({ error: err.message });
      return;
    }
    res.status(404).json({ error: 'File not found' });
    return;
  }

  const plans = planService.listPlans(projectPath).map((p) => p.uid);
  res.json(
    buildFileOverlay({
      absolutePath: filePath,
      relativePath: relativeTo(projectPath, filePath),
      lineCount,
      planUid,
      plans,
    }),
  );
});

// --- Comparison + review (Phase 25) ---
//
// Any two points, not just "live vs the pinned baseline". Making the
// comparands explicit is most of what makes Diff mode legible: the
// chrome can finally state what it is showing.
app.get('/api/comparands', (req, res) => {
  const projectPath = requireProjectRoot(req, res);
  if (!projectPath) return;
  res.json(listComparands(projectPath));
});

app.get('/api/compare', (req, res) => {
  const projectPath = requireProjectRoot(req, res);
  if (!projectPath) return;
  const before = (req.query.before as string) || 'baseline';
  const after = (req.query.after as string) || 'live';
  const result = compareSnapshots(before, after, projectPath);
  if (!result.ok) { res.status(404).json(result); return; }
  res.json(result.result);
});

app.get('/api/plans/:uid/pr-draft', (req, res) => {
  const projectPath = requireProjectRoot(req, res);
  if (!projectPath) return;
  // Read-only: this never touches the repository. The agent does the git
  // and opens the PR with its own credentials; we supply the body it
  // cannot write.
  const result = buildPrDraft({
    planUid: req.params.uid,
    projectPath,
    before: req.query.before as string | undefined,
    after: req.query.after as string | undefined,
  });
  if (!result.ok) { res.status(404).json(result); return; }
  res.json(result.draft);
});

app.get('/api/plans/:uid/review', (req, res) => {
  const projectPath = requireProjectRoot(req, res);
  if (!projectPath) return;
  const result = reviewPlan({
    planUid: req.params.uid,
    projectPath,
    before: req.query.before as string | undefined,
    after: req.query.after as string | undefined,
  });
  if (!result.ok) { res.status(404).json(result); return; }
  if (req.query.format === 'markdown') {
    res.type('text/markdown').send(renderReviewMarkdown(result.review));
    return;
  }
  res.json(result.review);
});

// --- Budgets (Phase 23) ---
//
// Time is measured for every agent; cost only where the agent reports a
// model we have prices for. An unknown cost comes back as null, never
// zero — see services/pricing.ts.
app.get('/api/plans/:uid/budget', (req, res) => {
  res.json(budgetService.getBudgetReport(req.params.uid));
});

app.put('/api/plans/:uid/budget', (req, res) => {
  const body = (req.body ?? {}) as { minutes?: number | null; costUsd?: number | null; exempt?: boolean };

  // A ceiling is a positive number or an explicit null to clear it. Nothing
  // else is a ceiling, and the difference matters: the chip's inputs are free
  // text, `Number('')` and `Number('ten')` are NaN, and `JSON.stringify` turns
  // NaN into null — so a typo arrived here indistinguishable from "clear my
  // budget", and silently removed one the user had set. Undefined still means
  // "leave it alone"; null still means "clear it".
  const ceiling = (v: unknown, label: string): string | null =>
    v === undefined || v === null || (typeof v === 'number' && Number.isFinite(v) && v > 0)
      ? null
      : `${label} must be a positive number, or null to clear it`;
  const invalid = ceiling(body.minutes, 'minutes') ?? ceiling(body.costUsd, 'costUsd');
  if (invalid) {
    res.status(400).json({ error: invalid });
    return;
  }

  // The plan uid comes from the route, never from the body — the same
  // rule Phase 19 applies to project roots.
  const budget = budgetService.setBudget({
    planUid: req.params.uid,
    minutes: body.minutes,
    costUsd: body.costUsd,
    exempt: body.exempt,
  });
  broadcast('plan-budget-changed', { planUid: req.params.uid, budget });
  res.json(budgetService.getBudgetReport(req.params.uid));
});

/**
 * External ticket sync state (Phase 29, surfacing Phase 24).
 *
 * `getSyncState` has existed since Phase 24 and was reachable only
 * through the `get_external_sync_state` MCP tool — so the "3 tickets
 * need updating" signal existed as data and appeared nowhere. The plan
 * uid comes from the route, never the body.
 */
app.get('/api/plans/:uid/external-sync', (req, res) => {
  try {
    res.json(externalIntakeService.getSyncState(req.params.uid));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/plans/:uid/budget/check', (req, res) => {
  res.json(budgetService.checkBudget(req.params.uid));
});

app.get('/api/plans/:uid/changes/:changeId', (req, res) => {
  const change = getChange(req.params.uid, req.params.changeId);
  if (!change) { res.status(404).json({ error: 'Change not found' }); return; }
  res.json(change);
});

// --- Plan File Sync API (Phase 13 §A) ---

app.post('/api/plans/:uid/export', (req, res) => {
  // The body form is the Phase 19 rule verbatim — a root must never
  // come from a request body — so both spellings are confined.
  const projectRoot = confineRoot(
    (req.query.path as string) || (req.body && req.body.projectRoot),
    res,
    'path',
  );
  if (!projectRoot) return;
  try {
    const result = exportPlan(req.params.uid, projectRoot);
    broadcast('plan-exported', { planUid: req.params.uid, planDir: result.planDir, files: result.files.length });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/plans/import', (req, res) => {
  const planDir = (req.query.path as string) || (req.body && req.body.planDir);
  if (!planDir) {
    res.status(400).json({ error: 'planDir path required (?path=… or body.planDir)' });
    return;
  }
  try {
    const result = importPlan(planDir);
    broadcast('plan-imported', { planUid: result.plan.uid, source: planDir });
    saveNow(() => exportDatabase());
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Phase 17.I — Import plan from external source (GitHub issue, conversation, diff, session)
app.post('/api/plans/import-external', (req, res) => {
  const { source, projectPath: rawProjectPath, ...input } = req.body;
  const projectPath = confineRoot(rawProjectPath, res, 'projectPath');
  if (!projectPath) return;
  if (!source || !projectPath) {
    res.status(400).json({ error: 'source and projectPath required' });
    return;
  }

  let result: planImportService.PlanImportResult;
  try {
    switch (source) {
      case 'github_issue':
        result = planImportService.importFromGitHubIssue(input);
        break;
      case 'conversation':
        result = planImportService.importFromConversation(input);
        break;
      case 'git_diff':
        result = planImportService.importFromGitDiff(input);
        break;
      case 'claude_session':
        result = planImportService.importFromClaudeSession(input);
        break;
      default:
        res.status(400).json({ error: `Unknown source: ${source}` });
        return;
    }
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    return;
  }

  // Create the plan
  const plan = planService.createPlan(
    { title: result.title, description: result.description, tasks: [] },
    getAuthorKey('human'),
    'human',
    projectPath,
  );

  // Create child items
  const createdItems: string[] = [];
  for (const item of result.items) {
    const created = planItemService.createItem({
      planUid: plan.uid,
      kind: item.kind,
      title: item.title,
      body: item.body,
      fileSpecs: item.fileSpecs,
      scopePath: item.scopePath,
      author: getAuthorKey('human'),
      authorType: 'human',
    });
    createdItems.push(created.uid);
  }

  broadcast('plan-created', { plan });
  saveNow(() => exportDatabase());
  res.json({
    plan,
    itemCount: createdItems.length,
    source: result.source,
    metadata: result.metadata,
  });
});

app.get('/api/plans/:uid/file-status', (req, res) => {
  const projectRoot = confineRoot(req.query.path, res, 'path');
  if (!projectRoot) return;
  const planDir = getLinkedPlanDir(req.params.uid, projectRoot);
  res.json({ linked: planDir !== null, planDir });
});

app.post('/api/plans/:uid/unlink', (req, res) => {
  // The body form is the Phase 19 rule verbatim — a root must never
  // come from a request body — so both spellings are confined.
  const projectRoot = confineRoot(
    (req.query.path as string) || (req.body && req.body.projectRoot),
    res,
    'path',
  );
  if (!projectRoot) return;
  try {
    const result = unlinkPlan(req.params.uid, projectRoot);
    broadcast('plan-unlinked', { planUid: req.params.uid });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// --- Plan Templates API (Phase 12 §G) ---

app.get('/api/plan-templates', (req, res) => {
  // Phase 13 §C: include disk templates from <project>/.codetrellis/
  // templates/ + ~/.codetrellis/templates/ when a project path is
  // passed. No project = built-ins + user-global only.
  const projectRoot = optionalProjectRoot(req, res);
  if (projectRoot === null) return;
  res.json(listTemplates(projectRoot));
});

app.post('/api/plans/:uid/publish-as-template', (req, res) => {
  const { projectRoot: rawProjectRoot, templateId, label, shortDescription, longDescription, defaultTitle, defaultPlanDescription, placeholders } = req.body || {};
  const projectRoot = confineRoot(rawProjectRoot, res, 'projectRoot');
  if (!projectRoot) return;
  if (!projectRoot || !templateId) {
    res.status(400).json({ error: 'projectRoot + templateId required' });
    return;
  }
  try {
    const result = publishPlanAsTemplate({
      planUid: req.params.uid,
      projectRoot,
      templateId,
      label,
      shortDescription,
      longDescription,
      defaultTitle,
      defaultPlanDescription,
      placeholders,
    });
    broadcast('plan-template-published', { templateId, templateDir: result.templateDir });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/plans/from-template', (req, res) => {
  const { templateId, projectPath: rawProjectPath, title, description, author, authorType, placeholderValues } = req.body || {};
  const projectPath = confineRoot(rawProjectPath, res, 'projectPath');
  if (!projectPath) return;
  if (!templateId || !projectPath) {
    res.status(400).json({ error: 'templateId and projectPath are required' });
    return;
  }
  try {
    const result = applyTemplate({
      templateId, projectPath, title, description, author, authorType,
      placeholderValues,
    });
    broadcast('plan-created', { plan: result.plan });
    for (const phase of result.phases) broadcast('plan-phase-created', { phase });
    for (const doc of result.docs) broadcast('plan-doc-created', { doc });
    saveNow(() => exportDatabase());
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// --- Trellis Snapshots API ---

app.post('/api/trellis/capture', (req, res) => {
  const { projectPath: rawProjectPath, planUid, name } = req.body;
  const projectPath = confineRoot(rawProjectPath, res, 'projectPath');
  if (!projectPath) return;
  if (!projectPath) { res.status(400).json({ error: 'projectPath required' }); return; }
  const snapshot = captureCurrentTrellis(projectPath, planUid, name);
  broadcast('trellis-captured', { snapshot: { id: snapshot.id, name: snapshot.name, snapshotType: snapshot.snapshotType } });
  saveNow(() => exportDatabase());
  res.json({ id: snapshot.id, name: snapshot.name, snapshotType: snapshot.snapshotType, createdAt: snapshot.createdAt });
});

app.get('/api/trellis/snapshots', (req, res) => {
  const planUid = req.query.plan as string | undefined;
  res.json(listSnapshots(planUid));
});

app.get('/api/trellis/:id', (req, res) => {
  const snapshot = getSnapshot(parseInt(req.params.id));
  if (!snapshot) { res.status(404).json({ error: 'Snapshot not found' }); return; }
  res.json(snapshot);
});

app.get('/api/trellis/:id/diff', (req, res) => {
  const diff = computeTrellisDiff(parseInt(req.params.id));
  if (!diff) { res.status(404).json({ error: 'Snapshot not found' }); return; }
  res.json(diff);
});

// --- Comments API ---

app.get('/api/comments', (req, res) => {
  const target = req.query.target as string;
  if (!target) { res.json([]); return; }
  res.json(commentService.getComments(target));
});

app.post('/api/comments', (req, res) => {
  const { targetType, targetUid, body, commentType, parentUid } = req.body;
  if (!targetUid || !body) { res.status(400).json({ error: 'targetUid and body required' }); return; }
  const comment = commentService.addComment(targetType || 'plan', targetUid, getAuthorKey('human'), 'human', body, commentType, parentUid);
  broadcast('comment-added', { comment });
  saveNow(() => exportDatabase());
  res.json(comment);
});

/** Phase 15 §15.D — delete a comment (hard-delete, no tombstone). */
app.delete('/api/comments/:uid', (req, res) => {
  const ok = commentService.deleteComment(req.params.uid);
  if (!ok) { res.status(404).json({ error: 'Comment not found' }); return; }
  broadcast('comment-deleted', { uid: req.params.uid });
  saveNow(() => exportDatabase());
  res.json({ ok: true });
});

// --- External References API (Phase 17.R) ---

app.get('/api/items/:itemUid/refs', (req, res) => {
  res.json(externalRefsService.getExternalRefs(req.params.itemUid));
});

app.get('/api/plans/:uid/refs', (req, res) => {
  res.json(externalRefsService.getExternalRefsByPlan(req.params.uid));
});

app.post('/api/items/:itemUid/refs', (req, res) => {
  const { url, title, kind, metadata } = req.body;
  if (!url) { res.status(400).json({ error: 'url required' }); return; }
  try {
    const ref = externalRefsService.createExternalRef({
      itemUid: req.params.itemUid,
      url,
      title,
      kind,
      metadata,
      author: getAuthorKey('human'),
      authorType: 'human',
    });
    broadcast('external-ref-added', { ref });
    saveNow(() => exportDatabase());
    res.json(ref);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.put('/api/refs/:uid', (req, res) => {
  const { title, metadata } = req.body;
  externalRefsService.updateExternalRef(req.params.uid, { title, metadata });
  broadcast('external-ref-updated', { uid: req.params.uid });
  saveNow(() => exportDatabase());
  res.json({ ok: true });
});

app.delete('/api/refs/:uid', (req, res) => {
  externalRefsService.deleteExternalRef(req.params.uid);
  broadcast('external-ref-deleted', { uid: req.params.uid });
  saveNow(() => exportDatabase());
  res.json({ ok: true });
});

// --- Sessions API ---

app.get('/api/sessions', (_req, res) => {
  res.json(sessionService.getActiveSessions());
});

// Phase 17.H — Assign a plan to a specific agent session
app.post('/api/sessions/:sessionId/assign-plan', (req, res) => {
  const { sessionId } = req.params;
  const { planUid } = req.body;
  if (!planUid) { res.status(400).json({ error: 'planUid required' }); return; }
  sessionService.setActivePlan(sessionId, planUid);
  broadcast('plan-assigned', { sessionId, planUid });
  broadcast('mcp-session-changed', { reason: 'assign_plan', sessionId, planUid });
  res.json({ ok: true });
});

// Database stats
app.get('/api/stats', (_req, res) => {
  res.json(getDbStats());
});

/**
 * Coverage — what the scan could not resolve, and why (Phase 29).
 *
 * `/api/stats` has carried `importCount` and `resolvedImports` since
 * long before this, and nothing ever read them. This endpoint exists
 * because a bare total is not an answer: the REASON for each gap is a
 * property of the language, so the split has to come from the query.
 * See services/coverage-service.ts.
 */
app.get('/api/coverage', (_req, res) => {
  try {
    res.json(getCoverageReport());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Architecture summary (Phase 17.A — Codebase Orientation)
app.get('/api/architecture-summary', (_req, res) => {
  try {
    res.json(getArchitectureSummary());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Agent watcher status
app.get('/api/agent/status', (_req, res) => {
  res.json(getWatcherStatus());
});

// MCP status
app.get('/api/mcp/status', (_req, res) => {
  res.json(getMcpStatus());
});

// MCP config for agents to copy
app.get('/api/mcp/config', (_req, res) => {
  res.json(getMcpConfig());
});

// --- Logs API (Phase 13 follow-up) ---

app.get('/api/logs/tail', (req, res) => {
  const maxBytes = req.query.maxBytes ? Math.min(Number(req.query.maxBytes), 1024 * 1024) : 64 * 1024;
  res.json({
    path: getCurrentLogPath(),
    content: tailLog(maxBytes),
  });
});

app.get('/api/logs/path', (_req, res) => {
  res.json({ logFile: getCurrentLogPath(), logDir: getLogDir() });
});

// --- Build info (so Settings → About can show what's actually running) ---

/**
 * In dev (running from source) the committed `BUILD_INFO` constant
 * goes stale fast — every version bump in `package.json` would
 * require re-running `scripts/generate-build-info.js`. The user
 * reported the panel showing v0.1.0 when the repo was actually at
 * v0.1.3 because the committed snapshot pre-dated the version bumps.
 *
 * Fix: recompute live from `package.json` + `git` on every request
 * when we can. In packaged Electron (no source tree), `git` and the
 * source `package.json` both fail; we fall through to BUILD_INFO.
 *
 * Cheap: a few git invocations per Settings → About open. No caching
 * needed at this volume.
 */
function liveBuildInfo(): typeof BUILD_INFO | null {
  try {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    if (!fs.existsSync(pkgPath)) return null;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    if (pkg.name !== 'codetrellis') return null;

    const runGit = (args: string[]): string => {
      try {
        return execFileSync('git', args, {
          cwd: process.cwd(),
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
      } catch {
        return '';
      }
    };

    const commit = runGit(['rev-parse', 'HEAD']);
    const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
    const buildNumberStr = runGit(['rev-list', '--count', 'HEAD']);
    const buildNumber = buildNumberStr ? Number(buildNumberStr) : 0;
    const dirty = runGit(['status', '--porcelain']).length > 0;

    // We use `process.uptime()` to imply a "this server is freshly
    // running" feel — the buildTime in dev is the boot time, not the
    // last commit time. Closer to "what you're actually running."
    const buildTime = new Date(Date.now() - process.uptime() * 1000).toISOString();

    return {
      version: pkg.version || BUILD_INFO.version,
      buildTime,
      buildNumber: Number.isFinite(buildNumber) ? buildNumber : BUILD_INFO.buildNumber,
      commit: commit || BUILD_INFO.commit,
      commitShort: commit ? commit.slice(0, 7) : BUILD_INFO.commitShort,
      branch: branch || BUILD_INFO.branch,
      dirty,
    };
  } catch {
    return null;
  }
}

app.get('/api/build-info', (_req, res) => {
  res.json(liveBuildInfo() ?? BUILD_INFO);
});

// --- OTA update polling (against codetrellis.dev with GitHub fallback) ---

/**
 * Read the cached update-check state. Cheap; doesn't hit the
 * network. The frontend polls this on mount + after a manual
 * "Check for updates" click.
 */
app.get('/api/updates/status', (_req, res) => {
  res.json(getUpdateState());
});

/**
 * Download the available update and verify it against the published checksum
 * (Phase 19, finding 23).
 *
 * The URL and digest come from the update state we already fetched, NOT from
 * the request. A caller cannot name what gets downloaded — that would hand the
 * renderer, and anything that reaches it, an arbitrary-fetch primitive.
 */
app.post('/api/updates/download', async (_req, res) => {
  try {
    const current = getUpdateState();
    const download = current.result?.download;
    if (!current.result?.available || !download) {
      res.status(409).json({ error: 'No update is available to download' });
      return;
    }
    const outcome = await startUpdateDownload(current.result.latest, download);
    res.status(outcome.phase === 'error' ? 502 : 200).json(outcome);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/updates/download/status', (_req, res) => {
  res.json(getUpdateDownloadState());
});

app.post('/api/updates/download/cancel', (_req, res) => {
  res.json(cancelUpdateDownload());
});

/**
 * Force a fresh update check. Returns the new state.
 *
 * Used by:
 *   - Settings → About → "Check for updates" button
 *   - End-to-end harness when we add an OTA test
 */
app.post('/api/updates/check', async (_req, res) => {
  try {
    const result = await checkForUpdate({ force: true });
    res.json(result);
    if (result.status === 'available') {
      broadcast('update-available', { result: result.result });
    }
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// --- Settings API (Phase 13 §D) ---

/**
 * Phase 5.1 — lightweight first-run check. Returns just the
 * `firstRunComplete` flag + identity so the frontend can decide
 * whether to show the onboarding wizard without fetching the full
 * settings blob (which includes MCP / data dir details the wizard
 * doesn't need). Also returns git-derived identity defaults so the
 * wizard can pre-populate the name/email fields.
 */
app.get('/api/settings/first-run-check', (req, res) => {
  const settings = getSettings();
  const projectPath = optionalProjectRoot(req, res);
  if (projectPath === null) return;
  const gitDefaults = readGitIdentity(projectPath);

  // Can we answer "who are you?" without asking?
  //
  // The wizard asked the user to confirm a name and email it had
  // ALREADY read out of `git config` and pre-filled into both boxes —
  // an interruption to confirm what we knew. Worse, it replaced the
  // whole app rather than sitting over it, so a first-time user could
  // not look at anything until they had filled in a form about
  // attribution for work they had not done yet.
  //
  // `canDeriveIdentity` says whether asking is necessary at all. The
  // frontend seeds silently when it is true, and only prompts when git
  // genuinely cannot tell us — which is the case worth a question.
  const haveIdentity = Boolean(settings.identity.displayName || settings.identity.email);
  const canDeriveIdentity = haveIdentity || Boolean(gitDefaults.name || gitDefaults.email);

  res.json({
    firstRunComplete: settings.firstRunComplete,
    identity: settings.identity,
    gitDefaults,
    canDeriveIdentity,
  });
});

app.get('/api/settings', (_req, res) => {
  res.json(getSettings());
});

app.put('/api/settings', (req, res) => {
  const before = getSettings();
  const next = updateSettings(req.body || {});
  // Tell the frontend (and any open Settings panels in other windows)
  // that settings changed.
  broadcast('settings-changed', { settings: next });
  // If the MCP port preference changed, the frontend should know that
  // a server restart may be needed for it to take effect.
  if (before.mcp.port !== next.mcp.port) {
    broadcast('mcp-port-config-changed', { configuredPort: next.mcp.port });
  }
  // Phase 19 — live-toggle the LAN listener when the user changes it.
  //
  // Without this, turning exposure OFF would leave :19480 bound until the
  // next restart: the user would be told they had closed it while the socket
  // was still accepting connections. A security toggle that only takes
  // effect on restart is worse than no toggle, because it is believed.
  if (before.device.exposeMobileApi !== next.device.exposeMobileApi) {
    try {
      const mobileApi = _lazy___services_mobile_api_server;
      if (next.device.exposeMobileApi) {
        void mobileApi.startMobileApiServer();
        console.log('[Backend] Mobile API exposed on the local network (user-enabled)');
      } else {
        mobileApi.stopMobileApiServer();
        console.log('[Backend] Mobile API listener closed (user-disabled)');
      }
    } catch (err) {
      console.warn('[Backend] Mobile API reconfigure failed:', err);
    }
  }

  // Phase 9 — live-restart mDNS when device settings change.
  if (before.device.advertise !== next.device.advertise ||
      before.device.deviceName !== next.device.deviceName) {
    try {
      const mdns = _lazy___services_mdns_service;
      if (next.device.advertise) {
        mdns.startMdns(next.device.deviceName || undefined);
      } else {
        mdns.stopMdns();
      }
    } catch (err) {
      console.warn('[Backend] mDNS reconfigure failed:', err);
    }
  }
  // Session-persistence plan / Track A — if anything in the power
  // section changed, the state machine needs to re-evaluate (a toggle
  // can engage / drop the blocker even when no input signal moved).
  if (JSON.stringify(before.power) !== JSON.stringify(next.power)) {
    try {
      powerService.notifyPowerSettingsChanged();
    } catch (err) {
      console.warn('[Backend] notifyPowerSettingsChanged failed:', err);
    }
  }
  res.json(next);
});

/**
 * Session-persistence plan §7.5/§7.6 — paginated read of the
 * persistent on-disk terminal history. Same shape as the mobile RPC
 * but addressable from the renderer for the eventual desktop
 * scrollback-UI follow-up.
 *   GET /api/terminals/:id/history?before=<int>&limit=<int>
 *   → { data, prevOffset, hasMore, fileSize, capped }
 */
app.get('/api/terminals/:id/history', (req, res) => {
  try {
    const id = String(req.params.id);
    const beforeRaw = req.query.before;
    const limitRaw = req.query.limit;
    const before = typeof beforeRaw === 'string' ? Number(beforeRaw) : undefined;
    const limit = typeof limitRaw === 'string' ? Number(limitRaw) : undefined;
    res.json(terminalHistoryService.getHistoryChunk(
      id,
      Number.isFinite(before) ? before : undefined,
      Number.isFinite(limit) ? limit : undefined,
    ));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/**
 * Read the current power-service status. Used by the desktop UI
 * (Settings panel section + TopBar awake indicator) to render whether
 * the blocker is currently engaged and why. Real-time updates also
 * arrive via the `power-status` broadcast — this endpoint is the
 * lazy/initial fetch path.
 */
app.get('/api/power/status', (_req, res) => {
  try {
    res.json(powerService.getCurrentPowerStatus());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/**
 * Read git config defaults for the active project (or a path passed
 * in via ?project=) so the Settings panel can pre-populate the
 * Identity section. Returns `{ name, email }` with empty strings on
 * miss — never errors.
 */
app.get('/api/identity/git-defaults', (req, res) => {
  const projectPath = optionalProjectRoot(req, res);
  if (projectPath === null) return;
  res.json(readGitIdentity(projectPath));
});

// --- CDev Phase 5.3 — Personal sync REST surface ---

app.get('/api/sync/status', (_req, res) => {
  const { getSyncStatus } = _lazy___services_personal_sync_service;
  res.json(getSyncStatus());
});

app.get('/api/sync/peek', (_req, res) => {
  const { peekImport } = _lazy___services_personal_sync_service;
  res.json(peekImport());
});

app.post('/api/sync/export', (_req, res) => {
  const { exportSync } = _lazy___services_personal_sync_service;
  const { listRecentProjects } = _lazy___services_recent_projects_service;
  const recentProjects = listRecentProjects().map((p: { path: string; lastOpenedAt: number }) => ({
    projectPath: p.path,
    lastOpenedAt: new Date(p.lastOpenedAt).toISOString(),
  }));
  res.json(exportSync(recentProjects));
});

app.post('/api/sync/import', (_req, res) => {
  const { importSync } = _lazy___services_personal_sync_service;
  const result = importSync();
  if (result.settingsImported) {
    broadcast('settings-changed', { settings: getSettings() });
  }
  res.json(result);
});

// --- CDev Phase 6 — Team history, conflict resolution, freeze periods ---

app.get('/api/team-activity', (req, res) => {
  const { getTeamActivity } = _lazy___services_git_activity_service;
  const projectPath = requireProjectRoot(req, res);
  if (!projectPath) return;
  const since = req.query.since as string | undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
  const entries = getTeamActivity({ projectRoot: projectPath, since, limit });
  res.json({ total: entries.length, entries });
});

app.get('/api/plan-history/:planSlug', (req, res) => {
  const { getPlanCommitHistory } = _lazy___services_git_activity_service;
  const projectPath = requireProjectRoot(req, res);
  if (!projectPath) return;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
  const since = req.query.since as string | undefined;
  const commits = getPlanCommitHistory(projectPath, req.params.planSlug, { limit, since });
  res.json({ total: commits.length, commits });
});

app.get('/api/plan-history/:planSlug/at/:commitHash', (req, res) => {
  const { getPlanAtCommit } = _lazy___services_plan_history_service;
  const projectPath = requireProjectRoot(req, res);
  if (!projectPath) return;
  if (!isSafeGitRef(req.params.commitHash)) {
    res.status(400).json({ error: 'Invalid commit identifier' });
    return;
  }
  const state = getPlanAtCommit(projectPath, req.params.planSlug, req.params.commitHash);
  if (!state) { res.status(404).json({ error: 'Plan or commit not found' }); return; }
  res.json(state);
});

app.get('/api/plan-history/:planSlug/diff', (req, res) => {
  const { diffPlanBetweenCommits } = _lazy___services_plan_history_service;
  const projectPath = optionalProjectRoot(req, res);
  if (projectPath === null) return;
  const base = req.query.base as string | undefined;
  const head = req.query.head as string | undefined;
  if (!projectPath || !base || !head) {
    res.status(400).json({ error: 'project, base, and head query params required' });
    return;
  }
  if (!isSafeGitRef(base) || !isSafeGitRef(head)) {
    res.status(400).json({ error: 'Invalid commit identifier' });
    return;
  }
  const diff = diffPlanBetweenCommits(projectPath, req.params.planSlug, base, head);
  res.json(diff);
});

app.get('/api/plan-history/:planSlug/search', (req, res) => {
  const { searchPlanHistory } = _lazy___services_git_activity_service;
  const projectPath = optionalProjectRoot(req, res);
  if (projectPath === null) return;
  const query = req.query.q as string | undefined;
  if (!projectPath || !query) {
    res.status(400).json({ error: 'project and q query params required' });
    return;
  }
  const since = req.query.since as string | undefined;
  const until = req.query.until as string | undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
  const results = searchPlanHistory(projectPath, req.params.planSlug, query, { since, until, limit });
  res.json({ total: results.length, results });
});

app.get('/api/conflicts', (req, res) => {
  const { detectManifestConflicts } = _lazy___services_plan_conflict_service;
  const projectPath = requireProjectRoot(req, res);
  if (!projectPath) return;
  res.json(detectManifestConflicts(projectPath));
});

app.post('/api/conflicts/resolve', (req, res) => {
  const { resolveFileConflict, resolveFileConflictBySide } = _lazy___services_plan_conflict_service;
  const { projectPath: rawProjectPath, filePath, mode, side, resolutions } = req.body;
  const projectPath = confineRoot(rawProjectPath, res, 'projectPath');
  if (!projectPath) return;
  if (!projectPath || !filePath || !mode) {
    res.status(400).json({ error: 'projectPath, filePath, and mode required' });
    return;
  }
  // Both service entry points confine `filePath` and throw on a
  // violation. Without this catch that surfaces as a 500, which reads
  // as a server fault rather than a refusal — and Phase 29 §4.9 gives
  // this endpoint a UI, so the status is now something a user sees.
  try {
    if (mode === 'by_side') {
      res.json(resolveFileConflictBySide(projectPath, filePath, side));
    } else {
      res.json(resolveFileConflict(projectPath, filePath, resolutions ?? []));
    }
  } catch (err) {
    res.status(err instanceof ConfinementError ? 403 : 400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.get('/api/freeze', (req, res) => {
  const { getFreezeStatus } = _lazy___services_freeze_service;
  const projectPath = requireProjectRoot(req, res);
  if (!projectPath) return;
  res.json(getFreezeStatus(projectPath));
});

app.put('/api/freeze', (req, res) => {
  const { setFreeze } = _lazy___services_freeze_service;
  const { projectPath: rawProjectPath, active, reason, until, allowedPlanUids } = req.body;
  const projectPath = confineRoot(rawProjectPath, res, 'projectPath');
  if (!projectPath) return;
  if (!projectPath || active === undefined) {
    res.status(400).json({ error: 'projectPath and active required' });
    return;
  }
  const status = setFreeze(projectPath, { active, reason, until, allowedPlanUids });
  broadcast('freeze-changed', { projectRoot: projectPath, status });
  res.json(status);
});

// --- CDev Phase 8 — Audio capture REST surface ---

app.post('/api/audio/start', (_req, res) => {
  const { audioBuffer } = _lazy___services_audio_buffer_service;
  const maxSeconds = (_req.body as any)?.maxBufferSeconds;
  audioBuffer.startCapture(maxSeconds);
  res.json(audioBuffer.getStatus());
});

app.post('/api/audio/stop', (_req, res) => {
  const { audioBuffer } = _lazy___services_audio_buffer_service;
  audioBuffer.stopCapture();
  res.json(audioBuffer.getStatus());
});

app.get('/api/audio/status', (_req, res) => {
  const { audioBuffer } = _lazy___services_audio_buffer_service;
  res.json(audioBuffer.getStatus());
});

app.post('/api/audio/chunk', (req, res) => {
  const { audioBuffer } = _lazy___services_audio_buffer_service;
  const { audioBase64, durationMs } = req.body as { audioBase64?: string; durationMs?: number };

  if (!audioBase64 || !durationMs) {
    res.status(400).json({ error: 'audioBase64 and durationMs required' });
    return;
  }

  if (!audioBuffer.isCapturing()) {
    res.status(409).json({ error: 'Audio capture is not active' });
    return;
  }

  const data = Buffer.from(audioBase64, 'base64');
  audioBuffer.addChunk(data, durationMs);
  res.json({ accepted: true, bufferedSeconds: audioBuffer.getStatus().bufferedSeconds });
});

app.get('/api/audio/recent', (req, res) => {
  const { audioBuffer } = _lazy___services_audio_buffer_service;
  const seconds = req.query.seconds ? Number(req.query.seconds) : undefined;
  const snapshot = audioBuffer.getRecentAudio(seconds);

  if (!snapshot) {
    res.status(404).json({ error: 'No audio available' });
    return;
  }

  res.json(snapshot);
});

// --- CDev Phase 9 — Peer discovery and pairing REST surface ---
// All endpoints localhost-only (Express binds 127.0.0.1).

app.get('/api/peers/status', (_req, res) => {
  try {
    // peer-connection-service is statically imported as `peerService` at top of file
    res.json(peerService.getPeerManagerStatus());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/peers/discovered', (_req, res) => {
  try {
    // peer-connection-service is statically imported as `peerService` at top of file
    res.json(peerService.getDiscoveredDevices());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/peers/devices', (_req, res) => {
  try {
    // peer-connection-service is statically imported as `peerService` at top of file
    res.json(peerService.getDevices());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/peers/connections', (_req, res) => {
  try {
    // peer-connection-service is statically imported as `peerService` at top of file
    res.json(peerService.getConnections());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// v4 pairing: desktop opens a temp HTTP server, QR points phone to it.
// The SDP exchange happens on the temp server — these routes just
// coordinate the frontend UI.

// Step 1: Initiate pairing — opens temp server, returns QR payload.
// The frontend shows the QR and polls /api/pairing/status for updates.
app.post('/api/pairing/initiate', async (_req, res) => {
  try {
    const { qrPayload, waitForAnswer } = await peerService.startPairing();

    // Fire-and-forget: wait for the phone's answer in the background.
    // The frontend polls /api/pairing/status to know when the answer
    // arrives and the confirmation code is ready.
    waitForAnswer().catch((err) => {
      console.warn('[Pairing] Answer wait failed:', err);
    });

    res.json({ qrPayload });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Poll: check pairing progress.
//
// Reports only WHETHER the phone has answered, never the confirmation code
// itself (Phase 19, finding 1.2). The renderer already discarded the code it
// was sent — the user has to read it off the phone and type it — so sending
// it served no purpose and put the value the comparison depends on onto a
// second surface.
app.get('/api/pairing/status', (_req, res) => {
  try {
    res.json({
      active: peerService.isPairingActive(),
      codeReady: peerService.getPairingConfirmCode() !== null,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Step 2: User confirms the codes match — stores paired device.
app.post('/api/pairing/confirm', (req, res) => {
  try {
    const { code, alias, deviceType } = req.body;
    if (!code || !alias) {
      res.status(400).json({ error: 'Missing code or alias' });
      return;
    }
    const result = peerService.completePairing(
      code,
      alias,
      deviceType ?? 'mobile',
    );
    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }
    // Redacted like every other device response (Phase 19, finding 15): the
    // record `completePairing` returns carries the freshly-minted reconnect
    // secret, and the renderer has no use for it.
    res.json({ success: true, device: peerService.getDevice(result.device!.fingerprint) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/pairing/cancel', (_req, res) => {
  try {
    peerService.cancelActivePairing();
    res.json({ cancelled: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.delete('/api/peers/devices/:fingerprint', async (req, res) => {
  try {
    // peer-connection-service is statically imported as `peerService` at top of file
    const removed = await peerService.unpairDevice(req.params.fingerprint);
    res.json({ removed });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.patch('/api/peers/devices/:fingerprint', (req, res) => {
  try {
    // peer-connection-service is statically imported as `peerService` at top of file
    const { alias, capabilities } = req.body as { alias?: string; capabilities?: string[] };

    if (!alias && !Array.isArray(capabilities)) {
      res.status(400).json({ error: 'alias or capabilities required' });
      return;
    }

    const out: { renamed?: boolean; capabilities?: string[] } = {};
    if (alias) out.renamed = peerService.renameDevice(req.params.fingerprint, alias);

    // Phase 19, finding 15 — granting `terminal` grants command execution and
    // the ability to read command output off this machine. It is a per-device
    // decision the user makes here, deliberately, after pairing.
    if (Array.isArray(capabilities)) {
      const applied = setDeviceCapabilities(req.params.fingerprint, capabilities);
      if (applied === null) { res.status(404).json({ error: 'device not found' }); return; }
      out.capabilities = applied;
    }

    res.json(out);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/**
 * What paired devices actually did (Phase 19, finding 15).
 *
 * Refusals, terminal access, and every change to what a device is allowed to
 * do. Never the terminal output itself — see `peer-audit-service`.
 */
app.get('/api/peers/audit', (req, res) => {
  try {
    const fingerprint = typeof req.query.fingerprint === 'string' ? req.query.fingerprint : undefined;
    const limit = Number(req.query.limit) || undefined;
    res.json({ entries: listPeerAudit({ fingerprint, limit }) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// --- CDev Phase 11 — Mobile reconnection REST surface ---
// Mobile reconnect endpoints have moved to the dedicated mobile API
// server (`mobile-api-server.ts`), which binds to 0.0.0.0 on a
// configurable port (default 19480). This keeps the main Express
// server on localhost and avoids dev port conflicts.

// --- CDev Phase 10 — Multi-device REST surface ---

app.get('/api/peers/remote-state', (_req, res) => {
  try {
    // peer-connection-service is statically imported as `peerService` at top of file
    const allStates = peerService.getAllRemoteStates();
    const result: Record<string, unknown> = {};
    for (const [fp, state] of allStates) {
      result[fp] = state;
    }
    res.json({ peerCount: allStates.size, states: result });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/peers/remote-state/:fingerprint', (req, res) => {
  try {
    // peer-connection-service is statically imported as `peerService` at top of file
    const state = peerService.getRemoteState(req.params.fingerprint);
    if (!state) { res.status(404).json({ error: 'No state from this peer' }); return; }
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/peers/remote-terminals', (req, res) => {
  try {
    // peer-connection-service is statically imported as `peerService` at top of file
    const fingerprint = req.query.fingerprint as string | undefined;
    const terminals = fingerprint
      ? peerService.getRemoteTerminalsForPeer(fingerprint)
      : peerService.getRemoteTerminals();
    res.json({ count: terminals.length, terminals });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/peers/remote-terminals/:fingerprint/:terminalId/write', (req, res) => {
  try {
    // peer-connection-service is statically imported as `peerService` at top of file
    const { data } = req.body as { data?: string };
    if (!data) { res.status(400).json({ error: 'data required' }); return; }
    const sent = peerService.writeRemoteTerminal(req.params.fingerprint, req.params.terminalId, data);
    res.json({ sent });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/peers/remote-audio', (_req, res) => {
  try {
    // peer-connection-service is statically imported as `peerService` at top of file
    const statuses = peerService.getRemoteAudioStatuses();
    res.json({ count: statuses.length, peers: statuses });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/peers/remote-input-requests', (_req, res) => {
  try {
    // peer-connection-service is statically imported as `peerService` at top of file
    const requests = peerService.getPendingInputRequests();
    res.json({ count: requests.length, requests });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/peers/remote-input-requests/:requestId/respond', (req, res) => {
  try {
    // peer-connection-service is statically imported as `peerService` at top of file
    const { response } = req.body as { response?: string };
    if (!response) { res.status(400).json({ error: 'response required' }); return; }
    const sent = peerService.respondToInputRequest(req.params.requestId, response);
    res.json({ sent });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// --- CDev Phase 11 — Push notifications REST surface ---

app.get('/api/peers/push-tokens', (_req, res) => {
  try {
    // peer-connection-service is statically imported as `peerService` at top of file
    const tokens = peerService.listPushTokens();
    res.json({ count: tokens.length, tokens });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/peers/push-tokens', (req, res) => {
  try {
    // peer-connection-service is statically imported as `peerService` at top of file
    const { fingerprint, token } = req.body as { fingerprint?: string; token?: string };
    if (!fingerprint || !token) {
      res.status(400).json({ error: 'fingerprint and token required' });
      return;
    }
    peerService.registerPushToken(fingerprint, token);
    res.json({ registered: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.delete('/api/peers/push-tokens/:fingerprint', (req, res) => {
  try {
    // peer-connection-service is statically imported as `peerService` at top of file
    peerService.unregisterPushToken(req.params.fingerprint);
    res.json({ unregistered: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// --- CDev Phase 7 — External contributors REST surface ---

app.get('/api/pantry/resolve', (req, res) => {
  const { resolveReferences, scanPlanReferences } = _lazy___services_pantry_resolution_service;
  const projectPath = requireProjectRoot(req, res);
  if (!projectPath) return;
  const refs = req.query.refs as string | string[] | undefined;
  const planSlug = req.query.plan_slug as string | undefined;

  if (refs) {
    const refArray = Array.isArray(refs) ? refs : [refs];
    const results = resolveReferences(refArray, projectPath);
    res.json({ total: results.length, results });
  } else if (planSlug) {
    res.json(scanPlanReferences(projectPath, planSlug));
  } else {
    res.status(400).json({ error: 'Provide refs[] or plan_slug query param' });
  }
});

app.get('/api/contributions', (req, res) => {
  const { listContributions, listContributionsForBranch } = _lazy___services_contribution_service;
  const projectPath = requireProjectRoot(req, res);
  if (!projectPath) return;
  const branch = req.query.branch as string | undefined;
  res.json(branch ? listContributionsForBranch(projectPath, branch) : listContributions(projectPath));
});

app.post('/api/contributions/promote', (req, res) => {
  const { promoteItemToContribution } = _lazy___services_contribution_service;
  const { projectPath: rawProjectPath, itemUid, title, kind, status, body, description, attachments } = req.body;
  const projectPath = confineRoot(rawProjectPath, res, 'projectPath');
  if (!projectPath) return;
  if (!projectPath || !itemUid || !title || !kind) {
    res.status(400).json({ error: 'projectPath, itemUid, title, kind required' });
    return;
  }
  try {
    const result = promoteItemToContribution(projectPath, { uid: itemUid, title, kind, status, body, description, attachments });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/contributions/accept', (req, res) => {
  const { acceptContributions } = _lazy___services_contribution_service;
  const { projectPath: rawProjectPath, branch, planSlug } = req.body;
  const projectPath = confineRoot(rawProjectPath, res, 'projectPath');
  if (!projectPath) return;
  if (!projectPath || !branch || !planSlug) {
    res.status(400).json({ error: 'projectPath, branch, planSlug required' });
    return;
  }
  try {
    const result = acceptContributions(projectPath, branch, planSlug);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/contributor-branch', (req, res) => {
  const { prepareContributorBranch } = _lazy___services_contribution_service;
  const { projectPath: rawProjectPath, planSlug, branchName, includeItems } = req.body;
  const projectPath = confineRoot(rawProjectPath, res, 'projectPath');
  if (!projectPath) return;
  if (!projectPath || !planSlug || !branchName) {
    res.status(400).json({ error: 'projectPath, planSlug, branchName required' });
    return;
  }
  try {
    const result = prepareContributorBranch(projectPath, planSlug, branchName, { includeItems });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// --- CDev Phase 3.4 — System documentation REST surface ---
//
// Frontend reads / writes system docs via these. The MCP tools cover
// the same surface for agents; both pipe through the same service.

app.get('/api/system-docs', (req, res) => {
  const svc = _lazy___services_system_docs_service;
  const projectPath = requireProjectRoot(req, res);
  if (!projectPath) return;
  const search = req.query.search as string | undefined;
  res.json(search ? svc.searchSystemDocs(projectPath, search) : svc.listSystemDocs(projectPath));
});

app.get('/api/system-docs/:uid', (req, res) => {
  const svc = _lazy___services_system_docs_service;
  const doc = svc.getSystemDoc(req.params.uid);
  if (!doc) { res.status(404).json({ error: 'not found' }); return; }
  res.json(doc);
});

app.post('/api/system-docs', (req, res) => {
  const svc = _lazy___services_system_docs_service;
  const { projectPath: rawProjectPath, title, body, owner, tags, references, slug } = req.body || {};
  const projectPath = confineRoot(rawProjectPath, res, 'projectPath');
  if (!projectPath) return;
  if (!projectPath || !title) {
    res.status(400).json({ error: 'projectPath and title are required' });
    return;
  }
  try {
    const identity = getSettings().identity;
    const author = identity.email || identity.displayName || 'human';
    const doc = svc.createSystemDoc({
      projectPath, title, body, owner, tags, references, slug,
      author, authorType: 'human',
    });
    broadcast('system-doc-created', { uid: doc.uid, projectPath: doc.projectPath });
    saveNow(() => exportDatabase());
    res.json(doc);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.put('/api/system-docs/:uid', (req, res) => {
  const svc = _lazy___services_system_docs_service;
  try {
    const updated = svc.updateSystemDoc(req.params.uid, req.body || {});
    if (!updated) { res.status(404).json({ error: 'not found' }); return; }
    broadcast('system-doc-updated', { uid: updated.uid, projectPath: updated.projectPath });
    saveNow(() => exportDatabase());
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.delete('/api/system-docs/:uid', (req, res) => {
  const svc = _lazy___services_system_docs_service;
  const ok = svc.deleteSystemDoc(req.params.uid);
  if (ok) {
    broadcast('system-doc-removed', { uid: req.params.uid });
    saveNow(() => exportDatabase());
  }
  res.json({ ok, uid: req.params.uid });
});

app.post('/api/system-docs/:uid/verify', (req, res) => {
  const svc = _lazy___services_system_docs_service;
  const updated = svc.verifySystemDoc(req.params.uid);
  if (!updated) { res.status(404).json({ error: 'not found' }); return; }
  broadcast('system-doc-verified', { uid: updated.uid, capturedAgainstCommit: updated.capturedAgainstCommit });
  saveNow(() => exportDatabase());
  res.json(updated);
});

app.get('/api/system-docs/:uid/freshness', (req, res) => {
  const svc = _lazy___services_system_docs_service;
  const report = svc.getFreshness(req.params.uid);
  if (!report) { res.status(404).json({ error: 'not found' }); return; }
  res.json(report);
});

// --- Sensor endpoints (Phase 4.3) ---

/**
 * Git-hook trigger: check all system docs for staleness and post
 * channel events for any that have gone stale. Called from an optional
 * post-merge / post-commit hook via `curl`.
 *
 * Query: `?project=<absolute-path>`.
 */
app.get('/api/sensors/doc-check', (req, res) => {
  try {
    const project = optionalProjectRoot(req, res);
    if (project === null) return;
    if (!project) return res.status(400).json({ error: 'project query parameter is required' });
    const { checkAllDocsAndBridge } = _lazy___services_sensor_bridge_service;
    const result = checkAllDocsAndBridge(project);
    return res.json(result);
  } catch (err) {
    console.error('[Backend] /api/sensors/doc-check error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Global error handler (must be after all routes) ---
// The 4-argument signature tells Express this is an error handler.
// Catches synchronous throws in route handlers that slip past local
// try/catch blocks.  Without this, unhandled errors crash the process.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Backend] Unhandled route error:', err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Server lifecycle ---

const DEFAULT_PORT = 3001;
const MAX_PORT_ATTEMPTS = 10;

let boundBackendPort: number = DEFAULT_PORT;

export function getBoundBackendPort(): number {
  return boundBackendPort;
}

/**
 * Initialise the backend's in-process state — database, AST parser,
 * autosave, MCP server, update polling. **Does not** open a TCP
 * port; that's `startServer()`'s job. Electron's main process calls
 * this directly so the desktop build never binds a backend port:
 * the renderer reaches the Express app via IPC instead. Web mode
 * (`npm run dev:backend`) goes through `startServer()` → calls this
 * + listens on TCP.
 */
/**
 * Re-arm per-project watchers (project-config + plan-file) for
 * recently-opened projects that still exist on disk and already have
 * a `.codetrellis/` directory. Called at backend boot so a restart
 * doesn't orphan the watchers an open project relies on.
 *
 * Bounded to pinned projects + the 5 most recently-opened unpinned
 * ones — a developer with a long history of opened projects
 * shouldn't spawn watchers for all of them.
 */
function rearmProjectWatchers(): void {
  const { listRecentProjects } = _lazy___services_recent_projects_service;
  const { startProjectConfigWatcher } = _lazy___services_project_config_service;
  const { startPointerWatcher } = _lazy___services_external_pointer_service;

  const recents = listRecentProjects() as Array<{ path: string; pinned: boolean }>;
  const pinned = recents.filter((p) => p.pinned);
  const unpinned = recents.filter((p) => !p.pinned).slice(0, 5);
  const candidates = [...pinned, ...unpinned];

  let armed = 0;
  for (const proj of candidates) {
    try {
      if (!fs.existsSync(proj.path)) continue;
      if (!fs.existsSync(path.join(proj.path, '.codetrellis'))) continue;
      startProjectConfigWatcher(proj.path);
      try {
        startPlanFileWatcher(proj.path);
      } catch {
        // plan-file watcher may need a project scan to be useful;
        // best-effort.
      }
      try {
        startPointerWatcher(proj.path);
      } catch {
        // best-effort — pointers are only useful for cross-repo plans
      }
      try {
        const { indexProjectDocs, startSystemDocsWatcher } = _lazy___services_system_docs_service;
        indexProjectDocs(proj.path);
        startSystemDocsWatcher(proj.path);
      } catch {
        // best-effort — docs are only present for projects that have adopted them
      }
      armed++;
    } catch (err) {
      console.warn(`[Backend] Failed to re-arm watchers for ${proj.path}:`, err);
    }
  }
  if (armed > 0) {
    console.log(`[Backend] Re-armed watchers for ${armed} recent project(s).`);
  }
}

export async function initializeBackend(): Promise<void> {
  // FIRST, before anything binds a port or serves a byte. Every local
  // transport checks this token, so a surface that came up before it existed
  // would be briefly unauthenticated.
  initCapabilityToken();
  console.log(`[Auth] Capability token ready — ${getTokenFilePath()}`);

  await initDatabase();
  await initParser();

  // Start persistent auto-save for plan data
  startAutoSave(() => exportDatabase(), 30000);

  // Periodic session sweep — keeps ConnectedAgents accurate even when
  // the frontend isn't polling (backgrounded tab, no onboarding-state
  // hits). Without this, ghost sessions accumulate across SSE
  // reconnect churn and the widget over-counts.
  try {
    sessionService.startSessionSweep();
    // Phase 23 — flush turns that have gone quiet and warn on budgets
    // that have crossed their threshold. Unflushed time is time never
    // recorded, which would make every plan look cheaper than it was.
    budgetService.startBudgetSweep();
  } catch (err) {
    console.warn('[Backend] Session sweep failed to start:', err);
  }

  // CDev Phase 2.3 — channel notification dispatcher. Runs a periodic
  // stale-event sweep for minAgeMs rules; post-time dispatch is called
  // directly from the MCP / REST handlers that create channel events.
  try {
    const { startChannelDispatcher } = _lazy___services_channel_dispatcher_service;
    startChannelDispatcher(broadcast);
  } catch (err) {
    console.warn('[Backend] Channel dispatcher failed to start:', err);
  }

  // Phase 4.2 — sensor bridge: converts detection events (deviations,
  // doc staleness, stuck) into channel events. Needs the broadcast fn.
  try {
    const { initSensorBridge } = _lazy___services_sensor_bridge_service;
    initSensorBridge(broadcast);
  } catch (err) {
    console.warn('[Backend] Sensor bridge failed to init:', err);
  }

  // Session-persistence plan / Track A — start the power state machine
  // + signal sources. Idempotent — Electron main also calls
  // startPowerService() from `wirePowerControl()`; the second call is
  // a no-op. In web mode this is the only place it boots; UI consumes
  // status via the `/api/power/status` poll path (no `power-status`
  // broadcast — no client subscribes to it).
  try {
    const { startPowerService } = await import('./services/power-service');
    const { startPowerSignals } = await import('./services/power-signals');
    startPowerService();
    startPowerSignals();
  } catch (err) {
    console.warn('[Backend] Power service failed to start:', err);
  }

  // Session-persistence plan / 11.3 — terminal history housekeeping.
  // Reports current on-disk usage and prunes oldest files if the
  // global cap is exceeded. Cheap, best-effort, runs once per boot.
  try {
    const { initTerminalHistory } = await import('./services/terminal-history-service');
    initTerminalHistory();
  } catch (err) {
    console.warn('[Backend] Terminal history init failed:', err);
  }

  // Re-arm per-project watchers for known projects. Without this, a
  // backend restart (dev: tsx watch reload; packaged: app restart)
  // orphans any pre-existing project-config + plan-file watchers, and
  // external file edits silently stop triggering hot-reload until the
  // user re-opens the project. Bounded — only walks pinned projects +
  // the 5 most-recently-opened unpinned ones, and only those whose
  // .codetrellis/ directory still exists (so we don't create the
  // directory in random projects).
  try {
    rearmProjectWatchers();
  } catch (err) {
    console.warn('[Backend] Project watcher re-arm failed:', err);
  }

  // Restore the active project on boot. The frontend restores the project
  // VIEW from the persisted DB but never re-scans, so the backend's
  // `lastScannedProject` stayed null after a restart — making
  // getActiveProjectPath() (and thus the mobile snapshot / RPC) report
  // "No project scanned" even though a project is clearly open. Point it at
  // the most-recently-opened project that still exists on disk.
  try {
    if (!lastScannedProject) {
      const recent = [...listRecentProjects()].sort(
        (a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0),
      );
      const restore = recent.find((p) => p.path && fs.existsSync(p.path));
      if (restore) {
        lastScannedProject = restore.path;
        setActiveProjectRoot(restore.path);
        console.log(`[Backend] Restored active project: ${restore.path}`);
      }
    }
  } catch (err) {
    console.warn('[Backend] Active-project restore failed:', err);
  }

  // Start MCP server for agent integration. The MCP server keeps
  // its own TCP port (default 19432) because external agents need
  // a stable URL to put in their MCP config — that's the only
  // backend-process port intentionally exposed.
  try {
    await startMcpServer();
  } catch (err) {
    console.warn('[Backend] MCP server failed to start:', err);
  }

  // Start the auto-update poller — best-effort initial check on
  // boot, then once every 24h. Network failures don't abort boot;
  // they're surfaced via `getUpdateState().lastError`. Wrapped in
  // try/catch as belt-and-braces: even if the service module load
  // fails (e.g. a bundler edge in packaged Electron), the rest of
  // the backend boot keeps going. Updates can be checked manually
  // later via Settings → Updates → Check for Updates.
  try {
    startUpdatePolling();
  } catch (err) {
    console.warn('[Backend] Update polling failed to start:', err);
  }

  // CDev Phase 9 — peer connection manager. Starts mDNS discovery
  // and prepares for QR-based WebRTC pairing. Best-effort: if mDNS
  // fails (e.g. port 5353 in use), the rest of the app is unaffected.
  try {
    peerService.startPeerManager();
  } catch (err) {
    console.warn('[Backend] Peer connection manager failed to start:', err);
  }
}

/**
 * Boot the backend AND open a TCP port. Used by web mode
 * (`npm run dev:backend`) where the browser fetches `/api/...` over
 * HTTP. Honours `CODETRELLIS_BACKEND_PORT` env var and walks
 * forward on `EADDRINUSE` (up to 10 slots). The actually-bound
 * port is returned via `getBoundBackendPort()`.
 *
 * Electron also calls this (after `initializeBackend()`) to expose
 * pairing and peer endpoints over LAN for the mobile companion.
 * Pass `host='0.0.0.0'` from Electron to bind to all interfaces.
 */
export async function startServer(port?: number, host?: string, skipInit = false): Promise<http.Server> {
  if (!skipInit) await initializeBackend();

  const envPort = process.env.CODETRELLIS_BACKEND_PORT;
  const requestedPort = envPort ? Number(envPort) : (port ?? DEFAULT_PORT);
  const bindHost = host ?? '127.0.0.1';

  return new Promise<http.Server>((resolve, reject) => {
    const tryPort = (candidate: number, attemptsLeft: number) => {
      const onListening = () => {
        server.removeListener('error', onError);
        // Read the actually-bound port from the kernel. Matters for
        // `port=0` (OS-assigned) where `candidate` is just `0` and
        // the real port comes back from `server.address()`. Also
        // serves as a sanity check for the autodetect path.
        const addr = server.address();
        if (addr && typeof addr === 'object' && typeof addr.port === 'number') {
          boundBackendPort = addr.port;
        } else {
          boundBackendPort = candidate;
        }
        const note =
          candidate === 0
            ? ' (OS-assigned)'
            : candidate !== requestedPort
              ? ` (requested ${requestedPort}, autodetected)`
              : '';
        console.log(`[Backend] Server running on http://${bindHost === '0.0.0.0' ? '0.0.0.0' : 'localhost'}:${boundBackendPort}${note}`);
        resolve(server);
      };
      const onError = (err: NodeJS.ErrnoException) => {
        server.removeListener('listening', onListening);
        if (err.code === 'EADDRINUSE' && attemptsLeft > 0 && !envPort) {
          console.warn(`[Backend] Port ${candidate} in use; trying ${candidate + 1}…`);
          tryPort(candidate + 1, attemptsLeft - 1);
        } else {
          reject(err);
        }
      };
      server.once('listening', onListening);
      server.once('error', onError);
      // Default: bind to loopback only so the server is not exposed
      // to the LAN. Electron passes host='0.0.0.0' to also serve
      // mobile companion pairing over the local network.
      //
      // Wrap in try/catch: some Node versions (observed on 25.x)
      // throw synchronously from inside `listen()` for EADDRINUSE
      // rather than emitting an `error` event, which leaks past
      // our once-listener as an uncaughtException. Funnel the
      // sync throw through the same retry path.
      try {
        server.listen(candidate, bindHost);
      } catch (err) {
        server.removeListener('listening', onListening);
        server.removeListener('error', onError);
        onError(err as NodeJS.ErrnoException);
      }
    };
    tryPort(requestedPort, MAX_PORT_ATTEMPTS);
  });
}

export { app, server };

// Note: web-mode entry lives in `src/backend/index.ts` and imports
// `startServer` explicitly. We intentionally don't auto-start on
// require here — Vite bundles this file alongside `main.ts` for the
// Electron build, and the `require.main === module` check evaluated
// as true in the bundled context, causing a second startServer()
// call → ERR_SERVER_ALREADY_LISTEN.

type GitCommitSummary = {
  commitHash: string;
  shortCommitHash: string;
  subject: string;
  committedAt: string;
};

type GitCommitSnapshotResult = {
  snapshot: ReturnType<typeof captureSnapshot>;
  commitHash: string;
  shortCommitHash: string;
};

function getRecentGitCommits(projectPath: string, limit = 20): GitCommitSummary[] {
  try {
    const output = execFileSync(
      'git',
      ['-C', projectPath, 'log', `--max-count=${limit}`, '--date=short', '--pretty=format:%H%x09%h%x09%cs%x09%s'],
      { encoding: 'utf8' },
    );

    return output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [commitHash, shortCommitHash, committedAt, ...subjectParts] = line.split('\t');
        return {
          commitHash,
          shortCommitHash,
          committedAt,
          subject: subjectParts.join('\t') || shortCommitHash,
        };
      });
  } catch {
    return [];
  }
}

async function captureGitCommitSnapshot(projectPath: string, commitHash: string): Promise<GitCommitSnapshotResult | null> {
  try {
    const commitMeta = execFileSync(
      'git',
      ['-C', projectPath, 'show', '-s', '--format=%H\t%h', commitHash],
      { encoding: 'utf8' },
    ).trim();

    if (!commitMeta) return null;

    const [resolvedCommitHash, shortCommitHash] = commitMeta.split('\t');
    const fileListOutput = execFileSync(
      'git',
      ['-C', projectPath, 'ls-tree', '-r', '--name-only', resolvedCommitHash],
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
    );

    const relativePaths = fileListOutput
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const parsedFiles = relativePaths
      .map((relativePath) => {
        const absolutePath = path.join(projectPath, relativePath);
        try {
          const content = execFileSync(
            'git',
            ['-C', projectPath, 'show', `${resolvedCommitHash}:${relativePath}`],
            { encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 },
          );
          return parseVirtualFile(absolutePath, content);
        } catch {
          return null;
        }
      })
      .filter((file): file is NonNullable<typeof file> => Boolean(file));

    const parsedByRelativePath = new Map(
      parsedFiles.map((file) => [path.relative(projectPath, file.path), file]),
    );

    const depEdges = parsedFiles.flatMap((file) => {
      const sourceRelative = path.relative(projectPath, file.path);
      return file.imports
        .map((imp) => resolveImportInSnapshot(sourceRelative, imp.source, parsedByRelativePath))
        .filter((targetRelative): targetRelative is string => Boolean(targetRelative))
        .map((targetRelative) => ({
          sourceRelative,
          targetRelative,
        }));
    });

    const fileData = parsedFiles.map((file) => ({
      path: path.relative(projectPath, file.path),
      hash: file.contentHash,
      symbolCount: file.symbols.length,
    }));

    return {
      snapshot: captureSnapshot(fileData, depEdges),
      commitHash: resolvedCommitHash,
      shortCommitHash: shortCommitHash || resolvedCommitHash.slice(0, 7),
    };
  } catch {
    return null;
  }
}

function resolveImportInSnapshot(
  sourceRelativePath: string,
  importSource: string,
  parsedByRelativePath: Map<string, { path: string }>,
): string | null {
  if (!importSource.startsWith('.')) return null;

  const sourceDir = path.posix.dirname(sourceRelativePath.replace(/\\/g, '/'));
  const normalizedImport = importSource.replace(/\\/g, '/');
  const basePath = path.posix.normalize(path.posix.join(sourceDir, normalizedImport));
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    `${basePath}.mjs`,
    `${basePath}.cjs`,
    `${basePath}.py`,
    `${basePath}.rs`,
    `${basePath}.java`,
    `${basePath}.php`,
    `${basePath}/index.ts`,
    `${basePath}/index.tsx`,
    `${basePath}/index.js`,
    `${basePath}/index.jsx`,
  ];

  for (const candidate of candidates) {
    if (parsedByRelativePath.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function getGitWorkingTreeStatus(projectPath: string): {
  staged: string[];
  unstaged: string[];
  untracked: string[];
  stagedAdded: string[];
  stagedModified: string[];
  stagedDeleted: string[];
  unstagedModified: string[];
  unstagedDeleted: string[];
  commitHash: string | null;
  shortCommitHash: string | null;
} | null {
  try {
    // SCOPED to the project, and reported relative to it.
    //
    // `git status` answers for the whole REPOSITORY and prints paths
    // relative to the repository root, whatever directory you run it in.
    // When the opened project is a subdirectory of a larger repo — a
    // package in a monorepo, or this repo's own test fixture — that meant
    // two things went wrong at once: files from outside the project
    // appeared in the explorer, and their paths were repo-relative while
    // everything downstream treats them as project-relative. Clicking one
    // asked for `<project>/<repo-relative-path>`, which does not exist,
    // and the reader said "Failed to load source: File not found".
    //
    // `-- .` limits the answer to this subtree; `--show-prefix` gives the
    // project's own path within the repo so it can be stripped back off.
    let prefix = '';
    try {
      prefix = execFileSync('git', ['-C', projectPath, 'rev-parse', '--show-prefix'], {
        encoding: 'utf8',
      }).trim();
    } catch {
      // Not a repo, or an old git: fall through with no prefix. The
      // pathspec below still scopes the listing.
    }

    const output = execFileSync(
      'git',
      ['-C', projectPath, 'status', '--porcelain=v1', '--untracked-files=all', '--', '.'],
      { encoding: 'utf8' },
    );

    /** Repo-relative → project-relative. Null when it is outside the project. */
    const toProjectRelative = (p: string): string | null => {
      if (!prefix) return p;
      if (!p.startsWith(prefix)) return null;
      return p.slice(prefix.length);
    };

    const staged = new Set<string>();
    const unstaged = new Set<string>();
    const untracked = new Set<string>();
    const stagedAdded = new Set<string>();
    const stagedModified = new Set<string>();
    const stagedDeleted = new Set<string>();
    const unstagedModified = new Set<string>();
    const unstagedDeleted = new Set<string>();

    for (const line of output.split('\n')) {
      if (!line.trim()) continue;

      const x = line[0];
      const y = line[1];
      const rawPath = line.slice(3).trim();
      const repoPath = rawPath.includes('->') ? rawPath.split('->').pop()?.trim() || rawPath : rawPath;
      // A rename can point out of the subtree even with the pathspec, so
      // the membership check is not redundant.
      const filePath = toProjectRelative(repoPath);
      if (filePath === null) continue;

      if (x === '?' && y === '?') {
        untracked.add(filePath);
        continue;
      }

      if (x !== ' ') {
        staged.add(filePath);
        if (x === 'A' || x === 'C') stagedAdded.add(filePath);
        else if (x === 'D') stagedDeleted.add(filePath);
        else stagedModified.add(filePath);
      }

      if (y !== ' ') {
        unstaged.add(filePath);
        if (y === 'D') unstagedDeleted.add(filePath);
        else unstagedModified.add(filePath);
      }
    }

    const head = getGitHeadCommit(projectPath);

    return {
      staged: [...staged],
      unstaged: [...unstaged],
      untracked: [...untracked],
      stagedAdded: [...stagedAdded],
      stagedModified: [...stagedModified],
      stagedDeleted: [...stagedDeleted],
      unstagedModified: [...unstagedModified],
      unstagedDeleted: [...unstagedDeleted],
      commitHash: head?.commitHash || null,
      shortCommitHash: head?.shortCommitHash || null,
    };
  } catch {
    return null;
  }
}

function getGitBranchName(projectPath: string): string | null {
  try {
    const headPath = path.join(projectPath, '.git', 'HEAD');
    if (!fs.existsSync(headPath)) return null;
    const head = fs.readFileSync(headPath, 'utf-8').trim();
    const match = head.match(/^ref: refs\/heads\/(.+)$/);
    return match ? match[1] : 'detached';
  } catch {
    return null;
  }
}

function getGitHeadCommit(projectPath: string): { commitHash: string | null; shortCommitHash: string | null } | null {
  try {
    const commitHash = execFileSync(
      'git',
      ['-C', projectPath, 'rev-parse', 'HEAD'],
      { encoding: 'utf8' },
    ).trim();

    if (!commitHash) {
      return { commitHash: null, shortCommitHash: null };
    }

    return {
      commitHash,
      shortCommitHash: commitHash.slice(0, 7),
    };
  } catch {
    return { commitHash: null, shortCommitHash: null };
  }
}
