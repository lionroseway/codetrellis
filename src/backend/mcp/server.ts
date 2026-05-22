/**
 * MCP HTTP/SSE server — slim orchestrator.
 *
 * All tool registrations live in domain-specific modules under `tools/`.
 * This file constructs the ToolDeps bag, sets up per-connection McpServer
 * instances, and manages the HTTP server lifecycle.
 */

import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

// ── Service imports ─────────────────────────────────────────────────
// Static imports so Vite's Electron-main bundler resolves them correctly.

import { searchSymbols, getDependencyEdges, getFileDependencies, getDbStats, getDb, exportDatabase } from '../services/database';
import { broadcast, getBoundBackendPort } from '../server';
import * as planService from '../services/plan-service';
import * as commentService from '../services/comment-service';
import * as sessionService from '../services/session-service';
import * as taskAttachmentsService from '../services/task-attachments-service';
import * as planItemService from '../services/plan-item-service';
import * as planEventService from '../services/plan-event-service';
import * as planChangesService from '../services/plan-changes-service';
import * as planFileService from '../services/plan-file-service';
import * as externalRefsService from '../services/external-refs-service';
import * as terminalService from '../services/terminal-service';
import * as planImportService from '../services/plan-import-service';
import { applyTemplate } from '../services/plan-templates-service';
import { listTemplates } from '../services/plan-templates';
import { publishPlanAsTemplate } from '../services/plan-template-publish-service';
import { getDeviations, resolveDeviation, detectDeviations } from '../services/deviation-service';
import { captureCurrentTrellis, listSnapshots, computeTrellisDiff } from '../services/trellis-service';
import { saveNow } from '../services/persistence';
import { getSettings, updateSettings } from '../services/settings-service';
import { tailLog, getCurrentLogPath, getLogDir } from '../services/logger';
import { listCrossSystemEdges, getCrossSystemStats } from '../services/cross-system-service';
import { listRecentProjects } from '../services/recent-projects-service';
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
import { register as registerResources } from './resources';

// ── Constants ───────────────────────────────────────────────────────

const DEFAULT_MCP_PORT = 19432;
const MAX_PORT_ATTEMPTS = 10;
const MAX_MCP_CONNECTIONS = 20;

// ── Module-level state ──────────────────────────────────────────────

let connectedServers = new Map<string, McpServer>();
let httpServer: http.Server | null = null;
let boundPort: number = DEFAULT_MCP_PORT;
let connectedTransports = new Map<string, SSEServerTransport>();
let transportToAgent = new Map<string, string>();

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
  if (sessions.length === 0) return { type: 'mcp-agent', model: null };
  const latest = sessions[sessions.length - 1];
  return { type: latest.agentType ?? 'mcp-agent', model: latest.model ?? null };
}

// ── ToolDeps bag ────────────────────────────────────────────────────

function buildToolDeps(): ToolDeps {
  return {
    broadcast,
    pendingResponses,

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
    terminalService,
    planImportService,

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
    getSettings,
    updateSettings,
    tailLog,
    getCurrentLogPath,
    getLogDir,
    getBoundBackendPort,
    buildSkillGuide,
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
function setupMcpServerInstance(): McpServer {
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

  // Generic per-tool-call broadcast: every MCP tool invocation flows
  // into the agent-event channel for the Agent Timeline.
  const originalRegisterTool = (mcpServer.registerTool as any).bind(mcpServer);
  (mcpServer as any).registerTool = (name: string, config: any, handler: any) => {
    return originalRegisterTool(name, config, async (args: any, extra: any) => {
      const start = Date.now();
      const sessionId = extra?.sessionInfo?.sessionId
        ?? extra?.requestInfo?.headers?.['mcp-session-id']
        ?? null;
      const agentInfo = inferAgentFromSession(sessionId);
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
    });
  };

  // Register all tools and resources via domain modules
  const deps = buildToolDeps();

  registerArchitectureTools(mcpServer, deps);
  registerTerminalTools(mcpServer, deps);
  registerGraphTools(mcpServer, deps);
  registerDriftTools(mcpServer, deps);
  registerUITools(mcpServer, deps);
  registerSessionTools(mcpServer, deps);
  registerPlanTools(mcpServer, deps);
  registerPlanItemTools(mcpServer, deps);
  registerResources(mcpServer, deps);

  return mcpServer;
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
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === '/sse' && req.method === 'GET') {
      if (connectedTransports.size >= MAX_MCP_CONNECTIONS) {
        console.warn(`[MCP] Connection limit reached (${MAX_MCP_CONNECTIONS}), rejecting new SSE client`);
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Too many MCP connections' }));
        return;
      }

      const transport = new SSEServerTransport('/messages', res);
      const sessionId = transport.sessionId;
      connectedTransports.set(sessionId, transport);

      const mcpServer = setupMcpServerInstance();
      connectedServers.set(sessionId, mcpServer);

      // Auto-register session on connect
      const inferredAgentType = req.headers['user-agent']?.toString().split(' ')[0]?.toLowerCase().includes('claude')
        ? 'claude-code'
        : 'mcp-client';
      sessionService.registerSession(sessionId, inferredAgentType);

      res.on('close', () => {
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

    if (req.url?.startsWith('/messages') && req.method === 'POST') {
      const sessionId = new URL(req.url, `http://localhost:${boundPort}`).searchParams.get('sessionId');
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
    if (req.url === '/' || req.url === '/health') {
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
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { broadcast: bc } = require('../server');
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
