/**
 * MCP HTTP/SSE server — slim orchestrator.
 *
 * All tool registrations live in domain-specific modules under `tools/`.
 * This file constructs the ToolDeps bag, sets up per-connection McpServer
 * instances, and manages the HTTP server lifecycle.
 */

// [codemod] hoisted lazy requires → static namespace imports for bundling
import * as _lazy____services_stuck_sensor_service from '../services/stuck-sensor-service';
import {
  extractToken,
  verifyCapabilityToken,
  getCapabilityToken,
  getTokenFilePath,
  TOKEN_HEADER,
} from '../services/capability-token';
import * as _lazy____server from '../server';
import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

// ── Service imports ─────────────────────────────────────────────────
// Static imports so Vite's Electron-main bundler resolves them correctly.

import { searchSymbols, getDependencyEdges, getFileDependencies, getDbStats, getDb, exportDatabase } from '../services/database';
import { broadcast, getBoundBackendPort, scanProject } from '../server';
import * as planService from '../services/plan-service';
import * as commentService from '../services/comment-service';
import * as sessionService from '../services/session-service';
import * as budgetService from '../services/budget-service';
import * as taskAttachmentsService from '../services/task-attachments-service';
import * as planItemService from '../services/plan-item-service';
import * as planEventService from '../services/plan-event-service';
import * as planChangesService from '../services/plan-changes-service';
import * as planFileService from '../services/plan-file-service';
import * as externalRefsService from '../services/external-refs-service';
import * as externalPointerService from '../services/external-pointer-service';
import * as systemDocsService from '../services/system-docs-service';
import * as terminalService from '../services/terminal-service';
import * as planImportService from '../services/plan-import-service';
import * as presenceService from '../services/presence-service';
import * as projectConfigService from '../services/project-config-service';
import { applyTemplate } from '../services/plan-templates-service';
import { listTemplates } from '../services/plan-templates';
import { publishPlanAsTemplate } from '../services/plan-template-publish-service';
import { getDeviations, resolveDeviation, detectDeviations } from '../services/deviation-service';
import { captureCurrentTrellis, listSnapshots, computeTrellisDiff } from '../services/trellis-service';
import { saveNow } from '../services/persistence';
import { getSettings, updateSettings } from '../services/settings-service';
import { assertMcpMayCall, McpAuthorizationError } from '../services/mcp-capabilities';
import { DEFAULT_GRANTS, type PeerCapability } from '../services/peer-capabilities';
import { tailLog, getCurrentLogPath, getLogDir } from '../services/logger';
import { listCrossSystemEdges, getCrossSystemStats } from '../services/cross-system-service';
import {
  listRecentProjects,
  removeRecentProject,
  setRecentProjectPinned,
  setProjectAlias,
  refreshProjectOriginUrl,
  getRecentProject,
  findRecentProjectByOriginUrl,
} from '../services/recent-projects-service';
import { buildSkillGuide } from './skill-guide';

// ── Tool & resource modules ─────────────────────────────────────────

import type { ToolDeps, PendingResponses } from './types';
import { register as registerArchitectureTools } from './tools/architecture-tools';
import { register as registerTerminalTools } from './tools/terminal-tools';
import { register as registerGraphTools } from './tools/graph-tools';
import { register as registerDriftTools } from './tools/drift-tools';
import { register as registerUITools } from './tools/ui-tools';
import { register as registerSessionTools } from './tools/session-tools';
import { register as registerPlanTools } from './tools/plan-tools';
import { register as registerPlanItemTools } from './tools/plan-item-tools';
import { register as registerPresenceTools } from './tools/presence-tools';
import { register as registerMobileTools } from './tools/mobile-tools';
import { register as registerProjectConfigTools } from './tools/project-config-tools';
import { register as registerGitTools } from './tools/git-tools';
import { register as registerChannelTools } from './tools/channel-tools';
import { register as registerSystemDocsTools } from './tools/system-docs-tools';
import { register as registerGovernanceTools } from './tools/governance-tools';
import { register as registerBudgetTools } from './tools/budget-tools';
import { register as registerIntakeTools } from './tools/intake-tools';
import { register as registerReviewTools } from './tools/review-tools';
import { registerContributionTools } from './tools/contribution-tools';
import { registerAudioTools } from './tools/audio-tools';
import { registerPeerTools } from './tools/peer-tools';
import { register as registerResources } from './resources';

// ── Constants ───────────────────────────────────────────────────────

