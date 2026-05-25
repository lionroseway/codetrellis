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
import { initDatabase, storeParsedFile, searchSymbols, getFileSymbols, getDbStats, getArchitectureSummary, resolveImports, getDependencyEdges, getFileDependencies, clearAstData, getAllFileHashes, removeStaleFiles } from './services/database';
import { startWatching } from './services/file-watcher';
import { startClaudeCodeWatcher, getWatcherStatus } from './agent/claude-code-watcher';
import { captureSnapshot, setBaseline, computeDiff, getBaseline } from './services/diff-engine';
import { startMcpServer, getMcpStatus, getMcpConfig } from './mcp/server';
import { startAutoSave, saveNow } from './services/persistence';
import { exportDatabase } from './services/database';
import * as planService from './services/plan-service';
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
// `require('./services/...')` paths, so they fail at runtime
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
import * as planImportService from './services/plan-import-service';
import { tailLog, getCurrentLogPath, getLogDir } from './services/logger';
import {
  getUpdateState,
  checkForUpdate,
  startUpdatePolling,
} from './services/update-service';
import { BUILD_INFO } from '../shared/build-info';

const app = express();
app.use(express.json());

/**
 * CORS for the packaged Electron renderer. The renderer loads from
 * `file://`, which browsers report as `Origin: null` for CORS. We
 * allow it through (alongside any `http://localhost:*` origin from
 * the Vite dev server) so the renderer can hit the backend at
 * 127.0.0.1:<port>. The server is bound to 127.0.0.1 only — no
 * untrusted host on the network can reach it.
 */
app.use((req, res, next) => {
  const origin = req.headers.origin;
  // file:// → "null", localhost dev → "http://localhost:5173" etc.
  // Mirror whatever was sent so credentialed requests work; we
  // already gate access at the bind level (loopback only).
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

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
  const projectPath = req.query.path as string;
  if (!projectPath) { res.json({ branch: null }); return; }

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
  const projectPath = req.query.path as string;
  if (!projectPath) { res.json({ branches: [], worktrees: [], status: null }); return; }

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
  let modified = 0;
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
  const projectPath = req.query.path as string;
  if (!projectPath) {
    res.status(400).json({ error: 'path query param required' });
    return;
  }

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
  const projectPath = req.query.path as string;
  if (!projectPath) {
    res.status(400).json({ error: 'path query param required' });
    return;
  }

  res.json(getGitHeadCommit(projectPath) || { commitHash: null, shortCommitHash: null });
});

