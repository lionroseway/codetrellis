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

  /**
   * The SSE session id this McpServer instance was bound to at connect
   * time. Stable for the lifetime of the connection. Tool handlers can
   * read this directly instead of fishing for it in the SDK's `extra`
   * argument, which doesn't reliably populate sessionInfo / headers
   * across all transports.
   */
  sessionId: string;

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
  externalPointerService: typeof import('../services/external-pointer-service');
  systemDocsService: typeof import('../services/system-docs-service');
  terminalService: typeof import('../services/terminal-service');
  planImportService: typeof import('../services/plan-import-service');
  presenceService: typeof import('../services/presence-service');
  projectConfigService: typeof import('../services/project-config-service');
  /**
   * Criteria, as an AGENT may use them: read, add (at `propose`), submit.
   * Deliberately a Pick — deciding, rewording, re-policying and deleting
   * need a person's `HumanDecision`, and are not reachable from here at
   * all (Phase 31 §4.3; human-decision.test.ts).
   */
  criteriaService: Pick<
    typeof import('../services/criteria-service'),
    'listCriteria' | 'getCriterion' | 'addCriterionAsAgent' | 'CriterionError'
  >;
  /**
   * Phase 31 §8 — the loops. `submitChecked` is the agent's ONLY way to
   * submit: it runs the mechanical checks and refuses evidence that fails
   * one, so the raw `submitCriterion` is not in the Pick above.
   */
  criterionLoop: Pick<
    typeof import('../services/criterion-loop-service'),
    'checkCriterion' | 'submitChecked' | 'getWorklist' | 'runCheckRun'
  >;
  /** Phase 31 §4.2 — record a file that matters; hashes kept current. */
  artefactService: Pick<
    typeof import('../services/artefact-service'),
    'recordArtefact' | 'refreshArtefactHashes' | 'listArtefacts' | 'ArtefactError'
  >;
  startArtefactWatching: typeof import('../services/artefact-watcher').startArtefactWatching;
  /** Phase 31 §5 — the Brief, and reading a material through us (§5.1). */
  briefService: Pick<typeof import('../services/brief-service'), 'getBrief' | 'listMaterials'>;
  readMaterial: typeof import('../services/material-reader/reader-host').readMaterial;

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
  setProjectAlias: typeof import('../services/recent-projects-service').setProjectAlias;
  refreshProjectOriginUrl: typeof import('../services/recent-projects-service').refreshProjectOriginUrl;
  getRecentProject: typeof import('../services/recent-projects-service').getRecentProject;
  findRecentProjectByOriginUrl: typeof import('../services/recent-projects-service').findRecentProjectByOriginUrl;
  getSettings: typeof import('../services/settings-service').getSettings;
  updateSettings: typeof import('../services/settings-service').updateSettings;
  tailLog: typeof import('../services/logger').tailLog;
  getCurrentLogPath: typeof import('../services/logger').getCurrentLogPath;
  getLogDir: typeof import('../services/logger').getLogDir;
  getBoundBackendPort: typeof import('../server').getBoundBackendPort;
  scanProject: typeof import('../server').scanProject;
  getActiveProjectPath: typeof import('../server').getActiveProjectPath;
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
