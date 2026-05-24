/**
 * Shared types for the MCP tool modules.
 *
 * Each tool module exports a `register(server, deps)` function that
 * receives a McpServer instance and a ToolDeps bag containing every
 * shared service / utility the tools may need. This avoids each
 * module importing from '../services/*' directly (which would create
 * a web of cross-imports) and makes testing straightforward.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/** Broadcast a typed event over the WS channel to all connected frontends. Returns subscriber count. */
export type BroadcastFn = (type: string, payload: Record<string, unknown>) => number;

/**
 * Pending async responses (screenshot, clipboard read, graph snapshot).
 * The MCP tool sets up a nonce + promise, broadcasts a request to the
 * frontend, and the frontend POSTs the result back via REST which
 * resolves the promise.
 */
export type PendingResponses = Map<string, {
  resolve: (data: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}>;

/**
 * Dependency bag passed to every tool registration module.
 * Add new services here rather than importing them in each tool file.
 */
export interface ToolDeps {
  broadcast: BroadcastFn;
  pendingResponses: PendingResponses;

  // Services — imported once in server.ts and passed through
  planService: typeof import('../services/plan-service');
  planItemService: typeof import('../services/plan-item-service');
  commentService: typeof import('../services/comment-service');
  sessionService: typeof import('../services/session-service');
  taskAttachmentsService: typeof import('../services/task-attachments-service');
  planEventService: typeof import('../services/plan-event-service');
  planFileService: typeof import('../services/plan-file-service');
  planChangesService: typeof import('../services/plan-changes-service');
  externalRefsService: typeof import('../services/external-refs-service');
  terminalService: typeof import('../services/terminal-service');
  planImportService: typeof import('../services/plan-import-service');
  presenceService: typeof import('../services/presence-service');
  projectConfigService: typeof import('../services/project-config-service');

  // Specific function imports (not full modules)
  applyTemplate: typeof import('../services/plan-templates-service').applyTemplate;
  listTemplates: typeof import('../services/plan-templates').listTemplates;
  publishPlanAsTemplate: typeof import('../services/plan-template-publish-service').publishPlanAsTemplate;
  getDeviations: typeof import('../services/deviation-service').getDeviations;
  resolveDeviation: typeof import('../services/deviation-service').resolveDeviation;
  detectDeviations: typeof import('../services/deviation-service').detectDeviations;
  captureCurrentTrellis: typeof import('../services/trellis-service').captureCurrentTrellis;
  listSnapshots: typeof import('../services/trellis-service').listSnapshots;
  computeTrellisDiff: typeof import('../services/trellis-service').computeTrellisDiff;
  saveNow: typeof import('../services/persistence').saveNow;
  exportDatabase: typeof import('../services/database').exportDatabase;
  searchSymbols: typeof import('../services/database').searchSymbols;
  getDependencyEdges: typeof import('../services/database').getDependencyEdges;
  getFileDependencies: typeof import('../services/database').getFileDependencies;
  getDbStats: typeof import('../services/database').getDbStats;
  getDb: typeof import('../services/database').getDb;
  listCrossSystemEdges: typeof import('../services/cross-system-service').listCrossSystemEdges;
  getCrossSystemStats: typeof import('../services/cross-system-service').getCrossSystemStats;
  listRecentProjects: typeof import('../services/recent-projects-service').listRecentProjects;
  removeRecentProject: typeof import('../services/recent-projects-service').removeRecentProject;
  setRecentProjectPinned: typeof import('../services/recent-projects-service').setRecentProjectPinned;
  getSettings: typeof import('../services/settings-service').getSettings;
  updateSettings: typeof import('../services/settings-service').updateSettings;
  tailLog: typeof import('../services/logger').tailLog;
  getCurrentLogPath: typeof import('../services/logger').getCurrentLogPath;
  getLogDir: typeof import('../services/logger').getLogDir;
  getBoundBackendPort: typeof import('../server').getBoundBackendPort;
  scanProject: typeof import('../server').scanProject;
  buildSkillGuide: typeof import('./skill-guide').buildSkillGuide;

  /**
   * Electron-only: capture a screenshot of the BrowserWindow via
   * `webContents.capturePage()`. Returns a base64-encoded PNG string.
   * Undefined in browser/web mode — the screenshot tool falls back to
   * the html-to-image broadcast path when this is not set.
   */
  captureElectronScreenshot?: () => Promise<string>;
}

/** Standard signature for a tool registration module. */
export type RegisterToolsFn = (server: McpServer, deps: ToolDeps) => void;