// Resolve a branch name to its tip commit. Used by the branch popover to set
// the diff baseline to "branch X's HEAD" without checking it out.
app.get('/api/git/branch-tip', (req, res) => {
  const projectPath = req.query.path as string;
  const branch = req.query.branch as string;
  if (!projectPath || !branch) {
    res.status(400).json({ error: 'path and branch query params required' });
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
  const projectPath = req.query.path as string;
  const limitParam = Number(req.query.limit);
  if (!projectPath) {
    res.status(400).json({ error: 'path query param required' });
    return;
  }

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

app.delete('/api/recent-projects', (req, res) => {
  const { projectPath } = req.body || {};
  if (!projectPath || typeof projectPath !== 'string') {
    res.status(400).json({ error: 'projectPath is required' });
    return;
  }
  removeRecentProject(projectPath);
  res.json({ ok: true });
});

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
  const projectPath = req.query.project as string;
  if (!projectPath) {
    res.status(400).json({ error: 'project query param required' });
    return;
  }

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
  const projectPath = req.query.project as string;
  if (!projectPath) {
    res.status(400).json({ error: 'project query param required' });
    return;
  }
  const systems = discoverSystems(projectPath);
  res.json({ systems });
});

// Browse directories (for folder picker)
app.get('/api/fs/browse', (req, res) => {
  const dirPath = (req.query.path as string) || os.homedir();
  try {
    const resolved = path.resolve(dirPath);
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => ({ name: e.name, path: path.join(resolved, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({ current: resolved, parent: path.dirname(resolved), dirs });
  } catch {
    res.status(400).json({ error: `Cannot read: ${dirPath}` });
  }
});

// Scan a project directory
let scanInFlight = false;
/** The project that the in-memory DB currently holds AST data for.
 *  When the user switches projects we must do a full (non-incremental)
 *  scan; when they rescan the *same* project we can skip unchanged files. */
let lastScannedProject: string | null = null;

/**
 * Core scan logic — callable both from the REST endpoint and MCP tool.
 * Throws on validation errors; callers should catch and surface appropriately.
 */
export async function scanProject(projectPath: string): Promise<{ fileCount: number; symbolCount: number; importCount: number; resolvedImports: number }> {
  if (!projectPath || typeof projectPath !== 'string') {
    throw new Error('projectPath is required');
  }
  if (!fs.existsSync(projectPath)) {
    throw new Error(`Path does not exist: ${projectPath}`);
  }
  if (scanInFlight) {
    throw new Error('A scan is already in progress');
  }
  scanInFlight = true;

  try {
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
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { maybeSeedIdentityFromGit } = require('./services/settings-service');
      if (maybeSeedIdentityFromGit(projectPath)) {
        console.log('[Scan] Seeded identity from git config for', projectPath);
      }
    } catch (err) {
      console.warn('[Scan] Failed to seed identity from git:', err);
    }

    const monorepoConfig = detectMonorepo(projectPath);
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

    startWatching(projectPath);
    startClaudeCodeWatcher(projectPath);

    try {
      startPlanFileWatcher(projectPath);
    } catch (err) {
      console.warn('[Scan] Plan file watcher failed to start:', err);
    }

    try {
      const { startProjectConfigWatcher } = require('./services/project-config-service');
      startProjectConfigWatcher(projectPath);
    } catch (err) {
      console.warn('[Scan] Project config watcher failed to start:', err);
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { startPointerWatcher } = require('./services/external-pointer-service');
      startPointerWatcher(projectPath);
    } catch (err) {
      console.warn('[Scan] External pointer watcher failed to start:', err);
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { indexProjectDocs, startSystemDocsWatcher } = require('./services/system-docs-service');
      indexProjectDocs(projectPath);
      startSystemDocsWatcher(projectPath);
    } catch (err) {
      console.warn('[Scan] System docs watcher failed to start:', err);
    }

    return stats;
  } finally {
    scanInFlight = false;
  }
}

app.post('/api/project/scan', async (req, res) => {
  const { projectPath } = req.body;
  try {
    const stats = await scanProject(projectPath);
    const monorepoConfig = detectMonorepo(projectPath);
    const fileTree = scanDirectory(projectPath);
    const fileCount = countFiles(fileTree);
    const depGraph: Record<string, string[]> = {};
    monorepoConfig.dependencyGraph.forEach((v, k) => { depGraph[k] = v; });
    res.json({
      monorepoConfig: { ...monorepoConfig, dependencyGraph: depGraph },
      fileTree,
      fileCount,
      astStats: stats,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes('already in progress') ? 409 : msg.includes('required') || msg.includes('does not exist') ? 400 : 500;
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
  if (!fs.existsSync(filePath)) {
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
    const buffer = fs.readFileSync(filePath);
    const content = (truncated ? buffer.subarray(0, MAX_BYTES) : buffer).toString('utf-8');

    const startParam = req.query.start ? parseInt(String(req.query.start), 10) : undefined;
    const endParam = req.query.end ? parseInt(String(req.query.end), 10) : undefined;
    const projectPath = (req.query.project as string) || undefined;

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
    let isDirty = false;
    if (projectPath) {
      const fullAnnotations = computeGitLineAnnotations(projectPath, filePath, fullLineCount);
      if (fullAnnotations) {
        annotations = fullAnnotations.slice(start - 1, end);
        isDirty = fullAnnotations.some((a) => a !== 'unchanged');
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
    '.php': 'php', '.rb': 'ruby', '.sh': 'bash', '.md': 'markdown',
    '.yml': 'yaml', '.yaml': 'yaml', '.toml': 'toml', '.sql': 'sql',
  };
  return map[ext] || 'plaintext';
}

/**
 * Returns a status array (one entry per line in the working-tree file) marking
 * lines added or modified relative to HEAD. Returns null if the file isn't
 * tracked yet (whole file is implicitly 'added' — caller can detect via
 * isDirty=true) or if git fails.
 */
function computeGitLineAnnotations(
  projectPath: string,
  filePath: string,
  lineCount: number,
): Array<'unchanged' | 'added' | 'modified'> | null {
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
        return Array(lineCount).fill('added');
      }
    } catch {
      return Array(lineCount).fill('added');
    }

    // Diff against HEAD (working tree, not index) with zero context
    const diffOut = execFileSync(
      'git',
      ['-C', projectPath, 'diff', '--no-color', '-U0', 'HEAD', '--', relative],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );

    const annotations: Array<'unchanged' | 'added' | 'modified'> = Array(lineCount).fill('unchanged');
    const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;
    let match: RegExpExecArray | null;
    while ((match = HUNK_RE.exec(diffOut)) !== null) {
      const startLine = parseInt(match[1], 10);
      const lineCountInHunk = match[2] != null ? parseInt(match[2], 10) : 1;
      // Was the hunk preceded by deletions? Crude heuristic: scan the hunk body
      // for both '+' and '-' lines to decide added vs modified.
      const blockStart = match.index + match[0].length;
      const nextHunk = diffOut.indexOf('\n@@', blockStart);
      const block = diffOut.slice(blockStart, nextHunk === -1 ? undefined : nextHunk);
      const hasRemoval = /^-/m.test(block);
      const status = hasRemoval ? 'modified' : 'added';

      for (let i = 0; i < lineCountInHunk; i += 1) {
        const idx = startLine - 1 + i;
        if (idx >= 0 && idx < annotations.length) {
          annotations[idx] = status;
        }
      }
    }
    return annotations;
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

  const projectPath = req.query.project as string;
  if (!projectPath) {
    res.json({ error: 'project query param required' });
    return;
  }

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
function readFilesSnapshot(projectPath: string): Array<{ path: string; hash: string; symbolCount: number }> {
  const d = getDb();
  const result = d.exec(`
    SELECT f.path, f.content_hash, COUNT(s.id) as symbol_count
    FROM files f
    LEFT JOIN symbols s ON s.file_id = f.id
    GROUP BY f.id
  `);
  if (!result[0]) return [];
  return result[0].values.map((row: any[]) => ({
    path: row[0].startsWith(projectPath) ? path.relative(projectPath, row[0]) : (row[0] as string),
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
  const { projectPath, commitHash } = req.body || {};
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
  const projectPath = req.query.project as string | undefined;
  const status = req.query.status as string | undefined;
  res.json(planService.listPlans(projectPath, status));
});

// Create plan
app.post('/api/plans', (req, res) => {
  const { title, description, tasks, projectPath } = req.body;
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
  const projectRoot = req.query.project as string | undefined;
  if (!projectRoot) {
    res.status(400).json({ error: 'project query param required' });
    return;
  }
  res.json(discoverPlanDirs(projectRoot));
});

// DB ↔ disk reconciliation
app.get('/api/plans/reconcile', (req, res) => {
  const projectRoot = req.query.project as string | undefined;
  if (!projectRoot) {
    res.status(400).json({ error: 'project query param required' });
    return;
  }
  res.json(reconcilePlanState(projectRoot));
});

// CDev Phase 3.6 — read the per-project config (just `repoRole` for
// the UI today; more fields will land here as they're added).
app.get('/api/project-config', (req, res) => {
  const projectRoot = req.query.project as string | undefined;
  if (!projectRoot) { res.status(400).json({ error: 'project query param required' }); return; }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getProjectConfig } = require('./services/project-config-service');
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
  const projectRoot = req.query.project as string | undefined;
  if (!projectRoot) {
    res.status(400).json({ error: 'project query param required' });
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { discoverPointers } = require('./services/external-pointer-service');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { findRecentProjectByOriginUrl } = require('./services/recent-projects-service');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getNormalisedOriginUrl } = require('./services/git-identity');

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
  const { kind, value, label, contentType, dataBase64, projectRoot } = req.body || {};
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
  const { kind, value, label, contentType, dataBase64, projectRoot } = req.body || {};
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

app.get('/api/plans/:uid/changes/:changeId', (req, res) => {
  const change = getChange(req.params.uid, req.params.changeId);
  if (!change) { res.status(404).json({ error: 'Change not found' }); return; }
  res.json(change);
});

// --- Plan File Sync API (Phase 13 §A) ---

app.post('/api/plans/:uid/export', (req, res) => {
  const projectRoot = (req.query.path as string) || (req.body && req.body.projectRoot);
  if (!projectRoot) {
    res.status(400).json({ error: 'projectRoot path required (?path=… or body.projectRoot)' });
    return;
  }
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
  const { source, projectPath, ...input } = req.body;
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
  const projectRoot = req.query.path as string | undefined;
  if (!projectRoot) {
    res.status(400).json({ error: 'path query param required' });
    return;
  }
  const planDir = getLinkedPlanDir(req.params.uid, projectRoot);
  res.json({ linked: planDir !== null, planDir });
});

app.post('/api/plans/:uid/unlink', (req, res) => {
  const projectRoot = (req.query.path as string) || (req.body && req.body.projectRoot);
  if (!projectRoot) {
    res.status(400).json({ error: 'projectRoot required (?path=… or body.projectRoot)' });
    return;
  }
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
  const projectRoot = req.query.project as string | undefined;
  res.json(listTemplates(projectRoot));
});

app.post('/api/plans/:uid/publish-as-template', (req, res) => {
  const { projectRoot, templateId, label, shortDescription, longDescription, defaultTitle, defaultPlanDescription, placeholders } = req.body || {};
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
  const { templateId, projectPath, title, description, author, authorType, placeholderValues } = req.body || {};
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
  const { projectPath, planUid, name } = req.body;
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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
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
  const projectPath = (req.query.project as string | undefined) || undefined;
  const gitDefaults = readGitIdentity(projectPath);
  res.json({
    firstRunComplete: settings.firstRunComplete,
    identity: settings.identity,
    gitDefaults,
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
  res.json(next);
});

/**
 * Read git config defaults for the active project (or a path passed
 * in via ?project=) so the Settings panel can pre-populate the
 * Identity section. Returns `{ name, email }` with empty strings on
 * miss — never errors.
 */
app.get('/api/identity/git-defaults', (req, res) => {
  const projectPath = (req.query.project as string | undefined) || undefined;
  res.json(readGitIdentity(projectPath));
});

// --- CDev Phase 5.3 — Personal sync REST surface ---

app.get('/api/sync/status', (_req, res) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getSyncStatus } = require('./services/personal-sync-service');
  res.json(getSyncStatus());
});

app.get('/api/sync/peek', (_req, res) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { peekImport } = require('./services/personal-sync-service');
  res.json(peekImport());
});

app.post('/api/sync/export', (_req, res) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { exportSync } = require('./services/personal-sync-service');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { listRecentProjects } = require('./services/recent-projects-service');
  const recentProjects = listRecentProjects().map((p: { path: string; lastOpenedAt: number }) => ({
    projectPath: p.path,
    lastOpenedAt: new Date(p.lastOpenedAt).toISOString(),
  }));
  res.json(exportSync(recentProjects));
});

app.post('/api/sync/import', (_req, res) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { importSync } = require('./services/personal-sync-service');
  const result = importSync();
  if (result.settingsImported) {
    broadcast('settings-changed', { settings: getSettings() });
  }
  res.json(result);
});

// --- CDev Phase 6 — Team history, conflict resolution, freeze periods ---

app.get('/api/team-activity', (req, res) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getTeamActivity } = require('./services/git-activity-service');
  const projectPath = req.query.project as string | undefined;
  if (!projectPath) { res.status(400).json({ error: 'project query param required' }); return; }
  const since = req.query.since as string | undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
  const entries = getTeamActivity({ projectRoot: projectPath, since, limit });
  res.json({ total: entries.length, entries });
});

app.get('/api/plan-history/:planSlug', (req, res) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getPlanCommitHistory } = require('./services/git-activity-service');
  const projectPath = req.query.project as string | undefined;
  if (!projectPath) { res.status(400).json({ error: 'project query param required' }); return; }
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
  const since = req.query.since as string | undefined;
  const commits = getPlanCommitHistory(projectPath, req.params.planSlug, { limit, since });
  res.json({ total: commits.length, commits });
});

app.get('/api/plan-history/:planSlug/at/:commitHash', (req, res) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getPlanAtCommit } = require('./services/plan-history-service');
  const projectPath = req.query.project as string | undefined;
  if (!projectPath) { res.status(400).json({ error: 'project query param required' }); return; }
  const state = getPlanAtCommit(projectPath, req.params.planSlug, req.params.commitHash);
  if (!state) { res.status(404).json({ error: 'Plan or commit not found' }); return; }
  res.json(state);
});

app.get('/api/plan-history/:planSlug/diff', (req, res) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { diffPlanBetweenCommits } = require('./services/plan-history-service');
  const projectPath = req.query.project as string | undefined;
  const base = req.query.base as string | undefined;
  const head = req.query.head as string | undefined;
  if (!projectPath || !base || !head) {
    res.status(400).json({ error: 'project, base, and head query params required' });
    return;
  }
  const diff = diffPlanBetweenCommits(projectPath, req.params.planSlug, base, head);
  res.json(diff);
});

app.get('/api/plan-history/:planSlug/search', (req, res) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { searchPlanHistory } = require('./services/git-activity-service');
  const projectPath = req.query.project as string | undefined;
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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { detectManifestConflicts } = require('./services/plan-conflict-service');
  const projectPath = req.query.project as string | undefined;
  if (!projectPath) { res.status(400).json({ error: 'project query param required' }); return; }
  res.json(detectManifestConflicts(projectPath));
});