const DEFAULT_MCP_PORT = 19432;
const MAX_PORT_ATTEMPTS = 10;
const MAX_MCP_CONNECTIONS = 20;

// ── Module-level state ──────────────────────────────────────────────

const connectedServers = new Map<string, McpServer>();
let httpServer: http.Server | null = null;
let boundPort: number = DEFAULT_MCP_PORT;
const connectedTransports = new Map<string, SSEServerTransport>();

let toolEventCounter = 0;

/**
 * Shared pending-response map. Used by screenshot, clipboard_read,
 * graph_export, and graph_snapshot tools — MCP tool sets up nonce +
 * promise, broadcasts a request to the frontend, frontend POSTs result
 * back via REST which resolves the promise.
 */
const pendingResponses: PendingResponses = new Map();

// Expose resolver so server.ts (the Express app) can wire the
// POST /api/screenshot-response route.
(globalThis as any).__screenshotResolve = (nonce: string, data: string) => {
  const pending = pendingResponses.get(nonce);
  if (pending) {
    clearTimeout(pending.timer);
    pendingResponses.delete(nonce);
    pending.resolve(data);
  }
};

// Presence ack / reply resolver — same pattern as screenshot.
(globalThis as any).__presenceResolve = (nonce: string, data: string) => {
  const pending = pendingResponses.get(nonce);
  if (pending) {
    clearTimeout(pending.timer);
    pendingResponses.delete(nonce);
    pending.resolve(data);
  }
};

/**
 * Electron screenshot capture function. Set by the Electron main process
 * via `setElectronScreenshotCapture()` after the BrowserWindow is created.
 * When set, the screenshot MCP tool uses this instead of the html-to-image
 * broadcast round-trip, avoiding canvas-tainting issues on file:// origins.
 */
let electronScreenshotCapture: (() => Promise<string>) | undefined;

export function setElectronScreenshotCapture(captureFn: () => Promise<string>): void {
  electronScreenshotCapture = captureFn;
}

// ── Tool event broadcast ────────────────────────────────────────────

interface ToolEventPayload {
  tool: string;
  args: string;
  phase: 'complete' | 'error';
  durationMs: number;
  sessionId: string | null;
  agentType: string | null;
  agentModel: string | null;
  error?: string;
}

function broadcastToolEvent(payload: ToolEventPayload): void {
  broadcast('agent-event', {
    id: `mcp-tool-${++toolEventCounter}`,
    timestamp: Date.now(),
    source: 'mcp',
    type: payload.phase === 'error' ? 'tool_error' : 'tool_call',
    payload,
  });

  // Phase 4.4 — feed the stuck sensor. Fire-and-forget; the sensor
  // handles its own error containment.
  try {
    const { recordToolCall } = _lazy____services_stuck_sensor_service;
    recordToolCall({
      tool: payload.tool,
      args: payload.args,
      phase: payload.phase,
      sessionId: payload.sessionId,
      error: payload.error,
    });
  } catch { /* best-effort */ }

  // Phase 23 — feed the budget service. Time is accumulated per TURN,
  // not per call: an agent's wall-clock is mostly model thinking
  // between calls, so summing durationMs would undercount it several
  // times over. This call just says "the session was alive at this
  // moment"; the turn's span is what gets recorded.
  try {
    if (payload.sessionId) {
      const session = sessionService
        .getActiveSessions()
        .find((s) => s.sessionId === payload.sessionId);
      budgetService.recordActivity({
        sessionId: payload.sessionId,
        planUid: session?.activePlanUid ?? null,
        agentType: payload.agentType,
        agentModel: payload.agentModel,
      });
    }
  } catch { /* best-effort — accounting must never break a tool call */ }
}

function summarizeArgs(args: any): string {
  if (args == null) return '';
  try {
    const json = JSON.stringify(args);
    return json.length > 240 ? json.slice(0, 240) + '…' : json;
  } catch {
    return '[unserializable]';
  }
}

function inferAgentFromSession(sessionId: string | null): { type: string | null; model: string | null } {
  if (!sessionId) return { type: 'mcp-agent', model: null };
  const sessions = sessionService.getActiveSessions();
  // Find by exact sessionId — picking "the most recent session" was
  // wrong; it cross-attributed activity across concurrent agents.
  const match = sessions.find((s) => s.sessionId === sessionId);
  if (!match) return { type: 'mcp-agent', model: null };
  return { type: match.agentType ?? 'mcp-agent', model: match.model ?? null };
}