app.post('/api/conflicts/resolve', (req, res) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { resolveFileConflict, resolveFileConflictBySide } = require('./services/plan-conflict-service');
  const { projectPath, filePath, mode, side, resolutions } = req.body;
  if (!projectPath || !filePath || !mode) {
    res.status(400).json({ error: 'projectPath, filePath, and mode required' });
    return;
  }
  if (mode === 'by_side') {
    res.json(resolveFileConflictBySide(projectPath, filePath, side));
  } else {
    res.json(resolveFileConflict(projectPath, filePath, resolutions ?? []));
  }
});

app.get('/api/freeze', (req, res) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getFreezeStatus } = require('./services/freeze-service');
  const projectPath = req.query.project as string | undefined;
  if (!projectPath) { res.status(400).json({ error: 'project query param required' }); return; }
  res.json(getFreezeStatus(projectPath));
});

app.put('/api/freeze', (req, res) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setFreeze } = require('./services/freeze-service');
  const { projectPath, active, reason, until, allowedPlanUids } = req.body;
  if (!projectPath || active === undefined) {
    res.status(400).json({ error: 'projectPath and active required' });
    return;
  }
  const status = setFreeze(projectPath, { active, reason, until, allowedPlanUids });
  broadcast('freeze-changed', { projectRoot: projectPath, status });
  res.json(status);
});

// --- CDev Phase 3.4 — System documentation REST surface ---
//
// Frontend reads / writes system docs via these. The MCP tools cover
// the same surface for agents; both pipe through the same service.

app.get('/api/system-docs', (req, res) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const svc = require('./services/system-docs-service');
  const projectPath = req.query.project as string | undefined;
  const search = req.query.search as string | undefined;
  if (!projectPath) {
    res.status(400).json({ error: 'project query param required' });
    return;
  }
  res.json(search ? svc.searchSystemDocs(projectPath, search) : svc.listSystemDocs(projectPath));
});

app.get('/api/system-docs/:uid', (req, res) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const svc = require('./services/system-docs-service');
  const doc = svc.getSystemDoc(req.params.uid);
  if (!doc) { res.status(404).json({ error: 'not found' }); return; }
  res.json(doc);
});

app.post('/api/system-docs', (req, res) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const svc = require('./services/system-docs-service');
  const { projectPath, title, body, owner, tags, references, slug } = req.body || {};
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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const svc = require('./services/system-docs-service');
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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const svc = require('./services/system-docs-service');
  const ok = svc.deleteSystemDoc(req.params.uid);
  if (ok) {
    broadcast('system-doc-removed', { uid: req.params.uid });
    saveNow(() => exportDatabase());
  }
  res.json({ ok, uid: req.params.uid });
});