// ── ToolDeps bag ────────────────────────────────────────────────────

function buildToolDeps(sessionId: string): ToolDeps {
  return {
    broadcast,
    pendingResponses,
    sessionId,

    // Service modules
    planService,
    planItemService,
    commentService,
    sessionService,
    taskAttachmentsService,
    planEventService,
    planFileService,
    planChangesService,
    externalRefsService,
    externalPointerService,
    systemDocsService,
    terminalService,
    planImportService,
    presenceService,
    projectConfigService,

    // Specific functions
    applyTemplate,
    listTemplates,
    publishPlanAsTemplate,
    getDeviations,
    resolveDeviation,
    detectDeviations,
    captureCurrentTrellis,
    listSnapshots,
    computeTrellisDiff,
    saveNow,
    exportDatabase,
    searchSymbols,
    getDependencyEdges,
    getFileDependencies,
    getDbStats,
    getDb,
    listCrossSystemEdges,
    getCrossSystemStats,
    listRecentProjects,
    removeRecentProject,
    setRecentProjectPinned,
    setProjectAlias,
    refreshProjectOriginUrl,
    getRecentProject,
    findRecentProjectByOriginUrl,
    getSettings,
    updateSettings,
    tailLog,
    getCurrentLogPath,
    getLogDir,
    getBoundBackendPort,
    scanProject,
    buildSkillGuide,
    captureElectronScreenshot: electronScreenshotCapture,
  };
}

// ── Per-connection McpServer setup ──────────────────────────────────

/**
 * Build a fresh McpServer instance with all tools + resources
 * registered. Called once per agent connection — the SDK's
 * Server.connect(transport) is single-transport, so multi-agent
 * support requires one server instance per session. All instances
 * share the same module-level state.
 */
/**
 * What this installation grants MCP clients.
 *
 * Read fresh on every call rather than captured at connect time, so turning
 * a capability off takes effect on the next tool call instead of requiring
 * the agent to reconnect — a grant the user has just revoked must not
 * survive in a long-lived SSE session.
 */
function grantedMcpCapabilities(): readonly PeerCapability[] {
  try {
    const configured = getSettings().mcp?.capabilities;
    return Array.isArray(configured) ? configured : DEFAULT_GRANTS;
  } catch {
    // Settings unreadable — fall back to the defaults, which are the
    // narrower answer. Failing open here would defeat the point.
    return DEFAULT_GRANTS;
  }
}

/**
 * Every tool name registered on any McpServer instance in this process.
 *
 * Populated by the interception below, so it reflects what the server
 * ACTUALLY registered rather than a hand-kept list — which is the only
 * form of this that cannot drift. The authorisation coverage test reads
 * it; see `mcp-capabilities.ts`.
 */
const REGISTERED_TOOLS = new Set<string>();

/** Snapshot of the registered tool names, sorted. */
export function listRegisteredTools(): string[] {
  return [...REGISTERED_TOOLS].sort();
}