app.post('/api/system-docs/:uid/verify', (req, res) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const svc = require('./services/system-docs-service');
  const updated = svc.verifySystemDoc(req.params.uid);
  if (!updated) { res.status(404).json({ error: 'not found' }); return; }
  broadcast('system-doc-verified', { uid: updated.uid, capturedAgainstCommit: updated.capturedAgainstCommit });
  saveNow(() => exportDatabase());
  res.json(updated);
});

app.get('/api/system-docs/:uid/freshness', (req, res) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const svc = require('./services/system-docs-service');
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
    const project = req.query.project as string | undefined;
    if (!project) return res.status(400).json({ error: 'project query parameter is required' });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { checkAllDocsAndBridge } = require('./services/sensor-bridge-service');
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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { listRecentProjects } = require('./services/recent-projects-service');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { startProjectConfigWatcher } = require('./services/project-config-service');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { startPointerWatcher } = require('./services/external-pointer-service');

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
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { indexProjectDocs, startSystemDocsWatcher } = require('./services/system-docs-service');
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
  } catch (err) {
    console.warn('[Backend] Session sweep failed to start:', err);
  }

  // CDev Phase 2.3 — channel notification dispatcher. Runs a periodic
  // stale-event sweep for minAgeMs rules; post-time dispatch is called
  // directly from the MCP / REST handlers that create channel events.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { startChannelDispatcher } = require('./services/channel-dispatcher-service');
    startChannelDispatcher(broadcast);
  } catch (err) {
    console.warn('[Backend] Channel dispatcher failed to start:', err);
  }

  // Phase 4.2 — sensor bridge: converts detection events (deviations,
  // doc staleness, stuck) into channel events. Needs the broadcast fn.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { initSensorBridge } = require('./services/sensor-bridge-service');
    initSensorBridge(broadcast);
  } catch (err) {
    console.warn('[Backend] Sensor bridge failed to init:', err);
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
}

/**
 * Boot the backend AND open a TCP port. Used by web mode
 * (`npm run dev:backend`) where the browser fetches `/api/...` over
 * HTTP. Honours `CODETRELLIS_BACKEND_PORT` env var and walks
 * forward on `EADDRINUSE` (up to 10 slots). The actually-bound
 * port is returned via `getBoundBackendPort()`.
 *
 * Electron does NOT call this — see `initializeBackend()` instead.
 */
export async function startServer(port?: number): Promise<http.Server> {
  await initializeBackend();

  const envPort = process.env.CODETRELLIS_BACKEND_PORT;
  const requestedPort = envPort ? Number(envPort) : (port ?? DEFAULT_PORT);

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
        console.log(`[Backend] Server running on http://localhost:${boundBackendPort}${note}`);
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
      // Bind to loopback only — never accept connections from other
      // machines on the network. The renderer (file:// in packaged
      // mode) reaches us via http://localhost:<port> which resolves
      // to 127.0.0.1; agents also connect via 127.0.0.1.
      //
      // Wrap in try/catch: some Node versions (observed on 25.x)
      // throw synchronously from inside `listen()` for EADDRINUSE
      // rather than emitting an `error` event, which leaks past
      // our once-listener as an uncaughtException. Funnel the
      // sync throw through the same retry path.
      try {
        server.listen(candidate, '127.0.0.1');
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

function getGitWorkingTreeStatus(projectPath: string): {
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
    const output = execFileSync(
      'git',
      ['-C', projectPath, 'status', '--porcelain=v1', '--untracked-files=all'],
      { encoding: 'utf8' },
    );

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
      const filePath = rawPath.includes('->') ? rawPath.split('->').pop()?.trim() || rawPath : rawPath;

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