function setupMcpServerInstance(sessionId: string): McpServer {
  const mcpServer = new McpServer(
    { name: 'codetrellis', version: '0.1.0' },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
      instructions: 'CodeTrellis provides codebase architecture analysis. Use these tools to understand how files connect, search for symbols, and report your plans.',
    }
  );

  // Generic per-tool-call interception — the ONE place every MCP tool
  // call passes through.
  //
  // It broadcasts into the agent-event channel for the Agent Timeline and
  // bumps session last_seen so an actively-working agent does not go stale
  // in the cleanStaleSessions sweep (Bugfix C). `sessionId` is the
  // McpServer-instance binding (closure capture) — every tool call on this
  // server belongs to the same SSE session.
  //
  // BOTH registration APIs are wrapped, and that is not a detail.
  // `registerTool` is the current SDK method; `server.tool()` is the
  // deprecated one, and three files still use it — peer-tools,
  // audio-tools and contribution-tools, 21 tools between them. Only
  // `registerTool` was intercepted, so those 21 were invisible to the
  // Timeline: CLAUDE.md says "all MCP tool calls broadcast on the
  // tool_call / tool_error channel with agent attribution", and for
  // `write_remote_terminal` — which drives a terminal on a paired
  // device — that was not true. Anything added here that covers only one
  // API covers seven eighths of the surface.
  const registerName = (name: string) => { REGISTERED_TOOLS.add(name); };

  const instrument = (name: string, handler: any) => async (args: any, extra: any) => {
    const start = Date.now();
    // Heartbeat: any tool call counts as activity, push last_seen.
    try { sessionService.heartbeat(sessionId); } catch { /* best-effort */ }
    const agentInfo = inferAgentFromSession(sessionId);

    // AUTHORISE — Phase 30. One gate, here, rather than a check added to 21
    // tool files. Both confinement guards in this codebase rotted precisely
    // because the rule lived at each call site and a new site could simply
    // not have it; a single choke point plus a coverage test is the shape
    // that survives.
    //
    // The refusal is broadcast like any other tool error, so a blocked call
    // is visible in the Timeline rather than disappearing.
    try {
      assertMcpMayCall(name, grantedMcpCapabilities());
    } catch (err) {
      if (err instanceof McpAuthorizationError) {
        console.warn(`[MCP][Authz] REFUSED ${name} — ${err.message}`);
        broadcastToolEvent({
          tool: name,
          args: summarizeArgs(args),
          phase: 'error',
          durationMs: 0,
          sessionId,
          agentType: agentInfo.type,
          agentModel: agentInfo.model,
          error: err.message,
        });
      }
      throw err;
    }

    try {
      const result = await handler(args, extra);
      broadcastToolEvent({
        tool: name,
        args: summarizeArgs(args),
        phase: 'complete',
        durationMs: Date.now() - start,
        sessionId,
        agentType: agentInfo.type,
        agentModel: agentInfo.model,
      });
      return result;
    } catch (err) {
      broadcastToolEvent({
        tool: name,
        args: summarizeArgs(args),
        phase: 'error',
        durationMs: Date.now() - start,
        sessionId,
        agentType: agentInfo.type,
        agentModel: agentInfo.model,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };

  const originalRegisterTool = (mcpServer.registerTool as any).bind(mcpServer);
  (mcpServer as any).registerTool = (name: string, config: any, handler: any) => {
    registerName(name);
    return originalRegisterTool(name, config, instrument(name, handler));
  };

  // `tool()` has several overloads — (name, cb), (name, description, cb),
  // (name, schema, cb), (name, description, schema, cb) — and the callback
  // is last in every one of them. Replacing only the final argument is
  // therefore overload-proof, where matching on arity would not be.
  const originalTool = (mcpServer.tool as any).bind(mcpServer);
  (mcpServer as any).tool = (...args: any[]) => {
    const name = args[0] as string;
    const last = args.length - 1;
    registerName(name);
    const next = [...args];
    next[last] = instrument(name, args[last]);
    return originalTool(...next);
  };

  // Register all tools and resources via domain modules
  const deps = buildToolDeps(sessionId);

  registerArchitectureTools(mcpServer, deps);
  registerTerminalTools(mcpServer, deps);
  registerGraphTools(mcpServer, deps);
  registerDriftTools(mcpServer, deps);
  registerUITools(mcpServer, deps);
  registerSessionTools(mcpServer, deps);
  registerPlanTools(mcpServer, deps);
  registerPlanItemTools(mcpServer, deps);
  registerPresenceTools(mcpServer, deps);
  registerMobileTools(mcpServer, deps);
  registerProjectConfigTools(mcpServer, deps);
  registerGitTools(mcpServer, deps);
  registerChannelTools(mcpServer, deps);
  registerSystemDocsTools(mcpServer, deps);
  registerGovernanceTools(mcpServer, deps);
  registerBudgetTools(mcpServer, deps);
  registerIntakeTools(mcpServer, deps);
  registerReviewTools(mcpServer, deps);
  registerContributionTools(mcpServer);
  registerAudioTools(mcpServer);
  registerPeerTools(mcpServer);
  registerResources(mcpServer, deps);

  return mcpServer;
}

/**
 * Build a throwaway server instance purely to enumerate what registers.
 *
 * The authorisation coverage test needs the names the server ACTUALLY
 * registers, not a list someone typed — a list checked against itself
 * verifies nothing, which is the failure mode every drift guard in this
 * codebase exists to prevent. No transport is connected, so this does
 * nothing but populate the registry.
 */
export function enumerateRegisteredTools(): string[] {
  setupMcpServerInstance('tool-coverage-probe');
  return listRegisteredTools();
}

// ── HTTP/SSE server lifecycle ───────────────────────────────────────

/**
 * Boot the MCP HTTP/SSE server. Called once at backend startup.
 * Per-connection server instances are built lazily inside the
 * /sse handler via setupMcpServerInstance().
 */
export async function startMcpServer(): Promise<void> {
  if (httpServer) return;

  const app = http.createServer(async (req, res) => {
    // ── Authentication (Phase 19 Gate 1.1, finding 4) ────────────────
    //
    // This server binds 127.0.0.1 and used to answer with
    // `Access-Control-Allow-Origin: *`. Loopback is not a boundary — any
    // page the user visits can reach it — and the MCP tool surface includes
    // TERMINAL EXECUTION. A wildcard ACAO on top meant a web page could both
    // drive those tools and read the results.
    //
    // The token is the same per-launch secret the Express API uses, and the
    // same reasoning applies: any MCP client the user configured can read it
    // from <dataDir>/capability-token; a browser cannot. The product stays
    // agent-agnostic.
    //
    // NOTE ON THE QUERY PARAMETER: an SSE client is an EventSource, which
    // cannot set request headers. So `?ct_token=` is not a convenience here,
    // it is the only way an SSE transport can authenticate at all.
    const hostHeader = (req.headers.host || '').toString().replace(/:\d+$/, '').toLowerCase();
    if (hostHeader && !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(hostHeader)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Host not allowed' }));
      return;
    }

    // No ACAO at all. Nothing legitimate needs cross-origin access to this
    // server: MCP clients are processes, not pages, and the same-origin
    // policy does not apply to them. Omitting the header is what stops a
    // browser reading a response even if it manages to send a request.
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', `Content-Type, Authorization, ${TOKEN_HEADER}`);
    res.setHeader('Vary', 'Origin');

    if (req.method === 'OPTIONS') {
      // Preflight only ever comes from a browser, and no browser has business
      // here. Refuse rather than advertise the surface.
      res.writeHead(403);
      res.end();
      return;
    }

    const presented = extractToken(
      req.headers as Record<string, string | string[] | undefined>,
      req.url,
    );
    if (!verifyCapabilityToken(presented)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'Missing or invalid capability token',
          hint: `Send the token from ${getTokenFilePath()} as the ${TOKEN_HEADER} header, an Authorization: Bearer value, or the ct_token query parameter.`,
        }),
      );
      return;
    }

    // Match on PATHNAME, not the raw URL. The capability token may arrive
    // as `?ct_token=…` (SSE clients are EventSource-based and cannot set
    // headers), so `req.url === '/sse'` no longer holds for an authenticated
    // request — it is `/sse?ct_token=…`. Exact-matching the raw URL here
    // silently 404'd every authenticated MCP client.
    const pathname = (() => {
      try {
        return new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      } catch {
        return req.url ?? '/';
      }
    })();

    if (pathname === '/sse' && req.method === 'GET') {
      if (connectedTransports.size >= MAX_MCP_CONNECTIONS) {
        console.warn(`[MCP] Connection limit reached (${MAX_MCP_CONNECTIONS}), rejecting new SSE client`);
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Too many MCP connections' }));
        return;
      }

      // Advertise the POST-back endpoint WITH the token.
      //
      // An SSE session is two channels: this GET stream, and a POST to
      // /messages for every client->server message. The SDK takes the POST
      // URL from what we advertise here, and an EventSource client cannot
      // attach headers to either.
      //
      // The client has ALREADY proved it holds the token — it could not have
      // opened this stream otherwise — so echoing it back in the endpoint
      // grants nothing new. It does mean every MCP client works with only a
      // URL, no per-client header configuration, which is what keeps the
      // product agent-agnostic.
      const messagesEndpoint = `/messages?ct_token=${encodeURIComponent(getCapabilityToken())}`;
      const transport = new SSEServerTransport(messagesEndpoint, res);
      const sessionId = transport.sessionId;
      connectedTransports.set(sessionId, transport);

      const mcpServer = setupMcpServerInstance(sessionId);
      connectedServers.set(sessionId, mcpServer);

      // Auto-register session on connect
      const inferredAgentType = req.headers['user-agent']?.toString().split(' ')[0]?.toLowerCase().includes('claude')
        ? 'claude-code'
        : 'mcp-client';
      sessionService.registerSession(sessionId, inferredAgentType);

      // SSE-driven keep-alive (Phase 2 tester finding): without this,
      // a connected agent that doesn't call any tool for >60s gets
      // swept by cleanStaleSessions and a subsequent reconnect lands
      // a generic mcp-client session, losing the agent-type/model
      // attribution. Bumping last_seen every 30s while the connection
      // is open is sufficient — the sweep runs on the same cadence so
      // we never miss a window. Per-connection timer cleared on close.
      const keepAlive = setInterval(() => {
        try { sessionService.heartbeat(sessionId); } catch { /* ignore */ }
      }, 30_000);
      if (typeof keepAlive.unref === 'function') keepAlive.unref();

      res.on('close', () => {
        clearInterval(keepAlive);
        connectedTransports.delete(sessionId);
        const sessionServer = connectedServers.get(sessionId);
        if (sessionServer) {
          sessionServer.close().catch(() => { /* ignore */ });
          connectedServers.delete(sessionId);
        }
        sessionService.disconnectSession(sessionId);
        console.log(`[MCP] Client disconnected: ${sessionId}`);
        broadcast('agent-event', {
          id: `mcp-disconnect-${Date.now()}`,
          timestamp: Date.now(),
          source: 'mcp',
          type: 'session_end',
          payload: { sessionId },
        });
        broadcast('mcp-session-changed', { reason: 'disconnect' });
      });

      console.log(`[MCP] Client connected: ${sessionId} (${inferredAgentType})`);
      broadcast('agent-event', {
        id: `mcp-connect-${Date.now()}`,
        timestamp: Date.now(),
        source: 'mcp',
        type: 'session_start',
        payload: { sessionId, source: 'mcp', agentType: inferredAgentType },
      });
      broadcast('mcp-session-changed', { reason: 'connect' });

      await mcpServer.connect(transport);
      return;
    }

    if (pathname.startsWith('/messages') && req.method === 'POST') {
      const sessionId = new URL(req.url ?? '/', `http://localhost:${boundPort}`).searchParams.get('sessionId');
      if (!sessionId || !connectedTransports.has(sessionId)) {
        res.writeHead(404);
        res.end('Session not found');
        return;
      }
      const transport = connectedTransports.get(sessionId)!;
      await transport.handlePostMessage(req, res);
      return;
    }

    // Health check
    if (pathname === '/' || pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        name: 'codetrellis-mcp',
        version: '0.1.0',
        connectedClients: connectedTransports.size,
      }));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  httpServer = app;

  const settings = getSettings();
  const envPort = process.env.CODETRELLIS_MCP_PORT;
  const requestedPort = envPort ? Number(envPort) : (settings.mcp.port ?? DEFAULT_MCP_PORT);
  const autodetect = settings.mcp.autodetectOnCollision !== false && !envPort;

  return new Promise<void>((resolve, reject) => {
    const tryPort = (candidate: number, attemptsLeft: number) => {
      const onListening = () => {
        app.removeListener('error', onError);
        boundPort = candidate;
        console.log(`[MCP] Server running on http://127.0.0.1:${boundPort}${candidate !== requestedPort ? ` (requested ${requestedPort}, autodetected)` : ''}`);
        try {
          const { broadcast: bc } = _lazy____server;
          bc('mcp-port-changed', { port: boundPort, requested: requestedPort });
        } catch { /* server module may not yet be registered for broadcast in tests */ }
        resolve();
      };
      const onError = (err: NodeJS.ErrnoException) => {
        app.removeListener('listening', onListening);
        if (err.code === 'EADDRINUSE' && autodetect && attemptsLeft > 0) {
          console.warn(`[MCP] Port ${candidate} in use; trying ${candidate + 1}…`);
          tryPort(candidate + 1, attemptsLeft - 1);
        } else {
          reject(err);
        }
      };
      app.once('listening', onListening);
      app.once('error', onError);
      app.listen(candidate, '127.0.0.1');
    };
    tryPort(requestedPort, autodetect ? MAX_PORT_ATTEMPTS : 0);
  });
}

export function getMcpStatus(): {
  running: boolean;
  port: number;
  connectedAgents: number;
} {
  return {
    running: httpServer !== null,
    port: boundPort,
    connectedAgents: connectedTransports.size,
  };
}

/**
 * MCP config for agents to copy into their settings.
 */
export function getMcpConfig(): Record<string, unknown> {
  return {
    codetrellis: {
      type: 'sse',
      url: `http://127.0.0.1:${boundPort}/sse`,
    },
  };
}

export async function stopMcpServer(): Promise<void> {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
  await Promise.allSettled(
    Array.from(connectedServers.values()).map((s) => s.close()),
  );
  connectedServers.clear();
  connectedTransports.clear();
}
