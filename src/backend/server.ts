// [codemod] hoisted lazy requires → static namespace imports for bundling
// Before anything runs git: CodeTrellis's git never holds the person's index lock.
import './services/test-clock';
import './services/git-env';
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
import { PLAN_STATUSES, TASK_STATUSES, isPlanStatus, isTaskStatus } from '../shared/lib/plan-vocab';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { WebSocketServer, WebSocket } from 'ws';
import { scanDirectory, countFiles, collectFilePaths } from './services/project-scanner';
import { detectMonorepo } from './services/monorepo-detector';
import { initParser, parseFiles, parseVirtualFile, computeFileHash, getParserHealth, getParseableExtensions } from './services/ast-parser';
import { readBlobsAtCommit } from './services/git-blobs';
import { localAuthMiddleware, isUpgradeAuthorised } from './middleware/local-auth';
import { isSafeGitRef } from './services/git-safety';
import { readFileWithin, isWithin, isInside, ConfinementError } from './services/confined-fs';

/** Cap on /api/fs/browse output — a huge directory must not stall the backend. */
const MAX_BROWSE_ENTRIES = 1000;
import { resolveTrustedProjectRoot, resolveTrustedPlanDir, listTrustedRoots, setActiveProjectRoot, projectRelative } from './services/trusted-roots';
import { getCoverageReport } from './services/coverage-service';
import * as externalIntakeService from './services/external-intake-service';
import { initCapabilityToken, getTokenFilePath, getCapabilityToken } from './services/capability-token';
import { commitsByWorkstream } from './services/workstream-commits';
import { lineChangesFor, cleanRelPath, readWorkstreamCopy } from './services/line-changes';
import { normaliseSkills } from './services/skill-model';
import { listProjectSkills } from './services/skills-service';
import { skillProof, skillUseSources, sourceOf } from './services/skill-use-service';
import { pendingArrivals, planArrivals, acceptArrival, type SkillArrival } from './services/skill-arrival-service';
import { releaseSettled } from './services/signal-breakpoints';
import { listBreakpoints, getBreakpoint, setBreakpoint, clearBreakpoint, listHits, getHit, answerHit, cleanNote, BreakpointError, DECISIONS } from './services/breakpoint-service';
import { verifyRecord } from './services/record-chain';
import { startAgentEventLog, recordDecision, pruneAgentEvents, listAgentEvents, setEventPublisher, setRecordedListener, actingSession, workstreamOfItem, DEFAULT_LIMIT as AGENT_EVENTS_DEFAULT_LIMIT } from './services/agent-event-log';
import { stateAt } from './services/replay-state';
import { startReplayFrames, pruneFrames, setHeldProject, setFramePublisher, noteAgentActivity, requestFrame, noteRefsChanged, seedHeads, listFrames, DEFAULT_FRAME_LIMIT } from './services/replay-frames';
import { initDatabase, storeParsedFile, searchSymbols, getFileSymbols, getDbStats, getArchitectureSummary, resolveImports, getDependencyEdges, getFileDependencies, clearAstData, getAllFileHashes, removeStaleFiles, setImportResolutionContext } from './services/database';
import { startWatching } from './services/file-watcher';
import { startClaudeCodeWatcher, getWatcherStatus } from './agent/claude-code-watcher';
import { listWorkstreams, listWorkstreamPlaces, setClaudeSessionSource, setSymbolParser, getSymbolParser } from './services/workstream-service';
import { resolveSection, cleanBranch, workstreamOfBranch, whereWorked, worktreeDirFor, usableBase } from './services/section-workstreams';
import { suggestSectionBranch } from '../shared/lib/branch-name';
import { setWorkstreamChangesListener, setRefsChangedListener, setWorkstreamWatchStartedListener } from './services/workstream-watch-service';
import { setBranchWorkstreamsWarmedListener } from './services/branch-workstreams';
import { refreshSignals, refreshSignalsSoon, listSignals, setAwarenessListener, setSignalState } from './services/awareness-service';
import { withTold, setNoticeListener } from './services/awareness-notices';
import { recordReply, withReplies, cleanReply, setReplyReadListener, MAX_REPLY } from './services/awareness-replies';
import { listFolderRequests, takeFolderRequest, dismissFolderRequest, rememberDismissal, setFolderRequestsListener } from './services/folder-requests';
import { captureSnapshot, setBaseline, computeDiff, getBaseline, baselineLabel, restoreBaseline, setBaselineStore } from './services/diff-engine';
import { sqliteBaselineStore } from './services/baseline-store';
import { startMcpServer, getMcpStatus, getMcpConfig, getMcpSetup } from './mcp/server';
import { listWorktrees, listWorktreesWithPlans, createWorktree, WorktreeError } from './services/worktree-service';
import { checkoutGitDir, currentBranch, hasCommits, localBranches } from './services/git-checkout';
import { startAutoSave, saveNow } from './services/persistence';
import { exportDatabase } from './services/database';
import * as planService from './services/plan-service';
import * as budgetService from './services/budget-service';
import { compareSnapshots, comparandBranches, listComparands, readFileAt } from './services/snapshot-compare-service';
import { sourceControl, projectPrefix } from './services/source-control';
import { diffCommand, filesBetween, listRefs, sideLabel, worktreesForCompare } from './services/git-refs';
import { fetchRemotes, listBranches, startRemoteKeeper } from './services/git-branches';
import { fileHistory, FileHistoryError } from './services/file-history';
import { recordedKnowledge, isProjectRelativePath } from './services/commit-attribution';
import { lineHistory, LineHistoryError } from './services/line-history';
import { reviewPlan, renderReviewMarkdown, withArchitecture } from './services/plan-review-service';
import { reviewQueue } from './services/review-queue-service';
import { buildStack } from './services/stack-service';
import { buildPlayForward } from './services/play-forward';
import { resequence, tellAgents, leaveOverlap, OverlapActionError, noteApproval, approvalNotices, markNoticeSeen } from './services/planned-overlap-actions';
import { seriesFor, setRule, removeRule, startRun, dismissDue, recurrenceOf, RecurringError } from './services/recurring-service';
import { isRunAgent, setRunAgent, startRunAgent } from './services/recurring-agent';
import { rulesView, setRule as setArchitectureRule, removeRule as removeArchitectureRule, edgesIfLoaded, RuleError, rulesInConfig, rulebookProblems, moveRulesFromConfig, proposedRule, findRule } from './services/architecture-rules';
import type { RuleChange } from './services/rule-changes';
import { previewChange, previewJson, type RulePreview } from './services/rule-preview';
import { signRuleChange } from './services/rule-approvals';
import { architectureMarkdown, architectureOf } from './services/review-architecture';
import { lastMark, markReviewed, sinceLastLook } from './services/review-marks';
import { taskMarkdown, taskOutcome } from './services/review-task';
import { inScope, parseScope, scopeWords } from './services/rule-scope';
import { getCheckRun, listCheckRuns } from './services/check-runs';
import { taskRules } from './services/task-rules';
import { checkTheChange } from './services/change-check';
import { changedFiles } from './services/work-changes';
import { debtByRule, ruleHistory, suiteSummaries } from './services/rules-overview';
import { decideRuleProposal, getRuleProposal, listRuleProposals } from './services/rule-proposals';
import { writerId as taskRecordWriterId } from './services/task-records/shared-state';
import type { ArchitectureRule } from '../shared/types/architecture-rules';
import { startRecurringScheduler } from './services/recurring-scheduler';
import { draftArchitecture, buildPrDraft } from './services/pr-draft-service';
import { buildSignoffPack, renderPackHtml, verifyPack, packFromText, PackError } from './services/signoff-pack';
import { sealPack, checkSeal } from './services/pack-seal';
import { buildEvidence, sealEvidence, renderEvidenceHtml, verifyEvidence, evidenceFromText, EvidenceError, decisionsBetween } from './services/evidence';
import { planGitStatesFresh } from './services/item-git-state';
import { planStatusFresh } from './services/plan-status';
import { listSignedApprovals } from './services/signed-approvals';
import { allPlanArrivals } from './services/plan-arrivals';
import { forgetHostReads } from './services/review-host/host-state';
import { forgetReviewHostToken, getReviewHost, ReviewHostError, saveReviewHostToken, setReviewHost } from './services/review-host/switch';
import { listTestReports, listTestResults, testsSummary } from './services/tests/test-results';
import { groundingMap, groundingMapAt, groundingOf, NotAFileError } from './services/tests/grounding';
import { teammateRunSummaries } from './services/tests/teammate-runs';
import { taskGrounding } from './services/task-grounding';
import { getSharedTaskState, keepMyState, readAndTell, setRecordAppliedListener, setSharedMaterialReads, setSharedTaskState, setRunsChangedListener, setCheckRunsChangedListener, setSplitChangedListener, startRecordWatcher, stopRecordWatcher, trustTeammateKey, writeRecordFor } from './services/task-records/shared-state';
import { buildFileOverlay, relativeTo } from './services/plan-overlay-service';
import { buildPlaybackSequence } from './services/playback-service';
import * as commentService from './services/comment-service';
import * as sessionService from './services/session-service';
import * as taskAttachmentsService from './services/task-attachments-service';
// Phase 15 §C — unified Object/Action surface backing the V2 frontend.
import * as planItemService from './services/plan-item-service';
import { dependencyProblem } from './services/plan-dependencies';
import { listTaskWorkstreams } from './services/task-workstreams';
import { specRefProblem, setReliesOn, reliesOn, reliedOnBy, reliedOnWords, type SpecRef } from './services/spec-links-service';
import { withdrawProposals } from './services/spec-proposal-withdraw';
import { proposalProblem, proposeSpecChange, listProposals, getProposal, decisionProblem, decideProposal, specChangedFor, type ProposalStatus, type ProposalDecision } from './services/spec-proposals-service';
import * as planEventService from './services/plan-event-service';
import * as channelEventService from './services/channel-event-service';
import { exportChannelEvent } from './services/channel-event-file-service';
import { dispatchChannelEvent } from './services/channel-dispatcher-service';
import {
  recordProjectOpen,
  listRecentProjects,
  removeRecentProject,
  setRecentProjectPinned,
  getRecentProject,
} from './services/recent-projects-service';
import { discoverSystems, buildAliasMap } from './services/system-discovery';
// Top-of-file imports for everything that used to be lazy-required.
// Vite's Electron main bundle doesn't statically resolve runtime
// `_lazy___services____` paths, so they fail at runtime
// (MODULE_NOT_FOUND from inside `.vite/build/main.js`). Static
// imports get bundled cleanly. The original lazy-require pattern
// existed to dodge import cycles that no longer apply.
import { recomputeCrossSystemEdges, listCrossSystemEdges, getCrossSystemStats } from './services/cross-system-service';
import { getPlansFolder, linkPlansFolder, namePlansFolder, PlansFolderError, unlinkPlansFolder } from './services/plans-home';
import { setPlanImportedListener, startPlanFileWatcher, stopPlanFileWatcher, exportPlan, importPlan, discoverPlanDirs, unlinkPlan, getLinkedPlanDir, reconcilePlanState, pruneOrphanedDirs, exportIfSharedByDefault, exportOnFirstTitle, registerDiskHoldSettling } from './services/plan-file-service';
import { getAllGraphEdges, getDb } from './services/database';
import { getSettings, updateSettings, getAuthorKey, readGitIdentity, SettingsError } from './services/settings-service';
import { grantChange, grantRefusal, httpGrantsAllowed } from './services/grant-guard';
import { refusesLocalApiChange, LOCAL_API_CHANGES_REFUSAL } from './services/local-api-changes';
import * as criteriaService from './services/criteria-service';
import * as criterionLoop from './services/criterion-loop-service';
import * as artefactContent from './services/artefact-content-service';
import * as rendition from './services/rendition/rendition-service';
import * as artefactService from './services/artefact-service';
import * as _lazy___services_artefact_watcher from './services/artefact-watcher';
const startArtefactWatching = (a: Parameters<typeof _lazy___services_artefact_watcher.startArtefactWatching>[0]) =>
  _lazy___services_artefact_watcher.startArtefactWatching(a);
import { issueHumanDecision, issueUnverifiedDecision } from './services/human-decision';
import { cameFromAppWindow } from './services/ipc-dispatcher';
import { captureCurrentTrellis, listSnapshots, computeTrellisDiff, getSnapshot } from './services/trellis-service';
import { computeProjection } from './services/projection-service';
import { getDeviations, reconcileDeviations, DeviationError } from './services/deviation-service';
import * as presenceService from './services/presence-service';
import { applyTemplate, applyTemplateToPlan } from './services/plan-templates-service';
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
import { tailLog, getCurrentLogPath, getLogDir, isWritingLogFile, setLogRetention, pruneOldLogs } from './services/logger';
import { retentionDays, retentionWords } from './services/retention';
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
import { SETTABLE_SIGNAL_STATES, type SettableSignalState, type SignalStateBy } from '../shared/types';
import * as peerService from './services/peer-connection-service';
import { setDeviceCapabilities } from './services/paired-device-service';
import { listPeerAudit } from './services/peer-audit-service';

// Baselines survive a restart (Phase 32 §0.6, bug 9).
setBaselineStore(sqliteBaselineStore);

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

// Changes over the local API can be turned off (carried item 2b): then only
// the app window changes anything. Reads, MCP and the phone are unaffected.
app.use((req, res, next) => {
  const refused = refusesLocalApiChange(
    { method: req.method, path: req.path, fromAppWindow: cameFromAppWindow(req) },
    getSettings().mcp.acceptLocalApiChanges,
    httpGrantsAllowed(),
  );
  if (refused) { res.status(403).json({ error: LOCAL_API_CHANGES_REFUSAL }); return; }
  next();
});

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
// A kept-alive socket is closed by the server after `keepAliveTimeout`
// (Node's default: 5 s). A client that sends on it at that moment gets
// ECONNRESET: the browser suite's request context did, on a PUT sent about
// five seconds after its last call (#211). The window and the harness hold
// sockets open between calls, so the server keeps them for a minute; the
// header timeout must stay above it, or Node would close a slow request's
// socket first.
export const KEEP_ALIVE_MS = 65_000;
server.keepAliveTimeout = KEEP_ALIVE_MS;
server.headersTimeout = KEEP_ALIVE_MS + 1_000;

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
  // The agent waiting on the box gets it; with nobody waiting it is queued
  // for the next question (presence-service, bug 25).
  const nonce = presenceService.takeReplyWaiter();
  const resolver = (globalThis as any).__presenceResolve as
    ((nonce: string, data: string) => boolean) | undefined;
  const at = Date.now();
  const delivered = !!nonce && !!resolver && resolver(nonce, JSON.stringify({ text, at }));
  const reply = presenceService.postReply(text, { queue: !delivered });

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
  res.json({ branch: currentBranch(projectPath) });
});

// Every worktree of the opened project's repo, with the plans on each
// one's disk. Works from ANY checkout (see worktree-service for why
// /api/git/info below does not). Roots are derived from git, never taken
// from the request; the one the caller names is confined first.
app.get('/api/git/worktrees', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  res.json(listWorktreesWithPlans(projectRoot));
});

// The lines of parallel work in the project's repository: each working tree
// and the agents in it (Phase 32 A1.3). The TopBar strip reads this. Idle
// ones (no agent) only with ?idle=1. The root is confined like the route
// above; the folders come from git.
setClaudeSessionSource(() => getWatcherStatus().sessions);
// Each workstream's changed files are parsed for the symbols they touch (A1.5).
setSymbolParser((filePath, content) => parseVirtualFile(filePath, content)?.symbols ?? null);
// A watched workstream's changed files moved (A1.4): the strip refetches.
setWorkstreamChangesListener((folder, changes) => {
  broadcast('workstreams-changed', { root: folder, changedFiles: changes.files.length });
  scheduleSignalRefresh();
});
// A line of work newly watched (an agent connected, or a listing found it):
// its work so far is taken in, even with nothing changing after.
setWorkstreamWatchStartedListener(() => scheduleSignalRefresh());

// A branch moved (A1.7a): a branch workstream's footprint follows its ref.
setRefsChangedListener((repo) => {
  broadcast('workstreams-changed', { root: repo, refs: true });
  scheduleSignalRefresh();
  // B5.1: a checkout whose HEAD moved has had a commit land; replay takes a frame.
  noteRefsChanged();
});

// Branches worked out off the request path (HD4b) are ready: the window reads
// again, as when a branch moves.
setBranchWorkstreamsWarmedListener((repo) => {
  broadcast('workstreams-changed', { root: repo, refs: true });
  scheduleSignalRefresh();
});

// Signals follow the footprints (A1.6): recomputed shortly after a
// workstream's files move, and announced only when they change.
setAwarenessListener((projectRoot) => broadcast('awareness-changed', { projectRoot }));
setNoticeListener((projectRoot) => broadcast('awareness-changed', { projectRoot, told: true }));
setReplyReadListener((projectRoot) => broadcast('awareness-changed', { projectRoot, told: true }));
let signalTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSignalRefresh(): void {
  if (signalTimer) clearTimeout(signalTimer);
  signalTimer = setTimeout(() => {
    signalTimer = null;
    const root = getActiveProjectPath();
    if (root) refreshSignals(root).catch((err) => console.warn('[Awareness] refresh failed:', err));
  }, 500);
}

// Folders an agent reported that CodeTrellis has not opened (A1.7c). Shown
// to the person, who includes one only if it is a clone of this repository.
setFolderRequestsListener(() => broadcast('folder-requests-changed', {}));
app.get('/api/workstreams/folder-requests', (_req, res) => {
  res.json(listFolderRequests().map(({ id, folder, agentType, reportedAt }) => ({ id, folder, agentType, reportedAt })));
});

// Including a folder trusts it — a grant, so the person's alone, from the
// app window. The request is chosen by the id the server gave it, never by a
// path in the body. Only now, with consent, is anything read from the folder.
app.post('/api/workstreams/folder-requests/:id/include', (req, res) => {
  if (!mayGrant(req)) {
    res.status(403).json({ error: 'Only you can include a folder as a workstream — in the CodeTrellis app, from the workstreams strip.' });
    return;
  }
  const projectRoot = getActiveProjectPath();
  if (!projectRoot) { res.status(409).json({ error: 'No project is open to include it in.' }); return; }
  const request = takeFolderRequest(req.params.id);
  if (!request) { res.status(404).json({ error: 'No such request. It may already have been answered.' }); return; }
  let isDir = false;
  try { isDir = fs.statSync(request.folder).isDirectory(); } catch { /* gone */ }
  if (!isDir) {
    res.status(409).json({ included: false, reason: `${request.folder} is not a folder on this machine any more.` });
    return;
  }
  const { getNormalisedOriginUrl } = _lazy___services_git_identity;
  const ours = getRecentProject(projectRoot)?.originUrl ?? getNormalisedOriginUrl(projectRoot) ?? null;
  const theirs = getNormalisedOriginUrl(request.folder) ?? null;
  if (!ours || ours !== theirs) {
    rememberDismissal(request.folder);
    res.status(409).json({
      included: false,
      reason: ours
        ? `${path.basename(request.folder)} is not a clone of this repository (its origin is ${theirs ?? 'not set'}). Nothing was included, and it will not be asked about again.`
        : 'This project has no origin, so a clone of it cannot be recognised. Nothing was included.',
    });
    return;
  }
  recordProjectOpen(request.folder, currentBranch(request.folder));
  const active = new Set(sessionService.getActiveSessions().map((s) => s.sessionId));
  for (const sid of request.sessionIds) {
    if (active.has(sid)) sessionService.bindSession(sid, request.folder);
  }
  broadcast('mcp-session-changed', { reason: 'bound' });
  broadcast('workstreams-changed', { root: request.folder });
  res.json({ included: true, folder: request.folder });
});

app.post('/api/workstreams/folder-requests/:id/dismiss', (req, res) => {
  if (!dismissFolderRequest(req.params.id)) { res.status(404).json({ error: 'No such request.' }); return; }
  res.json({ dismissed: true });
});

// What a person should know about the parallel work in this project: open
// collisions and stale bases, most severe first (A1.6). Recomputed on read,
// so it is current even when no watcher has fired.
// Phase 32 B1: agent activity as it was recorded, oldest first — the
// Timeline's history after a reload, and the record replay will read.
// Read-only; filters by time, session or workstream.
app.get('/api/agent-events', (req, res) => {
  const num = (v: unknown) => (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : undefined);
  const text = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  res.json({
    events: listAgentEvents({
      since: num(req.query.since),
      before: num(req.query.before),
      sessionId: text(req.query.session),
      workstreamRoot: text(req.query.workstream),
      limit: num(req.query.limit) ?? AGENT_EVENTS_DEFAULT_LIMIT,
    }),
  });
});

// Phase 32 B10.1: the record, walked: whether every kept agent event still
// matches its link in the hash chain, and if not, which ones and how.
app.get('/api/record', (_req, res) => {
  res.json(verifyRecord());
});

// Phase 32 B5.1: a project's replay frames between two times, oldest
// first: why each was taken, by which session, at which commit, and whether
// its graph is the one before's. The graph itself is /api/trellis/:id.
app.get('/api/replay/frames', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  const num = (v: unknown) => (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : undefined);
  res.json({
    frames: listFrames(projectRoot, {
      from: num(req.query.from),
      to: num(req.query.to),
      limit: num(req.query.limit) ?? DEFAULT_FRAME_LIMIT,
    }),
  });
});

// Phase 32 B5.2: the project as it was at a moment: the frame then and how
// the graph differs from it now, each task's status, what was waiting on
// the person, and the signals open. `at` defaults to now.
app.get('/api/replay/state', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  const raw = req.query.at;
  if (raw !== undefined && (typeof raw !== 'string' || !/^\d+$/.test(raw))) {
    res.status(400).json({ error: 'at must be a time in milliseconds' });
    return;
  }
  const trim = (p: string) => p.replace(/[\\/]+$/, '');
  const holds = !scanInFlight && !!lastScannedProject && trim(lastScannedProject) === trim(projectRoot);
  res.json(stateAt(projectRoot, raw ? Number(raw) : Date.now(), holds));
});

// Answered from what is stored, at once: the window asks on every awareness
// change. Signals follow the watchers and the writes that move them, each of
// which refreshes them; this starts one more only if none is running, and the
// window hears `awareness-changed` if it moves anything. `fresh=1` waits for
// a refresh first, for a caller that has just changed something and must see
// it (an agent's get_awareness does the same). Neither holds other requests:
// git runs without blocking.
app.get('/api/awareness', async (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  if (req.query.fresh === '1') await refreshSignals(projectRoot);
  else refreshSignalsSoon(projectRoot);
  // With the agents told about each and what they said (A2.6).
  res.json({ signals: withReplies(withTold(listSignals(projectRoot))) });
});

// A person's answer to a signal (A1.8): acknowledged, intended, dismissed,
// or back to open. The project comes from the query and must be open; who
// answered comes from how the call arrived. Tagged, not blocked: plain HTTP
// may answer too, and the Awareness tab says it was not verified as you.
// Agents have no tool for this — a collision is not theirs to wave away.
app.post('/api/awareness/:id/state', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  const state = (req.body ?? {}).state;
  if (!(SETTABLE_SIGNAL_STATES as readonly unknown[]).includes(state)) {
    res.status(400).json({ error: `state must be one of: ${SETTABLE_SIGNAL_STATES.join(', ')}` });
    return;
  }
  const signal = setSignalState(projectRoot, req.params.id, state as SettableSignalState, actorFrom(req));
  if (!signal) { res.status(404).json({ error: 'No such open signal in this project.' }); return; }
  res.json(signal);
});
// A person's message to the agents about a signal (A4.1). Kept beside the
// signal and read by each agent in its workstreams on its next tool call;
// also a steer on the plan of each task an agent there holds. Who sent it
// comes from how the call arrived, as for an answer.
app.post('/api/awareness/:id/reply', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  const message = cleanReply((req.body ?? {}).message);
  if (!message) { res.status(400).json({ error: `message must be 1–${MAX_REPLY} characters.` }); return; }
  const reply = replyToSignalAsPerson(projectRoot, req.params.id, message, actorFrom(req));
  if (!reply) { res.status(404).json({ error: 'No such open signal in this project.' }); return; }
  res.status(201).json(reply);
});

app.get('/api/workstreams', async (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  res.json(await listWorkstreams(projectRoot, { includeIdle: req.query.idle === '1' }));
});

// Tasks worked as workstreams (Phase 32 A6.1): a session bound to a task by
// get_brief, for work that has no folder. The project must be open.
app.get('/api/workstreams/tasks', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  res.json(listTaskWorkstreams(projectRoot, { includeIdle: req.query.idle === '1' }));
});

// Each workstream's own commits since `since` (ms, at most a day back), by
// root: ◆ marks on its Timeline lane (Phase 32 B2.2). The project must be
// open; the folders and refs are the ones listWorkstreams found, never
// anything from the request.
app.get('/api/workstreams/commits', async (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  const now = Date.now();
  const asked = typeof req.query.since === 'string' && /^\d+$/.test(req.query.since) ? Number(req.query.since) : now - 2 * 60 * 60 * 1000;
  const since = Math.min(now, Math.max(now - 24 * 60 * 60 * 1000, asked));
  res.json({ since, commits: commitsByWorkstream(await listWorkstreams(projectRoot, { includeIdle: true }), since) });
});

// One file's changed lines in each workstream (Phase 32 B3.1): hunks against
// the merge base with main, the functions they fall in, committed or not.
// `workstream` picks one by id or branch among those listWorkstreams found,
// never a folder from the request; without it, every workstream changing the
// file. The copy is read through confined-fs with its folder as the root.
app.get('/api/workstreams/changes', async (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  const rel = cleanRelPath(req.query.path);
  if (!rel) { res.status(400).json({ error: 'path must be a file relative to the repository root.' }); return; }
  const named = typeof req.query.workstream === 'string' && req.query.workstream ? req.query.workstream : null;
  // The watched listing, not a fresh one: the code view asks on every file
  // it opens and on every awareness change, and the watchers keep it current.
  const workstreams = await listWorkstreams(projectRoot, { includeIdle: true });
  if (named && !workstreams.some((w) => w.root === named || w.branch === named)) {
    res.status(404).json({ error: `No workstream ${named} in this project.` });
    return;
  }
  res.json({ path: rel, changes: lineChangesFor(workstreams, rel, getSymbolParser(), { workstream: named, diff: req.query.diff === '1' }) });
});

// The skills the opened project has (Phase 32 C1): `.claude/skills/*/SKILL.md`,
// read through confined-fs, name and description from each front-matter.
app.get('/api/skills', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  res.json({ skills: listProjectSkills(projectRoot) });
});

// Branches and the OTHER worktrees of a project's repository, for the
// branch popover. services/git-checkout follows a linked worktree's `.git`
// file and reads packed refs; the previous hand-read of `.git/` did
// neither. The other checkouts come from `git worktree list`.
app.get('/api/git/info', (req, res) => {
  const projectPath = requireProjectPath(req, res);
  if (!projectPath) return;

  if (!checkoutGitDir(projectPath)) { res.json({ branches: [], worktrees: [], status: null }); return; }

  const worktrees = listWorktrees(projectPath)
    .filter((w) => !w.isCurrent && !w.bare)
    .map((w) => ({ path: w.path, branch: w.branch }));

  res.json({
    currentBranch: currentBranch(projectPath),
    branches: localBranches(projectPath),
    worktrees,
    hasCommits: hasCommits(projectPath),
  });
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

      const branch = currentBranch(session.cwd);

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
    const stats = await run;

    // Announce that the graph's data has been replaced.
    //
    // A scan truncates `files` and `imports` and repopulates them — the
    // AST tables hold one project at a time, as the conflict check above
    // says. So DURING a scan there are legitimately zero edges to serve,
    // and a canvas that fetches its edges in that window gets a perfectly
    // valid HTTP 200 carrying an empty array.
    //
    // The canvas fetched exactly once, when `scanStatus` became ready.
    // Nothing errored, nothing was logged, and the graph stayed blank
    // until the app was restarted, because the effect's inputs never
    // changed again. Found by opening four throwaway projects in a row
    // and then reopening the first one.
    //
    // This lives INSIDE scanProject rather than at the five call sites —
    // an HTTP endpoint, two MCP tools and two mobile RPCs. Announcing it
    // at each is how four of them end up not announcing it, which is
    // exactly the bug: the endpoint knew and the MCP path did not.
    broadcast('graph-data-changed', {
      projectPath,
      fileCount: stats.fileCount ?? null,
      symbolCount: stats.symbolCount ?? null,
    });

    return stats;
  } finally {
    scanInFlight = null;
  }
}

/**
 * Store parsed files without holding the server. About a millisecond each,
 * so a project of a few thousand files held every other request, the
 * window's included, for two seconds or more; this hands the event loop
 * back every 25 ms.
 */
async function storeParsedFiles(files: Awaited<ReturnType<typeof parseFiles>>, projectPath: string): Promise<void> {
  let since = Date.now();
  for (const parsed of files) {
    storeParsedFile(parsed, projectPath);
    if (Date.now() - since >= 25) {
      await new Promise<void>((r) => setImmediate(r));
      since = Date.now();
    }
  }
}

async function runScan(projectPath: string): Promise<ScanStats> {
    const isSameProject = lastScannedProject === projectPath;
    console.log(`[Scan] Scanning project: ${projectPath}${isSameProject ? ' (incremental)' : ' (full)'}`);

    try {
      const branchInfo = currentBranch(projectPath);
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
      await storeParsedFiles(parsedFiles, projectPath);
    } else {
      clearAstData();
      parsedFiles = await parseFiles(filePaths);
      await storeParsedFiles(parsedFiles, projectPath);
    }

    lastScannedProject = projectPath;
    // Publish to trusted-roots, which cannot import this module (cycle).
    // Anything deriving a project root from trusted state reads it there.
    setActiveProjectRoot(projectPath);
    // B5.1: each checkout's HEAD now, so the next move reads as a commit.
    seedHeads(projectPath);

    const systems = discoverSystems(projectPath);
    const aliasMap = buildAliasMap(systems);
    console.log(`[Scan] Discovered ${systems.length} systems, ${aliasMap.length} aliases`);

    resolveImports(projectPath, aliasMap, systems);
    setImportResolutionContext(projectPath, aliasMap, systems);

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
    // The baseline is the reference the diff compares against, so a RESCAN
    // of the same project keeps it: re-pinning emptied the diff, and was
    // labelled with the HEAD hash even over uncommitted work (bug 29).
    // Opening another project, or no baseline yet, sets one here — unless
    // this project has one stored from before a restart (bug 9).
    let current = getBaseline();
    if (!current || current.projectPath !== projectPath) current = restoreBaseline(projectPath);
    if (!current) {
      const head = getGitHeadCommit(projectPath);
      const status = getGitWorkingTreeStatus(projectPath);
      setBaseline(captureSnapshot(fileData, depEdges), {
        ...(head ?? {}),
        source: head?.commitHash ? 'scan' : 'working-tree',
        dirty: !!status && (status.staged.length + status.unstaged.length + status.untracked.length) > 0,
        projectPath,
      });
    } else {
      console.log('[Diff] Rescan of the same project: baseline kept');
    }

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
      // Awaited, like startWatching above — see startPlanFileWatcher.
      await startPlanFileWatcher(projectPath);
    } catch (err) {
      console.warn('[Scan] Plan file watcher failed to start:', err);
    }

    // Phase 32 C3.1 — teammates' task-state records, when this project shares them.
    try {
      await startRecordWatcher(projectPath);
      readAndTell(projectPath);
    } catch (err) {
      console.warn('[Scan] Task-state records were not read:', err);
    }

    // Phase 31 §4.4 — the recorded artefacts, so an approval taken on a
    // file notices when the file changes.
    try {
      const { startArtefactWatcherForProject } = _lazy___services_artefact_watcher;
      startArtefactWatcherForProject(projectPath);
    } catch (err) {
      console.warn('[Scan] Artefact watcher failed to start:', err);
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
/**
 * Does a plan item's file spec cover this project-relative path?
 *
 * Exact path, the destination of a move, or anything under a directory
 * spec. Separators are normalised because specs are authored by hand and
 * by agents on any platform.
 */
function fileSpecCovers(
  spec: { path: string; moveTo?: string; isDir?: boolean },
  relative: string,
): boolean {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  const target = norm(relative);
  for (const candidate of [spec.path, spec.moveTo].filter(Boolean) as string[]) {
    const c = norm(candidate);
    if (c === target) return true;
    if (target.startsWith(`${c}/`)) return true;
  }
  return false;
}

export function computeFileDrift(
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
    // Legacy tasks carry `affectedFiles`.
    const tasks = planService.getTasksByPlan(plan.uid);
    const matching = tasks.filter(
      (t) => t.affectedFiles.some((f) => f === relative || f === filePath),
    );

    // V2 action items carry `fileSpecs`, and this function never read them.
    //
    // Every plan created in the UI or imported from a ticket stores its
    // targets there, so on any modern plan the file header said
    // "Drift · unexpected" for every file the plan asked to change — right
    // above a gutter marking the same lines aligned. The sidebar and the
    // per-line verdict both go through the proposed-changes feed, which
    // reads both shapes; this was the one reader left on the old table.
    const items = planItemService.listAllItems(plan.uid).filter(
      (it) => it.kind === 'action' && (it.fileSpecs ?? []).some((fs) => fileSpecCovers(fs, relative)),
    );

    if (matching.length > 0 || items.length > 0) {
      planUids.push(plan.uid);
      for (const t of matching) taskUids.push(t.uid);
      for (const it of items) taskUids.push(it.uid);
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
    // The canvas's call. A scan truncates the tables before it refills them,
    // so while one runs "no edges" is not an answer: say so, and the canvas
    // keeps the graph it has. And say whose edges these are: the tables hold
    // one project at a time, and another window may have opened another
    // (frontend/lib/graph-answer.ts).
    if (scanInFlight) {
      res.status(503).set('Retry-After', '1').json({ scanning: true, project: scanInFlight.path });
      return;
    }
    const project = getActiveProjectPath();
    if (project) res.set('X-CodeTrellis-Project', encodeURIComponent(project));
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

  // The baseline and the files table hold one project at a time. While a
  // scan runs, or once another project was scanned, a diff of the tables
  // against this project is another project's files, and a canvas drew
  // them as ghost nodes (Phase 32 HD1). Say whose data this is instead,
  // as /api/dependencies does, and the canvas keeps the diff it has.
  const trimRoot = (p: string) => p.replace(/[\\/]+$/, '');
  if (scanInFlight) {
    res.json({ error: 'A scan is running; its changes come when it lands', scanning: true, project: scanInFlight.path });
    return;
  }
  const held = getActiveProjectPath();
  if (held) res.set('X-CodeTrellis-Project', encodeURIComponent(held));
  const heldElsewhere = !held || trimRoot(held) !== trimRoot(projectPath)
    || (baseline.projectPath != null && trimRoot(baseline.projectPath) !== trimRoot(projectPath));
  if (heldElsewhere) {
    res.json({ error: 'The server holds another project\'s files; scan this project to see its changes', otherProject: true, project: held ?? baseline.projectPath });
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

/** The baseline as the window and agents read it: where it came from, and a label that says so. */
function baselineView(b: NonNullable<ReturnType<typeof getBaseline>>) {
  return {
    id: 0,
    name: 'Baseline',
    commitHash: b.commitHash || null,
    shortCommitHash: b.shortCommitHash || null,
    source: b.source,
    dirty: b.dirty,
    capturedAt: b.capturedAt,
    label: baselineLabel(b),
    data: {
      files: [...b.files.entries()].map(([filePath, info]) => ({
        path: filePath,
        contentHash: info.hash,
        symbolCount: info.symbolCount,
      })),
      edges: [...b.edges].map((edge) => {
        const [source, target] = edge.split('->');
        return { source, target, specifiers: [] };
      }),
    },
  };
}

export class BaselineError extends Error {}

/**
 * Pin the baseline to a commit's own contents — HEAD when no commit is
 * named ("Pin current HEAD", which used to pin the working tree). A
 * project that is not a git repo pins its working tree. Used by the
 * capture route and by `set_baseline`, which used to change only the
 * window's label (bug 29).
 */
export async function pinBaseline(projectPath: string, commitHash?: string | null) {
  const head = getGitHeadCommit(projectPath);
  const ref = commitHash || head?.commitHash || null;
  if (ref) {
    // Checked before git sees it: a value starting with "-" is an option.
    if (!isSafeGitRef(ref)) throw new BaselineError(`"${String(ref).slice(0, 80)}" is not a commit`);
    const commitSnapshot = await captureGitCommitSnapshot(projectPath, ref);
    if (!commitSnapshot) throw new BaselineError(`No commit "${ref}" in this project`);
    setBaseline(commitSnapshot.snapshot, {
      commitHash: commitSnapshot.commitHash,
      shortCommitHash: commitSnapshot.shortCommitHash,
      source: 'commit',
      dirty: false,
      projectPath,
    });
  } else {
    const fileTree = scanDirectory(projectPath);
    const filePaths = collectFilePaths(fileTree);
    const parsedFiles = await parseFiles(filePaths);
    // Only what changed since the last scan is stored again: after a scan,
    // that is nothing, where it used to be every file in the project.
    const stored = getAllFileHashes();
    await storeParsedFiles(parsedFiles.filter((f) => stored.get(f.path) !== f.contentHash), projectPath);
    resolveImports(projectPath);
    const snapshot = captureSnapshot(parsedFiles.map((f) => ({
      path: path.relative(projectPath, f.path),
      hash: f.contentHash,
      symbolCount: f.symbols.length,
    })), getDependencyEdges());
    setBaseline(snapshot, { source: 'working-tree', dirty: false, projectPath });
  }
  return getBaseline()!;
}

app.get('/api/baseline', (_req, res) => {
  const baseline = getBaseline();
  if (!baseline) {
    res.status(404).json({ error: 'No baseline captured yet. Scan a project first.' });
    return;
  }
  res.json(baselineView(baseline));
});

app.post('/api/baseline/capture', async (req, res) => {
  const { projectPath: rawProjectPath, commitHash } = req.body || {};
  const projectPath = confineRoot(rawProjectPath, res, 'projectPath');
  if (!projectPath) return;
  if (commitHash !== undefined && commitHash !== null && typeof commitHash !== 'string') {
    res.status(400).json({ error: 'commitHash must be a string when provided' });
    return;
  }
  try {
    const baseline = await pinBaseline(projectPath, commitHash || null);
    broadcast('ui-set-baseline', { commitHash: baseline.commitHash ?? null });
    res.json(baselineView(baseline));
  } catch (err) {
    if (err instanceof BaselineError) { res.status(400).json({ error: err.message }); return; }
    throw err;
  }
});

// --- Plan API ---

// List plans
app.get('/api/plans', (req, res) => {
  const projectPath = optionalProjectRoot(req, res);
  if (projectPath === null) return;
  const status = req.query.status as string | undefined;
  // C2.6a — a plan that arrived through its files says from whom, as git says.
  const arrivals = allPlanArrivals();
  res.json(planService.listPlans(projectPath, status).map((p) => ({ ...p, arrival: arrivals.get(p.uid) ?? null })));
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
  const plan = planService.createPlan({ title, description: description || '', tasks: tasks || [] }, personFrom(req).author, personFrom(req).authorType, projectPath);
  const exported = exportIfSharedByDefault(plan.uid, projectPath);
  broadcast('plan-created', { plan, exported });
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

// Prune orphaned plan directories of an opened project. The project is
// confined like every other root; the body only SELECTS among that
// project's current orphans (see pruneOrphanedDirs).
app.post('/api/plans/prune-orphans', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  const { dirPaths } = req.body || {};
  if (!Array.isArray(dirPaths) || dirPaths.length === 0) {
    res.status(400).json({ error: 'dirPaths must be a non-empty array of orphaned plan directories' });
    return;
  }
  const { removed, skipped } = pruneOrphanedDirs(projectRoot, dirPaths);
  res.json({ ok: true, removed, skipped });
});

// Get plan
app.get('/api/plans/:uid', (req, res) => {
  const plan = planService.getPlan(req.params.uid);
  if (!plan) { res.status(404).json({ error: 'Plan not found' }); return; }
  res.json(plan);
});

/**
 * Who a person's write over REST is by, from how it arrived (Phase 32
 * §0.4d, owner's decision). The app window's IPC is the person. Plain HTTP
 * with the token could be a person in a browser or a script that read the
 * token, so it is recorded as `unverified`: it counts, and says what it is
 * wherever it is shown.
 *
 * Every REST handler that records an author takes it from here — never a
 * literal, and never from the request body. Authorship went wrong the same
 * way four times in Stage 0 (bugs 43, 47, 49 and the grant escalation), so
 * `authorship.test.ts` holds this file to it.
 */
export interface Person {
  author: string;
  authorType: 'human' | 'unverified';
}

function personFrom(req: express.Request): Person {
  return { author: getAuthorKey('human'), authorType: cameFromAppWindow(req) ? 'human' : 'unverified' };
}

/** The same person, in the shape decisions, budgets and freezes record. */
function actorFrom(req: express.Request) {
  return cameFromAppWindow(req)
    ? { actor: getAuthorKey('human'), actorType: 'human' as const, channel: 'desktop' as const }
    : { actor: getAuthorKey('human'), actorType: 'unverified' as const, channel: 'local-api' as const };
}

/**
 * A person's edit to a plan, from the app or the paired phone.
 *
 * One function for both, because the phone's copy had drifted: it stored any
 * status it was sent, never captured the approval baseline, and never told the
 * desktop windows, so a plan renamed on the phone kept its old name on screen
 * (Phase 32 §0.4j).
 */
export function updatePlanAsPerson(
  planUid: string,
  changes: Parameters<typeof planService.updatePlan>[1],
  by: { author: string; authorType: string },
): { plannedOverlaps: string[] } {
  const plan = planService.getPlan(planUid);
  if (!plan) throw new PlanRequestError(404, 'Plan not found');
  if (changes.status !== undefined && !isPlanStatus(changes.status)) {
    throw new PlanRequestError(400, `status must be one of: ${PLAN_STATUSES.join(', ')}`);
  }
  planService.updatePlan(planUid, changes, by.author, by.authorType);

  // A plan made in the window is held back while it is "Untitled plan" and
  // written into the project once it has a name (bug 48).
  if (changes.title !== undefined && plan.projectPath) {
    exportOnFirstTitle(planUid, plan.projectPath, plan.title);
  }

  // Auto-capture trellis snapshot when plan is approved
  if (changes.status === 'approved' && plan.projectPath) {
    try {
      const snapshot = captureCurrentTrellis(plan.projectPath, planUid, `Baseline for "${plan.title}"`);
      broadcast('trellis-captured', { snapshot: { id: snapshot.id, name: snapshot.name } });
    } catch (err) {
      console.warn('[API] Failed to capture trellis snapshot:', err);
    }
  }

  // B9.3b (G3): approving a plan says the planned overlaps it is in, once.
  let plannedOverlaps: string[] = [];
  if (changes.status === 'approved' && plan.status !== 'approved' && plan.projectPath) {
    const noted = noteApproval(plan.projectPath, planUid);
    plannedOverlaps = noted.overlaps;
    if (noted.noticeId !== null) broadcast('play-forward-changed', { project: plan.projectPath });
  }

  broadcast('plan-updated', { planUid, status: changes.status });
  saveNow(() => exportDatabase());
  return { plannedOverlaps };
}

/**
 * A person deletes a plan: archived, its files removed from the project unless
 * asked not to, and the windows told. The phone's delete used to archive the
 * row and stop — the plan stayed on the desktop's screen and its folder stayed
 * in the repository (Phase 32 §0.4j).
 */
export function deletePlanAsPerson(planUid: string, opts: { removeDisk?: boolean } = {}): { diskRemoved: boolean } {
  const plan = planService.getPlan(planUid);
  if (!plan) throw new PlanRequestError(404, 'Plan not found');
  planService.deletePlan(planUid);
  // A proposal to a page in a deleted plan cannot be decided (B7.4).
  if (withdrawProposals({ planUid }, 'The plan was deleted.')) { broadcast('spec-proposal-withdrawn', { planUid }); broadcast('breakpoints-changed', { planUid }); }

  // Also remove on-disk .codetrellis/plans/<slug>/ if the plan has a project path
  let diskRemoved = false;
  if (opts.removeDisk !== false && plan.projectPath) {
    try {
      const result = unlinkPlan(planUid, plan.projectPath);
      diskRemoved = result.removed;
    } catch { /* best-effort */ }
  }

  broadcast('plan-deleted', { planUid });
  saveNow(() => exportDatabase());
  return { diskRemoved };
}

export class PlanRequestError extends Error {
  constructor(readonly status: 400 | 404, message: string) { super(message); }
}

function sendPlanError(res: express.Response, err: unknown): void {
  if (err instanceof PlanRequestError) { res.status(err.status).json({ error: err.message }); return; }
  throw err;
}

// Update plan
app.put('/api/plans/:uid', (req, res) => {
  // Phase 15 §15.D — accept the git-context fields alongside the
  // existing title/description/status. Each is optional; missing
  // means "leave alone", `null` clears.
  const {
    title, description, status,
    baseRef, targetBranch, targetWorktree, autoCreateBranch,
  } = req.body;
  let result: ReturnType<typeof updatePlanAsPerson>;
  try {
    result = updatePlanAsPerson(
      req.params.uid,
      { title, description, status, baseRef, targetBranch, targetWorktree, autoCreateBranch },
      personFrom(req),
    );
  } catch (err) { sendPlanError(res, err); return; }
  res.json({ ok: true, ...(result.plannedOverlaps.length ? { plannedOverlaps: result.plannedOverlaps } : {}) });
});

// Delete (archive) plan
app.delete('/api/plans/:uid', (req, res) => {
  try {
    const { diskRemoved } = deletePlanAsPerson(req.params.uid, { removeDisk: req.query.disk !== 'false' });
    res.json({ ok: true, diskRemoved });
  } catch (err) { sendPlanError(res, err); }
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

// The V1 task REST routes (/api/plans/:uid/tasks*, /api/tasks/*) were retired
// in Phase 32 §0.4c-2: nothing live called them once the inspector's
// "Add to plan" moved to V2 (bug 21). Plan work is V2 plan items; see
// the unified surface below.

// The next thing to work on: a V2 Action when the plan has any.
app.get('/api/plans/:uid/next-task', (req, res) => {
  const task = planService.getNextTask(req.params.uid);
  res.json(task || { none: true });
});

/**
 * Phase 32 B6.1 — every pending task in the plan held by its dependencies,
 * with what each waits on and where, including tasks in other plans.
 */
app.get('/api/plans/:uid/waits', (req, res) => {
  if (!planService.getPlan(req.params.uid)) { res.status(404).json({ error: 'Plan not found' }); return; }
  res.json({ waits: planItemService.planWaits(req.params.uid) });
});

/**
 * Phase 32 C2.1 — each item's state from git, for any host or none:
 * building, pushed or merged, with the commit that proves it, from local
 * refs; nothing is fetched. C2.2b — where the person turned on a review
 * host for the project, what it says too (in review, closed), each state
 * with its source; otherwise no host is asked.
 */
app.get('/api/plans/:uid/git-state', async (req, res) => {
  const states = await planGitStatesFresh(req.params.uid);
  if (!states) { res.status(404).json({ error: 'Plan not found' }); return; }
  res.json(states);
});

/**
 * Phase 32 C2.4 — the plan's status, read and never written: every item's
 * state with its source (git or the review host for an item on a branch,
 * the plan itself for everything else, with who recorded it), and the one
 * view the window, the phone and get_plan share. No file is written.
 */
app.get('/api/plans/:uid/status', async (req, res) => {
  const status = await planStatusFresh(req.params.uid);
  if (!status) { res.status(404).json({ error: 'Plan not found' }); return; }
  res.json(status);
});

/**
 * Phase 32 C2.2a — a review host, per project, on this device. Off until the
 * person turns it on; turning it on and saving a token are grants (they widen
 * what the app reaches), so they come from the app window only. Turning it
 * off and forgetting a token narrow it, and anyone may. No request is made
 * here, and the token is never in a response.
 */
const REVIEW_HOST_WHERE = 'Settings → Review hosts';
function sendReviewHostError(res: express.Response, err: unknown): void {
  if (err instanceof ReviewHostError) { res.status(err.status).json({ error: err.message }); return; }
  throw err;
}
function changedBy(req: express.Request): string {
  const p = personFrom(req);
  return p.authorType === 'human' ? p.author : `${p.author} (unverified)`;
}

app.get('/api/review-host', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  res.json(getReviewHost(projectRoot));
});

app.put('/api/review-host', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  const enabled = req.body?.enabled;
  if (typeof enabled !== 'boolean') { res.status(400).json({ error: 'enabled must be true or false' }); return; }
  if (enabled && !mayGrant(req)) { res.status(403).json({ error: `Only you can turn on a review host — in the CodeTrellis app, ${REVIEW_HOST_WHERE}.` }); return; }
  try {
    const status = setReviewHost(projectRoot, enabled, changedBy(req));
    forgetHostReads();
    broadcast('review-host-changed', { project: projectRoot });
    res.json(status);
  } catch (err) { sendReviewHostError(res, err); }
});

app.put('/api/review-host/token', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  if (!mayGrant(req)) { res.status(403).json({ error: `Only you can save a review host's token — in the CodeTrellis app, ${REVIEW_HOST_WHERE}.` }); return; }
  try {
    const token: unknown = req.body?.token;
    const status = saveReviewHostToken(projectRoot, token);
    forgetHostReads();
    broadcast('review-host-changed', { project: projectRoot });
    res.json(status);
  } catch (err) { sendReviewHostError(res, err); }
});

// Phase 32 B8.1 — what the last test runs said. CodeTrellis never runs tests:
// these are the reports agents handed over (report_tests, a test criterion).
app.get('/api/tests', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  const match = typeof req.query.match === 'string' ? req.query.match.slice(0, 300) : undefined;
  res.json({
    summary: testsSummary(projectRoot),
    reports: listTestReports(projectRoot, 10),
    tests: listTestResults(projectRoot, { match, limit: 500 }),
    // D1.5a: teammates' latest runs, read from the plans folder.
    teammates: teammateRunSummaries(projectRoot),
  });
});

// Phase 32 B8.3a — every file's grounding at once, for the graph's overlay.
// The same answer per file as /api/tests/grounding.
app.get('/api/tests/grounding/map', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  // B8.4b — at a past moment, for replay: what was reported by then, on the graph as it was.
  if (req.query.at !== undefined) {
    const at = Number(req.query.at);
    if (!Number.isFinite(at) || at <= 0) { res.status(400).json({ error: 'at must be a time in ms' }); return; }
    res.json(groundingMapAt(projectRoot, at));
    return;
  }
  res.json(groundingMap(projectRoot));
});

// Phase 32 B8.2 — one file's tests: those whose file imports it, and whether
// they pass, fail, are older than the code, or there are none.
app.get('/api/tests/grounding', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  const file = typeof req.query.path === 'string' ? req.query.path : '';
  if (!file) { res.status(400).json({ error: 'path query param required' }); return; }
  try {
    res.json(groundingOf(projectRoot, file));
  } catch (err) {
    if (err instanceof ConfinementError) { res.status(400).json({ error: `${file} is not a file inside this project.` }); return; }
    if (err instanceof NotAFileError) { res.status(400).json({ error: err.message }); return; }
    throw err;
  }
});

// Phase 32 C3.1 — task state shared as records in the project's files. Per
// project, on this device; turning it on is the person's, as a grant.
const SHARED_STATE_WHERE = 'Settings → Shared task state';

app.get('/api/shared-task-state', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  res.json(getSharedTaskState(projectRoot));
});

app.put('/api/shared-task-state', async (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  const enabled = req.body?.enabled;
  const materialReads = req.body?.materialReads;
  if (enabled !== undefined && typeof enabled !== 'boolean') { res.status(400).json({ error: 'enabled must be true or false' }); return; }
  if (materialReads !== undefined && typeof materialReads !== 'boolean') { res.status(400).json({ error: 'materialReads must be true or false' }); return; }
  if (enabled === undefined && materialReads === undefined) { res.status(400).json({ error: 'enabled or materialReads (true or false) is required' }); return; }
  if (enabled && !mayGrant(req)) { res.status(403).json({ error: `Only you can share task state through the project's files — in the CodeTrellis app, ${SHARED_STATE_WHERE}.` }); return; }
  // C3.5 — teammates' material reads, a separate switch: on is the person's too.
  if (materialReads && !mayGrant(req)) { res.status(403).json({ error: `Only you can share which versions of materials your tasks read — in the CodeTrellis app, ${SHARED_STATE_WHERE}.` }); return; }
  let status = getSharedTaskState(projectRoot);
  if (enabled !== undefined) status = setSharedTaskState(projectRoot, enabled, changedBy(req));
  if (materialReads !== undefined) status = setSharedMaterialReads(projectRoot, materialReads, changedBy(req));
  // A change made right after this answer writes the first record: the
  // watcher must already be watching where it goes.
  if (enabled) await startRecordWatcher(projectRoot);
  broadcast('shared-task-state-changed', { project: projectRoot });
  res.json(status);
});

// C3.3 — trust a teammate's device key, introduced in the project's files,
// so the records it signs verify here. Trusting is the person's, as a grant;
// refusing one is anyone's. Keys are by device, so one decision covers every
// project that device shares into.
app.post('/api/shared-task-state/keys', (req, res) => {
  const { writer, fingerprint, trust } = req.body ?? {};
  if (typeof writer !== 'string' || typeof fingerprint !== 'string' || typeof trust !== 'boolean') {
    res.status(400).json({ error: 'writer, fingerprint and trust (true or false) are required' });
    return;
  }
  if (trust && !mayGrant(req)) { res.status(403).json({ error: `Only you can trust a teammate's key — in the CodeTrellis app, ${SHARED_STATE_WHERE}.` }); return; }
  const out = trustTeammateKey(writer, fingerprint, trust, changedBy(req));
  if (!out) { res.status(404).json({ error: 'No device has introduced that key in a project here.' }); return; }
  broadcast('shared-task-state-changed', { writer });
  for (const itemUid of out.rechecked) {
    const item = planItemService.getItem(itemUid);
    if (item) broadcast('plan-item-updated', { planUid: item.planUid, itemUid: item.uid, kind: item.kind, changes: { rechecked: true } });
  }
  res.json(out);
});

// Phase 32 C3.4a — where a project's plans live. Naming a plans folder in
// the committed config, and linking this device's copy of it, are the
// person's (grants); unlinking is anyone's. A link moves where plans,
// records and keys are read, so the watchers restart and what is there is
// imported.
const PLANS_FOLDER_WHERE = 'Settings → Plans folder';

async function rebindPlansFolder(projectRoot: string): Promise<number> {
  stopPlanFileWatcher(projectRoot);
  stopRecordWatcher(projectRoot);
  let imported = 0;
  for (const dir of discoverPlanDirs(projectRoot)) {
    try { importPlan(dir); imported++; } catch (err) { console.warn(`[PlansFolder] Import failed for ${dir}:`, err); }
  }
  await startPlanFileWatcher(projectRoot);
  await startRecordWatcher(projectRoot);
  readAndTell(projectRoot);
  broadcast('plans-folder-changed', { project: projectRoot });
  broadcast('plans-changed', { project: projectRoot });
  return imported;
}

app.get('/api/plans-folder', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  res.json(getPlansFolder(projectRoot));
});

app.put('/api/plans-folder', async (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  const raw = req.body?.folder;
  const folder = raw === null ? null : _lazy___services_project_config_service.parsePlansFolderRef(raw);
  if (raw !== null && !folder) { res.status(400).json({ error: 'folder must be { kind: "git", remote } or { kind: "synced", provider, place }, or null' }); return; }
  if (!mayGrant(req)) { res.status(403).json({ error: `Only you can choose where this project's plans live — in the CodeTrellis app, ${PLANS_FOLDER_WHERE}.` }); return; }
  namePlansFolder(projectRoot, folder);
  await rebindPlansFolder(projectRoot);
  res.json(getPlansFolder(projectRoot));
});

app.post('/api/plans-folder/link', async (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  if (!mayGrant(req)) { res.status(403).json({ error: `Only you can link a plans folder on this device — in the CodeTrellis app, ${PLANS_FOLDER_WHERE}.` }); return; }
  // The folder the person picked, not a root: linkPlansFolder takes it only
  // as a real directory that is a copy of the folder the config names.
  const rawFolder: unknown = req.body?.path;
  try {
    linkPlansFolder(projectRoot, rawFolder, changedBy(req));
  } catch (err) {
    if (err instanceof PlansFolderError) { res.status(400).json({ error: err.message }); return; }
    throw err;
  }
  const imported = await rebindPlansFolder(projectRoot);
  res.json({ ...getPlansFolder(projectRoot), imported });
});

app.delete('/api/plans-folder/link', async (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  unlinkPlansFolder(projectRoot);
  await rebindPlansFolder(projectRoot);
  res.json(getPlansFolder(projectRoot));
});

// Phase 32 C4.1 — recurring playbooks. A rule lives in the committed config,
// so setting or removing one is the person's (as naming a plans folder is);
// starting a run is anyone's, as making a plan is, and starting it twice is
// one run.
const RECURRING_WHERE = 'Settings → Recurring playbooks';

app.get('/api/recurring', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  res.json({ series: seriesFor(projectRoot) });
});

app.put('/api/recurring/:id', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  if (!mayGrant(req)) { res.status(403).json({ error: `Only you can make a playbook recur — in the CodeTrellis app, ${RECURRING_WHERE}.` }); return; }
  try {
    // The rule's own fields, by name: nothing else in the body reaches the config.
    const b = (req.body ?? {}) as Record<string, unknown>;
    const fields = { id: req.params.id, playbook: b.playbook, title: b.title, every: b.every, on: b.on, at: b.at, timeZone: b.timeZone, carryOver: b.carryOver, skills: b.skills };
    const rule = setRule(projectRoot, fields, changedBy(req));
    broadcast('recurring-changed', { project: projectRoot });
    res.json({ rule, series: seriesFor(projectRoot).find((s) => s.rule.id === rule.id) });
  } catch (err) {
    if (err instanceof RecurringError) { res.status(err.status).json({ error: err.message }); return; }
    throw err;
  }
});

// Phase 32 A7.1 — architecture rules: path boundaries the team keeps in
// committed files (`.codetrellis/rules/<suite>.yaml` since Phase 33 R1).
// Reading them, with what breaks each today, is anyone's; setting, stopping
// or moving one is the person's, as a plans folder is.
const RULES_WHERE = 'Rules view';

app.get('/api/rules', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  // C1: ?suite=, ?rule=, ?path= show part of the rulebook, as `check` scopes it.
  const scope = parseScope({ suite: req.query.suite, rule: req.query.rule, path: req.query.path });
  const views = rulesView(projectRoot, edgesIfLoaded(projectRoot, getActiveProjectPath(), getDependencyEdges)).filter((v) => inScope(v.rule, scope));
  // G7: each rule's debt (the baseline's count), and each suite with its status.
  const debt = debtByRule(projectRoot);
  res.json({
    rules: views.map((v) => ({ ...v, debt: debt.get(v.rule.id) ?? 0 })),
    suites: suiteSummaries(views, debt),
    ...(scope ? { scope: scopeWords(scope) } : {}),
    // Rules still in config.json, waiting for a person to move them (R1).
    inConfig: rulesInConfig(projectRoot).length,
    problems: rulebookProblems(projectRoot),
  });
});

// Phase 33 G7 — the history of changes to the project's rules, newest first.
app.get('/api/rules/history', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  res.json({ history: ruleHistory(projectRoot) });
});

// Phase 33 R1 — move the rules Phase 32 kept in config.json into the
// `architecture` suite file. A person's confirmed act, never automatic.
app.post('/api/rules/move-from-config', async (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  if (!mayGrant(req)) { res.status(403).json({ error: `Only you can move the architecture rules — in the CodeTrellis app's ${RULES_WHERE}.` }); return; }
  try {
    const moved = moveRulesFromConfig(projectRoot);
    broadcast('rules-changed', { project: projectRoot });
    const person = personFrom(req);
    recordDecision('rule_changed', { projectRoot, change: 'moved-from-config', ruleIds: moved, to: '.codetrellis/rules/architecture.yaml', author: person.author, authorType: person.authorType }, person.authorType);
    res.json({ moved, to: '.codetrellis/rules/architecture.yaml' });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Phase 33 R3 — what a change to a rule does, against the code, before a
// person confirms it: what becomes forbidden, what becomes allowed, and what
// breaks it today. Read only. `remove: true` previews stopping it.
function ruleBody(req: express.Request): Record<string, unknown> {
  const b = (req.body ?? {}) as Record<string, unknown>;
  // The rule's own fields, by name: nothing else in the body reaches the rulebook.
  return {
    id: req.params.id, suite: b.suite, from: b.from, mayNotImport: b.mayNotImport, except: b.except, because: b.because, strength: b.strength,
    // R5: a package rule's own fields; R6: a symbol rule's.
    ...(b.kind !== undefined ? { kind: b.kind } : {}), ...(b.package !== undefined ? { package: b.package } : {}), ...(b.only !== undefined ? { only: b.only } : {}),
    ...(b.symbol !== undefined ? { symbol: b.symbol } : {}), ...(b.calls !== undefined ? { calls: b.calls } : {}),
  };
}

function previewRuleChange(projectRoot: string, id: string, next: ArchitectureRule | null): RulePreview {
  return previewChange(projectRoot, id, next, edgesIfLoaded(projectRoot, getActiveProjectPath(), getDependencyEdges, undefined, next ? [next] : []));
}

app.post('/api/rules/:id/preview', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  try {
    const remove = (req.body as Record<string, unknown> | undefined)?.remove === true;
    if (remove && !findRule(projectRoot, req.params.id)) { res.status(404).json({ error: `No architecture rule "${req.params.id}" in this project` }); return; }
    const next = remove ? null : proposedRule(projectRoot, ruleBody(req), changedBy(req)).rule;
    res.json(previewJson(previewRuleChange(projectRoot, req.params.id, next)));
  } catch (err) {
    if (err instanceof RuleError) { res.status(err.status).json({ error: err.message }); return; }
    throw err;
  }
});

/** R3: a confirmed loosening, signed as the person; never throws, the change stands either way. */
function signLoosening(projectRoot: string, change: RuleChange, person: { author: string }): { file: string; how: string; as: string } | { error: string } {
  try {
    return signRuleChange(projectRoot, { rule: change.rule, before: change.before, after: change.after }, { writer: taskRecordWriterId(), name: person.author });
  } catch (err) {
    return { error: `The change is made, but it could not be signed (${(err as Error).message}); CI will hold it until it is.` };
  }
}

/**
 * R3 — make a person's change to a rule: a set (`raw`) or a stop (null). A
 * loosening needs `confirmed`, and is then signed as the person. Shared by
 * the person's own change and their acceptance of an agent's proposal.
 */
async function applyRuleChange(req: express.Request, projectRoot: string, id: string, raw: Record<string, unknown> | null, confirmed: boolean, extra: Record<string, unknown> = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  if (raw === null && !findRule(projectRoot, id)) return { status: 404, body: { error: `No architecture rule "${id}" in this project` } };
  const next = raw ? proposedRule(projectRoot, { ...raw, id }, changedBy(req)).rule : null;
  const { change } = previewRuleChange(projectRoot, id, next);
  // A loosening is confirmed after its preview, never by default.
  if (change?.effect === 'loosens' && !confirmed) {
    return {
      status: 409,
      body: { error: `${raw ? 'This loosens the rule' : 'Stopping a rule loosens it'}. Look at what it allows, then confirm it.`, needsConfirm: true, words: change.words, allowed: change.allowed },
    };
  }
  const person = personFrom(req);
  let rule: ArchitectureRule | null = null;
  if (raw) rule = setArchitectureRule(projectRoot, { ...raw, id }, changedBy(req));
  else removeArchitectureRule(projectRoot, id);
  const approval = change?.effect === 'loosens' ? signLoosening(projectRoot, change, person) : null;
  broadcast('rules-changed', { project: projectRoot });
  recordDecision('rule_changed', {
    projectRoot, ruleId: id, change: rule ? 'set' : 'stopped',
    ...(rule ? { suite: rule.suite, from: rule.from, mayNotImport: rule.mayNotImport, except: rule.except, because: rule.because, strength: rule.strength } : {}),
    effect: change?.effect ?? 'none', words: change?.words ?? null, approval: approval && 'file' in approval ? approval.file : null,
    ...extra, author: person.author, authorType: person.authorType,
  }, person.authorType);
  // A7.2 — work in flight is checked against the change at once.
  await refreshSignals(projectRoot).catch((err) => console.warn('[Awareness] refresh failed:', err));
  const view = rule ? rulesView(projectRoot, edgesIfLoaded(projectRoot, getActiveProjectPath(), getDependencyEdges)).find((v) => v.rule.id === id) : undefined;
  return { status: 200, body: { ...(rule ? { rule, view } : { removed: id }), ...(approval ? { approval } : {}) } };
}

app.put('/api/rules/:id', async (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  if (!mayGrant(req)) { res.status(403).json({ error: `Only you can set an architecture rule — in the CodeTrellis app's ${RULES_WHERE}.` }); return; }
  try {
    const confirmed = (req.body as Record<string, unknown> | undefined)?.confirm === true;
    const r = await applyRuleChange(req, projectRoot, req.params.id, ruleBody(req), confirmed);
    res.status(r.status).json(r.body);
  } catch (err) {
    if (err instanceof RuleError) { res.status(err.status).json({ error: err.message }); return; }
    throw err;
  }
});

app.delete('/api/rules/:id', async (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  if (!mayGrant(req)) { res.status(403).json({ error: `Only you can stop an architecture rule — in the CodeTrellis app's ${RULES_WHERE}.` }); return; }
  try {
    const r = await applyRuleChange(req, projectRoot, req.params.id, null, req.query.confirm === '1');
    res.status(r.status).json(r.body);
  } catch (err) {
    if (err instanceof RuleError) { res.status(err.status).json({ error: err.message }); return; }
    throw err;
  }
});

// Phase 33 C7 — every check is a run: this device's, and teammates' latest
// read from the plans folder, each saying where it ran and by whom.
app.get('/api/check-runs', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  const limit = Number(req.query.limit ?? 50);
  res.json({ runs: listCheckRuns(projectRoot, Number.isFinite(limit) ? limit : 50) });
});

// Phase 33 G9 — run a check from the app: the same check `codetrellis check`
// runs, over this work's changed files since its base, at any scope, kept
// as a run like every other.
app.post('/api/check-runs', async (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  const b = (req.body ?? {}) as Record<string, unknown>;
  const given = typeof b.base === 'string' && b.base.trim() ? b.base.trim() : undefined;
  if (given !== undefined && !isSafeGitRef(given)) { res.status(400).json({ error: 'base must be a commit or a branch name' }); return; }
  let changed;
  try { changed = changedFiles(projectRoot, given, {}); } catch (err) { res.status(400).json({ error: (err as Error).message }); return; }
  const person = personFrom(req);
  const r = await checkTheChange({
    root: projectRoot, paths: changed.files.slice(0, 500), ...(changed.since ? { base: changed.since } : {}), strict: b.strict === true,
    scope: { suite: b.suite, rule: b.rule, path: b.path },
    by: person, ranIn: person.authorType === 'human' ? 'the app' : 'the local API',
    activeProject: getActiveProjectPath(), checkCriterion: (uid) => criterionLoop.checkCriterion(uid),
  });
  if ('error' in r) { res.status(400).json({ error: r.error }); return; }
  res.json({ ...r.result, base: changed.base });
});

app.get('/api/check-runs/:id', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  const run = getCheckRun(projectRoot, req.params.id);
  if (!run) { res.status(404).json({ error: 'No such check run in this project' }); return; }
  res.json(run);
});

// Phase 33 R3 — agents' proposals (`propose_rule`), each with what it would do now.
app.get('/api/rules/proposals', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  const edges = edgesIfLoaded(projectRoot, getActiveProjectPath(), getDependencyEdges);
  const proposals = listRuleProposals(projectRoot).map((p) => {
    if (p.status !== 'open') return { ...p, now: null };
    // Said again against the code and rules as they are now: either may have moved since it was proposed.
    try {
      const next = p.body ? proposedRule(projectRoot, { ...p.body, id: p.ruleId }, p.author).rule : null;
      if (!next && !findRule(projectRoot, p.ruleId)) return { ...p, now: { words: `The rule ${p.ruleId} is already gone.`, change: null, breaches: null, needsConfirm: false } };
      return { ...p, now: previewJson(previewChange(projectRoot, p.ruleId, next, edges)) };
    } catch (err) {
      return { ...p, now: { words: err instanceof RuleError ? err.message : String(err), change: null, breaches: null, needsConfirm: false } };
    }
  });
  res.json({ proposals });
});

app.post('/api/rules/proposals/:uid/decide', async (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  if (!mayGrant(req)) { res.status(403).json({ error: `Only you can decide a proposed rule — in the CodeTrellis app's ${RULES_WHERE}.` }); return; }
  const p = getRuleProposal(req.params.uid);
  if (!p || p.projectRoot !== projectRoot) { res.status(404).json({ error: 'No such proposal in this project' }); return; }
  if (p.status !== 'open') { res.status(409).json({ error: `This proposal was already ${p.status}.` }); return; }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const note = typeof b.note === 'string' ? b.note.slice(0, 500) : null;
  const person = personFrom(req);
  if (b.decision === 'reject') {
    const decided = decideRuleProposal(p.uid, 'rejected', person, note);
    recordDecision('rule_changed', { projectRoot, proposal: p.uid, ruleId: p.ruleId, change: 'proposal_rejected', proposedBy: p.author, author: person.author, authorType: person.authorType }, person.authorType);
    broadcast('rules-changed', { project: projectRoot });
    res.json({ proposal: decided });
    return;
  }
  if (b.decision !== 'accept') { res.status(400).json({ error: 'decision must be accept or reject' }); return; }
  try {
    // Accepting is the person's change, made as if they made it: a loosening is confirmed and signed.
    const r = await applyRuleChange(req, projectRoot, p.ruleId, p.body, b.confirm === true, { proposal: p.uid, proposedBy: p.author });
    if (r.status !== 200) { res.status(r.status).json(r.body); return; }
    const decided = decideRuleProposal(p.uid, 'accepted', person, note);
    res.json({ ...r.body, proposal: decided });
  } catch (err) {
    if (err instanceof RuleError) { res.status(err.status).json({ error: err.message }); return; }
    throw err;
  }
});

app.delete('/api/recurring/:id', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  if (!mayGrant(req)) { res.status(403).json({ error: `Only you can stop a playbook recurring — in the CodeTrellis app, ${RECURRING_WHERE}.` }); return; }
  try {
    removeRule(projectRoot, req.params.id);
    broadcast('recurring-changed', { project: projectRoot });
    res.json({ removed: req.params.id });
  } catch (err) {
    if (err instanceof RecurringError) { res.status(err.status).json({ error: err.message }); return; }
    throw err;
  }
});

// C4.3b — on this device, start an agent on each run of a rule: the person's
// alone, since it starts a process here. `agent` is claude, codex, or null (off).
const RUN_AGENT_NOT_HERE = 'the run was started over plain HTTP; only you in the app, the schedule, or a phone allowed to open terminals start one';
app.put('/api/recurring/:id/agent', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  if (!mayGrant(req)) { res.status(403).json({ error: `Only you can have an agent start on each run — in the CodeTrellis app, ${RECURRING_WHERE}.` }); return; }
  const agent = (req.body ?? {}).agent;
  if (agent !== null && !isRunAgent(agent)) { res.status(400).json({ error: 'agent must be claude, codex or null' }); return; }
  try {
    const series = seriesFor(projectRoot).find((s) => s.rule.id === req.params.id);
    if (!series) { res.status(404).json({ error: `No recurring playbook "${req.params.id}" in this project` }); return; }
    setRunAgent(projectRoot, req.params.id, agent, changedBy(req));
    broadcast('recurring-changed', { project: projectRoot });
    res.json({ series: seriesFor(projectRoot).find((s) => s.rule.id === req.params.id) });
  } catch (err) {
    if (err instanceof RecurringError) { res.status(err.status).json({ error: err.message }); return; }
    throw err;
  }
});

app.post('/api/recurring/:id/start', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  try {
    const who = personFrom(req);
    const run = startRun(projectRoot, req.params.id, who);
    // C4.3b — its agent, when the rule has one on this device: from the app
    // window, never from plain HTTP (loopback is not a person).
    const agent = run.created
      ? startRunAgent(projectRoot, req.params.id, run.plan, who.authorType === 'human' ? true : RUN_AGENT_NOT_HERE, (session) => broadcast('terminal-created', { session }))
      : null;
    if (run.created) {
      broadcast('plan-created', { plan: run.plan });
      broadcast('recurring-changed', { project: projectRoot });
    }
    res.json({ planUid: run.plan.uid, title: run.plan.title, created: run.created, recurrence: run.info, agent });
  } catch (err) {
    if (err instanceof RecurringError) { res.status(err.status).json({ error: err.message }); return; }
    throw err;
  }
});

// C4.2b — which series a plan is a run of. The root is the stored plan's,
// never the request's.
app.get('/api/plans/:uid/recurrence', (req, res) => {
  const plan = planService.getPlan(req.params.uid);
  if (!plan) { res.status(404).json({ error: 'Plan not found' }); return; }
  if (!plan.projectPath) { res.json({ recurrence: null }); return; }
  res.json({ recurrence: recurrenceOf(plan.projectPath, plan.uid) });
});

// C4.2a — "Not this time": the due run is left unstarted on this device, and
// reads missed once its period ends. Only hides the question here.
app.post('/api/recurring/:id/dismiss', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  try {
    const out = dismissDue(projectRoot, req.params.id, changedBy(req));
    broadcast('recurring-changed', { project: projectRoot });
    res.json(out);
  } catch (err) {
    if (err instanceof RecurringError) { res.status(err.status).json({ error: err.message }); return; }
    throw err;
  }
});

// C3.2 — keep this machine's state of a task people set two ways at once.
app.post('/api/items/:uid/keep-state', (req, res) => {
  const out = keepMyState(req.params.uid, personFrom(req));
  if (!out.ok) { res.status(out.status).json({ error: out.error }); return; }
  const item = planItemService.getItem(req.params.uid);
  if (item) broadcast('plan-item-updated', { planUid: item.planUid, itemUid: item.uid, kind: item.kind, changes: { settled: true } });
  res.json({ settled: true, record: out.file });
});

app.delete('/api/review-host/token', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  const status = forgetReviewHostToken(projectRoot);
  forgetHostReads();
  broadcast('review-host-changed', { project: projectRoot });
  res.json(status);
});

/** Delete a task attachment. */
app.delete('/api/attachments/:uid', (req, res) => {
  const ok = taskAttachmentsService.deleteAttachment(req.params.uid);
  if (!ok) { res.status(404).json({ error: 'Attachment not found' }); return; }
  broadcast('task-attachment-removed', { uid: req.params.uid });
  saveNow(() => exportDatabase());
  res.json({ ok: true });
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

/**
 * The skills in effect on an item, own and inherited, each with the item it
 * comes from (Phase 32 C1.2) and whether it was used (C1.3). For people: a
 * link location is included.
 */
app.get('/api/items/:uid/skills', (req, res) => {
  const item = planItemService.getItem(req.params.uid);
  if (!item) { res.status(404).json({ error: 'Item not found' }); return; }
  const rows = planItemService.resolveSkillsWithSource(item);
  // C1.3: whether each was used, once an agent has worked the task.
  const proof = skillProof(item, rows.map((r) => r.skill));
  // A8.4: how each use was seen.
  const sources = skillUseSources(item.uid);
  // C1.4: a skill that arrived in a plan file and waits for a person, with who added it.
  const waiting = new Map<string, Map<string, SkillArrival>>();
  const pendingOf = (uid: string) => { if (!waiting.has(uid)) waiting.set(uid, pendingArrivals(uid)); return waiting.get(uid)!; };
  res.json({ skills: rows.map((r) => {
    const p = proof?.get(r.skill.name) ?? null;
    return { ...r, proof: p, proofSource: p === 'used' ? sourceOf(sources, r.skill.name) : null, pending: pendingOf(r.fromUid).get(r.skill.name) ?? null };
  }) });
});

/**
 * Who may work an item, how, and within what limits, as in effect: claim
 * policy, execution settings, guardrails and skills, each with the item it
 * comes from (null: the default). The window's tree holds item summaries,
 * without these, so it cannot work out what a task inherits itself.
 */
app.get('/api/items/:uid/routing', (req, res) => {
  const item = planItemService.getItem(req.params.uid);
  if (!item) { res.status(404).json({ error: 'Item not found' }); return; }
  res.json({
    claimPolicy: planItemService.resolveClaimPolicyWithSource(item),
    executionConfig: planItemService.resolveExecutionConfigWithSource(item),
    constraints: planItemService.resolveConstraintsWithSource(item),
    skills: planItemService.resolveSkillsWithSource(item),
  });
});

/**
 * Which worktree an item is worked in (Phase 32 C5.1): its own branch, and
 * the section's in effect (its own or inherited), with where that is.
 */
/**
 * Phase 32 B7.1 — spec links. For a task, the pages (or sections) it relies
 * on; for a page, every task relying on it in any plan of its project,
 * optionally one section (`?section=<slug>`).
 */
app.get('/api/items/:uid/spec-links', (req, res) => {
  const item = planItemService.getItem(req.params.uid);
  if (!item) { res.status(404).json({ error: 'Item not found' }); return; }
  const section = typeof req.query.section === 'string' && req.query.section ? req.query.section : undefined;
  const by = item.kind === 'object' ? reliedOnBy(item.uid, section) : [];
  res.json({ uid: item.uid, kind: item.kind, reliesOn: reliesOn(item.uid), reliedOnBy: by, words: reliedOnWords(by), specChanged: specChangedFor(item.uid) });
});

/** Set what a task relies on: `{ reliesOn: [{ page, section? }] }`, replacing the list. The author is how the call arrived. */
app.put('/api/items/:uid/relies-on', (req, res) => {
  const item = planItemService.getItem(req.params.uid);
  if (!item) { res.status(404).json({ error: 'Item not found' }); return; }
  const raw = req.body?.reliesOn;
  if (!Array.isArray(raw) || raw.some((r) => !r || typeof r.page !== 'string' || (r.section !== undefined && typeof r.section !== 'string'))) {
    res.status(400).json({ error: 'reliesOn must be a list of { page, section? }' });
    return;
  }
  const refs = raw.map((r: SpecRef) => ({ page: r.page, section: r.section || undefined }));
  const problem = specRefProblem(item.uid, refs);
  if (problem) { res.status(400).json({ error: problem }); return; }
  setReliesOn(item.uid, refs, personFrom(req));
  broadcast('plan-item-updated', { planUid: item.planUid, itemUid: item.uid, kind: item.kind, changes: { reliesOn: refs } });
  saveNow(() => exportDatabase());
  res.json({ uid: item.uid, reliesOn: reliesOn(item.uid) });
});

/**
 * Phase 32 B7.2 — propose a change to a spec page (whole, or one section by
 * heading slug): `{ section?, text, why, evidence? }`. The page is not
 * changed; the proposal lists who relies on it. The author is how the call
 * arrived.
 */
app.post('/api/items/:uid/spec-proposals', (req, res) => {
  const b = req.body ?? {};
  if (typeof b.text !== 'string' || typeof b.why !== 'string' || (b.section !== undefined && typeof b.section !== 'string')) {
    res.status(400).json({ error: 'text and why are required; section is a heading slug' });
    return;
  }
  const evidence = b.evidence && typeof b.evidence === 'object' ? b.evidence : undefined;
  const input = { page: req.params.uid, section: b.section || undefined, text: b.text, why: b.why, evidence };
  const problem = proposalProblem(input);
  if (problem) { res.status(400).json({ error: problem }); return; }
  const proposal = proposeSpecChange(input, { ...personFrom(req), sessionId: null });
  broadcast('spec-proposal-created', { proposal });
  saveNow(() => exportDatabase());
  res.json(proposal);
});

/** Proposed spec changes, newest first: `?page=<uid>`, or an opened `?project=`; `&status=`. */
app.get('/api/spec-proposals', (req, res) => {
  const status = typeof req.query.status === 'string' && ['open', 'accepted', 'rejected', 'withdrawn'].includes(req.query.status)
    ? req.query.status as ProposalStatus : undefined;
  const pageUid = typeof req.query.page === 'string' && req.query.page ? req.query.page : undefined;
  if (pageUid) { res.json({ proposals: listProposals({ pageUid, status }) }); return; }
  const projectPath = requireProjectRoot(req, res);
  if (!projectPath) return;
  res.json({ proposals: listProposals({ projectPath, status }) });
});

app.get('/api/spec-proposals/:uid', (req, res) => {
  const proposal = getProposal(req.params.uid);
  if (!proposal) { res.status(404).json({ error: 'No such proposal' }); return; }
  res.json(proposal);
});

/**
 * A person decides a proposal (Phase 32 B7.4): `{ decision: "accept" | "amend" | "reject", text?, note? }`.
 * Amend needs the text as it should read. The decider is how the call arrived; no MCP tool can do this.
 */
app.post('/api/spec-proposals/:uid/decision', (req, res) => {
  const input = {
    uid: req.params.uid,
    decision: req.body?.decision as ProposalDecision,
    text: typeof req.body?.text === 'string' ? req.body.text : undefined,
    note: typeof req.body?.note === 'string' ? req.body.note : undefined,
  };
  if (!getProposal(input.uid)) { res.status(404).json({ error: 'No such proposal' }); return; }
  const problem = decisionProblem(input);
  if (problem) { res.status(problem.includes('already') ? 409 : 400).json({ error: problem }); return; }
  const who = personFrom(req);
  const { proposal, flagged } = decideProposal(input, { author: who.author, authorType: who.authorType });
  broadcast('spec-proposal-decided', { uid: proposal.uid, status: proposal.status, pageUid: proposal.pageUid });
  if (proposal.hitRef) broadcast('breakpoint-answered', { ref: proposal.hitRef, planUid: proposal.planUid, decision: proposal.status === 'rejected' ? 'stop' : 'continue' });
  if (proposal.status === 'accepted') broadcast('plan-item-updated', { planUid: proposal.planUid, itemUid: proposal.pageUid, kind: 'object', changes: { body: true } });
  saveNow(() => exportDatabase());
  res.json({ proposal, flagged: flagged.map((t) => ({ itemUid: t.itemUid, title: t.title, planTitle: t.planTitle })) });
});

app.get('/api/items/:uid/workstream', async (req, res) => {
  const item = planItemService.getItem(req.params.uid);
  if (!item) { res.status(404).json({ error: 'Item not found' }); return; }
  const root = getActiveProjectPath();
  let workstreams: Awaited<ReturnType<typeof listWorkstreamPlaces>> = [];
  try { workstreams = root ? await listWorkstreamPlaces(root) : []; } catch { /* no git */ }
  const section = resolveSection(item, planItemService.getItem);
  res.json({
    own: item.workstream ?? null,
    section,
    where: section ? whereWorked(section.branch, workstreams) : null,
    root: section ? workstreamOfBranch(section.branch, workstreams)?.root ?? null : null,
  });
});

/**
 * Set or clear the worktree a section is worked in: `{ workstream: "<branch>" | null }`.
 * The branch must be a workstream CodeTrellis knows; the root is never the
 * request's. The author is how the call arrived.
 */
app.put('/api/items/:uid/workstream', async (req, res) => {
  const item = planItemService.getItem(req.params.uid);
  if (!item) { res.status(404).json({ error: 'Item not found' }); return; }
  const raw = req.body?.workstream;
  let branch: string | null = null;
  if (raw !== null) {
    const root = getActiveProjectPath();
    let workstreams: Awaited<ReturnType<typeof listWorkstreamPlaces>> = [];
    try { workstreams = root ? await listWorkstreamPlaces(root) : []; } catch { /* no git */ }
    branch = cleanBranch(raw);
    if (!branch || !workstreamOfBranch(branch, workstreams)) {
      res.status(400).json({ error: 'workstream must be the branch of a known workstream, or null' });
      return;
    }
  }
  const updated = planItemService.updateItem(item.uid, {
    workstream: branch,
    changeSummary: branch ? `Worked on ${branch}` : 'Worked in any worktree',
    ...personFrom(req),
  });
  if (!updated) { res.status(404).json({ error: 'Item not found' }); return; }
  broadcast('plan-item-updated', { planUid: updated.planUid, itemUid: updated.uid, kind: updated.kind, changes: { workstream: branch } });
  saveNow(() => exportDatabase());
  res.json({ own: updated.workstream ?? null, section: resolveSection(updated, planItemService.getItem) });
});

/**
 * "Work this section in a new worktree" (Phase 32 C5.2): a new branch (the
 * one given, or one named after the plan and the section) from the plan's
 * base, in a new folder beside the project, and the section assigned to it.
 * It makes a folder on the person's machine, so it is the person's: the app
 * window, or a test backend. The folder and the root are never the
 * request's; the branch is checked, and nothing that exists is reused.
 */
app.post('/api/items/:uid/worktree', (req, res) => {
  if (!mayGrant(req)) {
    res.status(403).json({ error: 'Making a worktree creates a folder on your machine, so it is done from the CodeTrellis window.' });
    return;
  }
  const item = planItemService.getItem(req.params.uid);
  if (!item) { res.status(404).json({ error: 'Item not found' }); return; }
  const root = getActiveProjectPath();
  if (!root) { res.status(409).json({ error: 'Open the project first' }); return; }
  const plan = planService.getPlan(item.planUid);
  const branch = req.body?.branch === undefined || req.body?.branch === ''
    ? cleanBranch(suggestSectionBranch(plan?.title ?? '', item.title))
    : cleanBranch(req.body.branch);
  if (!branch) { res.status(400).json({ error: 'branch must be a branch name: letters, digits, ".", "_", "-" and "/", not starting with "-"' }); return; }
  const dir = worktreeDirFor(root, branch);
  const base = usableBase(plan?.baseRef);
  try {
    createWorktree(root, { branch, dir, base });
  } catch (err) {
    if (err instanceof WorktreeError) { res.status(err.status).json({ error: err.message }); return; }
    throw err;
  }
  const updated = planItemService.updateItem(item.uid, {
    workstream: branch,
    changeSummary: `Worked on ${branch}, in a new worktree`,
    ...personFrom(req),
  });
  if (updated) broadcast('plan-item-updated', { planUid: updated.planUid, itemUid: updated.uid, kind: updated.kind, changes: { workstream: branch } });
  broadcast('workstreams-changed', { root: dir });
  saveNow(() => exportDatabase());
  res.status(201).json({ branch, root: dir, base: base ?? 'HEAD' });
});

/**
 * Skills that arrived in a plan file and wait for a person before any agent
 * is told them (Phase 32 C1.4), for the plan's readiness list.
 */
app.get('/api/plans/:uid/skill-arrivals', (req, res) => {
  if (!planService.getPlan(req.params.uid)) { res.status(404).json({ error: 'Plan not found' }); return; }
  res.json({ arrivals: planArrivals(req.params.uid) });
});

/**
 * A person accepts a skill that arrived in a plan file: agents are told it
 * from now on. Who accepted comes from how the call arrived, never the body.
 */
app.post('/api/items/:uid/skill-arrivals/accept', (req, res) => {
  const item = planItemService.getItem(req.params.uid);
  if (!item) { res.status(404).json({ error: 'Item not found' }); return; }
  const skill = typeof req.body?.skill === 'string' ? req.body.skill : '';
  const who = personFrom(req);
  if (!acceptArrival({ itemUid: item.uid, skill, by: who.author, byType: who.authorType })) {
    res.status(404).json({ error: `No skill "${skill}" is waiting on this item` });
    return;
  }
  broadcast('plan-item-updated', { planUid: item.planUid, itemUid: item.uid, kind: item.kind, changes: { skillAccepted: skill } });
  res.json({ accepted: skill });
});

// ── Breakpoints (Phase 32 B4) ──────────────────────────────────────
//
// A person says where agents must stop and ask; agents' calls there are held
// at the MCP interception until a person answers. Who set, cleared or
// answered comes from how the call arrived, never the body; the plan comes
// from the item.

/** Breakpoints still set; `?plan=` narrows to one plan's items. */
app.get('/api/breakpoints', (req, res) => {
  const plan = typeof req.query.plan === 'string' ? req.query.plan : undefined;
  res.json({ breakpoints: listBreakpoints(plan) });
});

/**
 * Set a breakpoint: `{ kind: "task" | "spec", itemUid, note? }`;
 * `{ kind: "code", path, symbol?, note? }` on a file or folder of the opened
 * project; or `{ kind: "signal", signal: "collision" | "contract" | "drift" }`,
 * a rule for the opened project (never a project named in the body). Setting
 * one already set returns it.
 */
app.post('/api/breakpoints', (req, res) => {
  const who = personFrom(req);
  try {
    const { breakpoint, created } = setBreakpoint({
      kind: req.body?.kind, itemUid: req.body?.itemUid, path: req.body?.path, symbol: req.body?.symbol, signal: req.body?.signal, note: req.body?.note,
      docUid: req.body?.docUid,
      projectRoot: getActiveProjectPath(), by: who.author, byType: who.authorType,
    });
    if (created) broadcast('breakpoints-changed', { planUid: breakpoint.planUid });
    res.status(created ? 201 : 200).json({ breakpoint });
  } catch (err) {
    if (err instanceof BreakpointError) { res.status(err.status).json({ error: err.message }); return; }
    throw err;
  }
});

/** Clear a breakpoint. Calls still waiting on it are let through. */
app.delete('/api/breakpoints/:id', (req, res) => {
  const who = personFrom(req);
  const bp = getBreakpoint(req.params.id);
  let outcome: ReturnType<typeof clearBreakpoint>;
  try {
    outcome = clearBreakpoint({ id: req.params.id, by: who.author, byType: who.authorType });
  } catch (err) {
    if (err instanceof BreakpointError) { res.status(err.status).json({ error: err.message }); return; }
    throw err;
  }
  const { cleared, released } = outcome;
  if (!cleared) { res.status(404).json({ error: 'No such breakpoint is set' }); return; }
  broadcast('breakpoints-changed', { planUid: bp?.planUid ?? null });
  res.json({ cleared: req.params.id, released: released.map((h) => h.ref) });
});

/** Held calls: `?state=waiting` (the default) or `all`; `?plan=` narrows to one plan. */
app.get('/api/breakpoint-hits', (req, res) => {
  const state = req.query.state === 'all' ? 'all' : 'waiting';
  // A call waiting on a signal the person has since answered in Awareness is let through first (B4.2b).
  const root = getActiveProjectPath();
  if (root) { try { releaseSettled(root); } catch { /* the list still answers */ } }
  const plan = typeof req.query.plan === 'string' ? req.query.plan : undefined;
  res.json({ hits: listHits({ state, planUid: plan }) });
});

/**
 * Answer a held call: `{ decision: "continue" | "steer" | "stop", note? }`.
 * A steer needs a note, which the agent reads. The first answer stands.
 */
app.post('/api/breakpoint-hits/:ref/answer', (req, res) => {
  const decision = req.body?.decision;
  if (!DECISIONS.includes(decision)) { res.status(400).json({ error: `decision must be one of ${DECISIONS.join(', ')}` }); return; }
  if (decision === 'steer' && !cleanNote(req.body?.note)) { res.status(400).json({ error: 'A steer needs a note for the agent' }); return; }
  const hit = getHit(req.params.ref);
  if (!hit) { res.status(404).json({ error: 'No such breakpoint hit' }); return; }
  if (hit.kind === 'proposal') { res.status(400).json({ error: 'A spec proposal is decided on the proposal: accept, amend or reject (POST /api/spec-proposals/:uid/decision).' }); return; }
  const who = personFrom(req);
  const answered = hit.answeredAt === null
    ? answerHit({ ref: hit.ref, decision, note: req.body?.note, by: who.author, byType: who.authorType })
    : null;
  if (!answered) { res.status(409).json({ error: 'Already answered', hit: getHit(hit.ref) }); return; }
  broadcast('breakpoint-answered', { ref: answered.ref, planUid: answered.planUid, decision: answered.decision });
  res.json({ hit: answered });
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

/**
 * A person posts to a plan's channel, from the app or the paired phone.
 *
 * Shared because the phone's copy did none of the rest: it took its author
 * name from the request, never wrote the event into a shared plan's files,
 * never fired the routing rules, and never told the desktop windows — a
 * message sent from the phone did not appear on the desktop until something
 * else refreshed the pane (Phase 32 §0.4j).
 */
export function postChannelEventAsPerson(input: {
  planUid: string;
  eventType: string;
  message: string;
  itemUid?: string | null;
  respondsTo?: string | null;
  attempted?: unknown;
  options?: unknown;
  /** How the person reached us: the phone and the app window are `human`, plain HTTP `unverified`. */
  by: Person['authorType'];
}) {
  if (!planService.getPlan(input.planUid)) throw new PlanRequestError(404, 'Plan not found');
  const identity = getSettings().identity;
  const author = identity.email || 'human';
  const payload: any = { message: input.message };
  if (Array.isArray(input.attempted) && input.attempted.length) payload.attempted = input.attempted;
  if (Array.isArray(input.options) && input.options.length) payload.options = input.options;

  const created = channelEventService.postChannelEvent({
    planUid: input.planUid,
    itemUid: input.itemUid ?? null,
    eventType: input.eventType as any,
    payload,
    author,
    authorType: input.by,
    agentModel: null,
    respondsTo: input.respondsTo ?? null,
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
  return created;
}

/**
 * A person's message about a signal (A4.1), from the app window, plain HTTP
 * or the phone. Returns the reply and the steers posted, or null when the
 * signal is not open in this project. The steer carries the signal's words
 * so the plan's channel reads on its own.
 */
export function replyToSignalAsPerson(projectRoot: string, signalId: string, message: string, by: SignalStateBy) {
  const kept = recordReply(projectRoot, signalId, message, by);
  if (!kept) return null;
  const steers: string[] = [];
  for (const t of kept.tasks) {
    try {
      const event = postChannelEventAsPerson({
        planUid: t.planUid,
        itemUid: t.itemUid,
        eventType: 'steer',
        message: `About "${kept.signal.summary}": ${message}`,
        by: by.actorType,
      });
      steers.push(event.uid);
    } catch (err) {
      console.warn('[Awareness] steer for a reply failed:', err instanceof Error ? err.message : err);
    }
  }
  broadcast('awareness-changed', { projectRoot });
  return { ...kept.reply, signalId, steers };
}

/** A person resolves, dismisses or reopens a channel event — app or phone, as above. */
export function setChannelEventStatusAsPerson(eventUid: string, status: string) {
  if (!channelEventService.getChannelEvent(eventUid)) throw new PlanRequestError(404, 'Channel event not found');
  const updated = channelEventService.setChannelEventStatus(eventUid, status as any);
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
  return updated;
}

/** Post a new channel event from the frontend (human author). */
app.post('/api/plans/:planUid/channels', (req, res) => {
  const { event_type, message, item_uid, attempted, options, responds_to } = req.body || {};
  if (!event_type || !message) {
    res.status(400).json({ error: 'event_type and message are required' });
    return;
  }
  try {
    res.json(postChannelEventAsPerson({
      planUid: req.params.planUid,
      eventType: event_type,
      message,
      itemUid: item_uid,
      respondsTo: responds_to,
      attempted,
      options,
      by: personFrom(req).authorType,
    }));
  } catch (err) {
    res.status(err instanceof PlanRequestError ? err.status : 400).json({ error: err instanceof Error ? err.message : String(err) });
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
    res.json(setChannelEventStatusAsPerson(req.params.eventUid, status));
  } catch (err) {
    res.status(err instanceof PlanRequestError ? err.status : 400).json({ error: err instanceof Error ? err.message : String(err) });
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
  if (status !== undefined && !isTaskStatus(status)) {
    res.status(400).json({ error: `status must be one of: ${TASK_STATUSES.join(', ')}` });
    return;
  }
  if (dependencies !== undefined) {
    const problem = Array.isArray(dependencies)
      ? dependencyProblem(null, dependencies, planItemService.getItem)
      : 'dependencies must be a list of task uids';
    if (problem) { res.status(400).json({ error: problem }); return; }
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
      ...personFrom(req),
    });
    broadcast('plan-item-created', { planUid: item.planUid, item });
    saveNow(() => exportDatabase());
    res.json(item);
  } catch (err) {
    const status = err instanceof planItemService.PlanItemStructureError ? 400 : 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Get a single item (without children / attachments / comments). */
app.get('/api/items/:uid', (req, res) => {
  const item = planItemService.getItem(req.params.uid);
  if (!item) { res.status(404).json({ error: 'Item not found' }); return; }
  res.json(item);
});

/** Read full bundle: item + parent + children + attachments + comments + recent versions. */
app.get('/api/items/:uid/full', async (req, res) => {
  const item = planItemService.getItem(req.params.uid);
  if (!item) { res.status(404).json({ error: 'Item not found' }); return; }
  // Criteria below are derived against the artefacts' current hashes.
  await artefactService.refreshArtefactHashes(req.params.uid).catch(() => []);
  const parent = item.parentUid ? planItemService.getItem(item.parentUid) : null;
  const children = planItemService.getChildren(item.planUid, req.params.uid);
  const attachments = taskAttachmentsService.listItemAttachments(req.params.uid);
  const comments = commentService.listItemComments(req.params.uid);
  const versions = planItemService.listItemVersions(req.params.uid).slice(0, 10);
  const criteria = criteriaService.listCriteria(req.params.uid);
  res.json({ item, parent, children, attachments, comments, criteria, versions });
});

// ── Phase 31 §4.1–4.3: acceptance criteria and sign-off ──────────────
//
// This is the desktop's route to a person's decision. Each handler below
// that changes how work is judged issues a decision authority, which is
// the only thing criteria-service accepts for it. MCP tools cannot reach
// these operations at all (human-decision.test.ts).
//
// Which authority depends on how the request arrived (§0.4d, owner's
// decision: decisions are tagged by who made them). From the app window's
// IPC it is a person, `desktop`. Over plain HTTP with the token it could be
// a person in a browser or a script that read the token, so it is recorded
// as `unverified` over `local-api`: it counts, and says what it is wherever
// it is shown.

function decisionFrom(req: express.Request) {
  const actor = getAuthorKey('human');
  return cameFromAppWindow(req) ? issueHumanDecision('desktop', actor) : issueUnverifiedDecision(actor);
}

function criteriaChanged(itemUid: string): void {
  const item = planItemService.getItem(itemUid);
  broadcast('plan-item-criteria-changed', { planUid: item?.planUid ?? null, itemUid });
  saveNow(() => exportDatabase());
}

function sendCriterionError(res: express.Response, err: unknown): void {
  if (err instanceof criteriaService.CriterionError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
}

app.get('/api/items/:uid/criteria', async (req, res) => {
  if (!planItemService.getItem(req.params.uid)) { res.status(404).json({ error: 'Item not found' }); return; }
  // The authoritative check (§4.4): files change while the app is closed.
  await artefactService.refreshArtefactHashes(req.params.uid).catch(() => []);
  res.json(criteriaService.listCriteria(req.params.uid));
});

// Phase 32 B8.3b — how far an item's criteria rest on evidence: the line and
// each criterion's grade, the same the phone and get_brief give.
app.get('/api/items/:uid/grounding', async (req, res) => {
  const g = await taskGrounding(req.params.uid);
  if (!g) { res.status(404).json({ error: 'Item not found' }); return; }
  res.json(g);
});

/**
 * Phase 33 G10 — the rules that judge a task's files, and what the latest
 * check run found in them: the brief's `rules` block, for the app's Brief.
 * The root is the task's plan's project, never the request's.
 */
app.get('/api/items/:uid/rules', (req, res) => {
  const item = planItemService.getItem(req.params.uid);
  if (!item) { res.status(404).json({ error: 'Item not found' }); return; }
  res.json(taskRules(item, planService.getPlan(item.planUid)?.projectPath ?? null));
});

app.post('/api/items/:uid/criteria', (req, res) => {
  try {
    const body = req.body ?? {};
    const criterion = criteriaService.addCriterionAsHuman(
      req.params.uid, { text: body.text, kind: body.kind, policy: body.policy }, decisionFrom(req),
    );
    criteriaChanged(criterion.itemUid);
    res.status(201).json(criterion);
  } catch (err) {
    sendCriterionError(res, err);
  }
});

app.put('/api/criteria/:uid', (req, res) => {
  try {
    const body = req.body ?? {};
    const criterion = criteriaService.updateCriterion(
      req.params.uid, { text: body.text, policy: body.policy, sortOrder: body.sortOrder }, decisionFrom(req),
    );
    criteriaChanged(criterion.itemUid);
    res.json(criterion);
  } catch (err) {
    sendCriterionError(res, err);
  }
});

app.delete('/api/criteria/:uid', (req, res) => {
  try {
    const before = criteriaService.getCriterion(req.params.uid);
    if (!before || !criteriaService.deleteCriterion(req.params.uid, decisionFrom(req))) {
      res.status(404).json({ error: 'Criterion not found' });
      return;
    }
    criteriaChanged(before.itemUid);
    res.json({ ok: true });
  } catch (err) {
    sendCriterionError(res, err);
  }
});

/** Approve, or send back with a note. */
app.post('/api/criteria/:uid/decide', async (req, res) => {
  try {
    const body = req.body ?? {};
    // A decision records the hashes of what it was taken on — take them fresh.
    const before = criteriaService.getCriterion(req.params.uid);
    if (before) await artefactService.refreshArtefactHashes(before.itemUid).catch(() => []);
    const criterion = criteriaService.decideCriterion(
      req.params.uid, { decision: body.decision, note: body.note, anchor: body.anchor }, decisionFrom(req),
    );
    // The notices that asked for this decision are answered (§12).
    const decidedPlan = planItemService.getItem(criterion.itemUid)?.planUid;
    if (decidedPlan) _lazy___services_sensor_bridge_service.resolveCriterionNotices(decidedPlan, criterion.uid);
    criteriaChanged(criterion.itemUid);
    res.json(criterion);
  } catch (err) {
    sendCriterionError(res, err);
  }
});

app.get('/api/criteria/:uid/signoffs', (req, res) => {
  if (!criteriaService.getCriterion(req.params.uid)) { res.status(404).json({ error: 'Criterion not found' }); return; }
  res.json(criteriaService.listSignoffs(req.params.uid));
});

// ── Phase 31 §8: the loops — checks, the worklist, check runs ─────────
//
// Every handler takes the plan or criterion from the path and derives the
// project from the stored plan; nothing here reads a root from a request.

app.post('/api/criteria/:uid/check', async (req, res) => {
  try {
    res.json(await criterionLoop.checkCriterion(req.params.uid));
  } catch (err) {
    sendCriterionError(res, err);
  }
});

app.get('/api/plans/:uid/worklist', async (req, res) => {
  if (!planService.getPlan(req.params.uid)) { res.status(404).json({ error: 'Plan not found' }); return; }
  res.json(await criterionLoop.getWorklist(req.params.uid));
});

app.get('/api/plans/:uid/check-runs', (req, res) => {
  if (!planService.getPlan(req.params.uid)) { res.status(404).json({ error: 'Plan not found' }); return; }
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
  res.json(criterionLoop.listCheckRuns(req.params.uid, limit));
});

/** "Run checks" — a person asks; the run records, and approves nothing. */
app.post('/api/plans/:uid/check-runs', async (req, res) => {
  if (!planService.getPlan(req.params.uid)) { res.status(404).json({ error: 'Plan not found' }); return; }
  try {
    const run = await criterionLoop.runCheckRun({
      planUid: req.params.uid, trigger: 'manual', by: personFrom(req).author, byType: personFrom(req).authorType,
    });
    broadcast('plan-check-run', { planUid: req.params.uid, runUid: run.uid });
    saveNow(() => exportDatabase());
    res.status(201).json(run);
  } catch (err) {
    sendCriterionError(res, err);
  }
});
// ── Phase 31 §4.2: artefacts — files an item read, produced or captured ──

app.get('/api/items/:uid/artefacts', async (req, res) => {
  if (!planItemService.getItem(req.params.uid)) { res.status(404).json({ error: 'Item not found' }); return; }
  await artefactService.refreshArtefactHashes(req.params.uid).catch(() => []);
  res.json(artefactService.listArtefacts(req.params.uid));
});

/**
 * A person records a file. The path is resolved inside the item's own
 * project (from its plan, never the request), links are refused, and the
 * type comes from the extension allowlist.
 */
app.post('/api/items/:uid/artefacts', async (req, res) => {
  const body = req.body ?? {};
  try {
    const artefact = await artefactService.recordArtefact({
      itemUid: req.params.uid,
      path: body.path,
      role: body.role,
      note: typeof body.note === 'string' ? body.note : null,
      actor: personFrom(req),
    });
    startArtefactWatching(artefact);
    criteriaChanged(req.params.uid);
    res.status(201).json(artefact);
  } catch (err) {
    if (err instanceof artefactService.ArtefactError) { res.status(err.status).json({ error: err.message }); return; }
    res.status(500).json({ error: 'Could not record the artefact' });
  }
});


/**
 * Update any field on an item.
 *
 * Every field the item editor sends has to be named here — a field left
 * out is dropped without an error, and the store then renders the
 * server's unchanged copy. That is how the approval gate toggle, the
 * routing panel (skills, claim policy, execution config, constraints),
 * symbol targets and visibility all appeared to save and never did.
 */
const CASCADE_MODES = new Set(['inherit', 'replace', 'none']);
const ITEM_VISIBILITIES = new Set(['shared', 'local']);

app.put('/api/items/:uid', (req, res) => {
  const body = req.body ?? {};
  // These are written to the row as given, so refuse a value the reader
  // would not understand rather than store it.
  for (const key of ['skillsMode', 'claimPolicyMode', 'executionConfigMode', 'constraintsMode']) {
    if (body[key] !== undefined && !CASCADE_MODES.has(body[key])) {
      res.status(400).json({ error: `${key} must be one of: ${[...CASCADE_MODES].join(', ')}` });
      return;
    }
  }
  if (body.visibility !== undefined && !ITEM_VISIBILITIES.has(body.visibility)) {
    res.status(400).json({ error: 'visibility must be shared or local' });
    return;
  }
  // Skills are shown to agents (Phase 32 C1), so a bad one is refused here
  // rather than stored and quietly trimmed.
  if (body.skills !== undefined) {
    const { problems } = normaliseSkills(body.skills);
    if (problems.length) { res.status(400).json({ error: problems.join('; ') }); return; }
  }
  if (body.status !== undefined && !isTaskStatus(body.status)) {
    res.status(400).json({ error: `status must be one of: ${TASK_STATUSES.join(', ')}` });
    return;
  }
  // Phase 32 B6.1 — any plan's task may be a dependency; one that names
  // nothing, the item itself, or a page would hold it for ever.
  if (body.dependencies !== undefined) {
    const problem = Array.isArray(body.dependencies)
      ? dependencyProblem(req.params.uid, body.dependencies, planItemService.getItem)
      : 'dependencies must be a list of task uids';
    if (problem) { res.status(400).json({ error: problem }); return; }
  }
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
    symbolSpecs: body.symbolSpecs,
    newConnections: body.newConnections,
    removedConnections: body.removedConnections,
    dependencies: body.dependencies,
    skills: body.skills,
    skillsMode: body.skillsMode,
    claimPolicy: body.claimPolicy,
    claimPolicyMode: body.claimPolicyMode,
    executionConfig: body.executionConfig,
    executionConfigMode: body.executionConfigMode,
    constraints: body.constraints,
    constraintsMode: body.constraintsMode,
    requiresApproval: typeof body.requiresApproval === 'boolean' ? body.requiresApproval : undefined,
    visibility: body.visibility,
    overrideParentVisibility: body.overrideParentVisibility,
    parentUid: body.parentUid,
    sortOrder: body.sortOrder,
    changeSummary: body.changeSummary,
    ...personFrom(req),
  });
  if (!item) { res.status(404).json({ error: 'Item not found' }); return; }
  broadcast('plan-item-updated', { planUid: item.planUid, itemUid: item.uid, kind: item.kind, changes: body });
  saveNow(() => exportDatabase());
  res.json(item);
});

/**
 * Append a code reference — a line range in one file — to an Action.
 *
 * The inspector's "Add to plan" (select lines in the code view) used the
 * V1 task routes: it listed V1 tasks, so a V2 plan's Actions never
 * appeared, and what it created was a V1 task the workspace never shows.
 * This is its V2 target. The merge into `fileSpecs` happens here, in one
 * synchronous step, so it cannot race an agent updating the same item —
 * a read-modify-write from the renderer could.
 */
app.post('/api/items/:uid/code-reference', (req, res) => {
  const { filePath, startLine, endLine, note, codeSnippet } = req.body || {};
  if (!filePath || typeof filePath !== 'string' || path.isAbsolute(filePath)) {
    res.status(400).json({ error: 'filePath is required, relative to the project root' });
    return;
  }
  const start = Number(startLine);
  const end = endLine === undefined ? start : Number(endLine);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
    res.status(400).json({ error: 'startLine and endLine must be line numbers, with endLine >= startLine' });
    return;
  }
  const existing = planItemService.getItem(req.params.uid);
  if (!existing) { res.status(404).json({ error: 'Item not found' }); return; }
  if (existing.kind !== 'action') {
    res.status(400).json({ error: 'Code references attach to Actions' });
    return;
  }

  const parts = [typeof note === 'string' && note.trim() ? note.trim() : `See ${filePath}:${start}${end === start ? '' : `-${end}`}`];
  if (typeof codeSnippet === 'string' && codeSnippet.trim()) {
    parts.push('', '```', codeSnippet.replace(/```/g, '`​``'), '```');
  }
  const edit = { lineRange: { start, end }, instruction: parts.join('\n') };
  const fileSpecs = [...(existing.fileSpecs ?? [])];
  const at = fileSpecs.findIndex((s) => s.path === filePath);
  if (at >= 0) fileSpecs[at] = { ...fileSpecs[at], edits: [...(fileSpecs[at].edits ?? []), edit] };
  else fileSpecs.push({ path: filePath, action: 'modify', edits: [edit] });

  const item = planItemService.updateItem(existing.uid, {
    fileSpecs,
    changeSummary: `Code reference ${filePath}:${start}${end === start ? '' : `-${end}`}`,
    ...personFrom(req),
  });
  if (!item) { res.status(404).json({ error: 'Item not found' }); return; }
  broadcast('plan-item-updated', { planUid: item.planUid, itemUid: item.uid, kind: item.kind, changes: { fileSpecs } });
  saveNow(() => exportDatabase());
  res.json(item);
});

/** Move (re-parent + reorder, single event). */
app.post('/api/items/:uid/move', (req, res) => {
  const { newParentUid, newSortOrder } = req.body || {};
  const item = planItemService.moveItem(req.params.uid, {
    newParentUid: newParentUid === undefined ? undefined : (newParentUid === '' ? null : newParentUid),
    newSortOrder,
    ...personFrom(req),
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
    ...personFrom(req),
  });
  broadcast('plan-item-deleted', { planUid: target.planUid, itemUid: req.params.uid, cascadedUids });
  saveNow(() => exportDatabase());
  res.json({ ok: true, deleted: cascadedUids });
});

/** Atomically claim an Action. */
app.post('/api/items/:uid/claim', (req, res) => {
  const { agentId, agentType, model } = req.body || {};
  // The body names who the work is assigned to — a script or test can claim
  // on an agent's behalf — but the change is recorded as the caller's. With
  // no agent named, the caller takes it, as whoever they are: over plain
  // HTTP that is `unverified`, never `human` (carried 2b).
  const who = personFrom(req);
  const assignee = agentId || who.author;
  const assigneeType = agentType || who.authorType;
  const result = planItemService.claimItem(req.params.uid, assignee, assigneeType, model, undefined, undefined, who);
  if (result.ok) {
    const item = planItemService.getItem(req.params.uid);
    if (item) {
      broadcast('plan-item-claimed', { planUid: item.planUid, itemUid: item.uid, agentId: assignee, agentType: assigneeType });
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
  const item = planItemService.restoreItemVersion(req.params.uid, v, personFrom(req).author, personFrom(req).authorType);
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
  const { kind, body, parentCommentUid } = req.body || {};
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
    personFrom(req).author,
    personFrom(req).authorType,
    body,
    // Whether it came from a person or an agent follows from how it arrived,
    // never from a `source` in the body.
    { kind, commentType: legacyType, parentUid: parentCommentUid },
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
  planItemService.updateItem(req.params.uid, { progressPercent: percent, ...personFrom(req) });
  const body = (typeof message === 'string' && message.trim()) ? message.trim() : `Progress: ${percent}%`;
  const comment = commentService.addComment('item', req.params.uid, personFrom(req).author, personFrom(req).authorType, body, {
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
  planItemService.updateItem(req.params.uid, { status: 'blocked', blockedReason: reason, ...personFrom(req) });
  const comment = commentService.addComment('item', req.params.uid, personFrom(req).author, personFrom(req).authorType, reason, {
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
      ...personFrom(req),
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
async function sendAttachmentContent(req: express.Request, res: express.Response): Promise<void> {
  // Phase 31 §7.1 — the same resolver the packaged app's `ct-artefact:`
  // scheme uses. See artefact-content-service for what it guarantees.
  const file = await artefactContent.resolveServable(req.params.uid);
  if (!file) { res.status(404).json({ error: 'This attachment is not a file that can be shown' }); return; }
  const served = artefactContent.serveFile(file, typeof req.headers.range === 'string' ? req.headers.range : null);
  if (!served.stream) {
    for (const [k, v] of Object.entries(served.headers)) res.setHeader(k, v);
    res.status(served.status).json({ error: served.error });
    return;
  }
  res.status(served.status);
  for (const [k, v] of Object.entries(served.headers)) res.setHeader(k, v);
  const stream = served.stream;
  stream.on('error', () => {
    if (!res.headersSent) res.status(500).json({ error: 'Could not read the attachment' });
    else res.destroy();
  });
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

app.get('/api/attachments/:uid/file', (req, res) => { void sendAttachmentContent(req, res); });
app.get('/api/artefacts/:uid/content', (req, res) => { void sendAttachmentContent(req, res); });

/**
 * Phase 31 §7.6 — an Office file as it looks, converted to PDF by the
 * engine in its own process. Found and read exactly as `/content` is; a
 * conversion that cannot happen is a 503 with a sentence, and the viewer
 * shows the packaged fallback.
 */
app.get('/api/artefacts/:uid/rendition', async (req, res) => {
  if (!artefactContent.isAttachmentUid(req.params.uid)) { res.status(404).json({ error: 'Attachment not found' }); return; }
  const result = await rendition.renditionOf(req.params.uid);
  if (!result.ok) { res.status(result.status).json({ error: result.reason, fallback: true }); return; }
  const served = artefactContent.serveFile(result.file, typeof req.headers.range === 'string' ? req.headers.range : null);
  if (!served.stream) {
    for (const [k, v] of Object.entries(served.headers)) res.setHeader(k, v);
    res.status(served.status).json({ error: served.error, fallback: true });
    return;
  }
  res.status(served.status);
  for (const [k, v] of Object.entries(served.headers)) res.setHeader(k, v);
  const stream = served.stream;
  stream.on('error', () => { if (!res.headersSent) res.status(500).json({ error: 'Could not read the rendition' }); else res.destroy(); });
  res.on('close', () => stream.destroy());
  stream.pipe(res);
});

/**
 * What the viewer shows around the bytes: name, role, size, hash, who
 * recorded it. Never the absolute path — the project-relative one is
 * what a person recognises and what a locator is written against.
 */
app.get('/api/artefacts/:uid', async (req, res) => {
  const file = await artefactContent.resolveServable(req.params.uid);
  const row = getDb().exec(
    `SELECT uid, target_uid, value, label, kind, role, sha256, size, mtime, recorded_by, recorded_by_type, author, created_at
     FROM attachments WHERE uid = ?`,
    [req.params.uid],
  )[0]?.values[0];
  if (!row) { res.status(404).json({ error: 'Attachment not found' }); return; }
  const value = row[2] as string;
  res.json({
    uid: row[0],
    itemUid: row[1],
    path: file ? file.rel.split(path.sep).join('/') : null,
    name: path.basename(value.replace(/^userdata:\/\//, '')),
    label: row[3] ?? null,
    kind: row[4],
    role: row[5] ?? null,
    sha256: row[6] ?? null,
    size: row[7] ?? null,
    mtime: row[8] ?? null,
    recordedBy: row[9] ?? row[11] ?? null,
    recordedByType: row[10] ?? null,
    createdAt: row[12],
    contentType: file?.contentType ?? null,
    viewable: !!file,
  });
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
  if (!planService.getPlan(req.params.uid)) { res.status(404).json({ error: 'Plan not found' }); return; }
  res.json(getDeviations(req.params.uid));
});

// Reconcile deviations — only this plan's, each checked first (bug 30)
app.post('/api/plans/:uid/reconcile', (req, res) => {
  if (!planService.getPlan(req.params.uid)) { res.status(404).json({ error: 'Plan not found' }); return; }
  const { deviations } = req.body ?? {}; // [{id, action}]
  if (!Array.isArray(deviations)) { res.status(400).json({ error: 'deviations array required' }); return; }
  try {
    const resolved = reconcileDeviations(req.params.uid, deviations, actorFrom(req));
    broadcast('deviations-resolved', { planUid: req.params.uid, ids: deviations.map((d: { id: unknown }) => d.id) });
    saveNow(() => exportDatabase());
    res.json({ ok: true, resolved });
  } catch (err) {
    if (err instanceof DeviationError) { res.status(400).json({ error: err.message }); return; }
    throw err;
  }
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
  const { docType, title, body, orderHint, parentDocUid } = req.body || {};
  if (!docType || !title) {
    res.status(400).json({ error: 'docType and title are required' });
    return;
  }
  const doc = createPlanDocument({
    planUid: req.params.uid,
    docType,
    title,
    body: body ?? '',
    ...personFrom(req),
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
  // The version's author is whoever made the edit, never a name in the body.
  const { title, body, docType, changeSummary, orderHint, parentDocUid } = req.body || {};
  const doc = updatePlanDocument(req.params.docUid, {
    title, body, docType, changeSummary, ...personFrom(req), orderHint, parentDocUid,
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
app.get('/api/file/at', async (req, res) => {
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
    // Another workstream's copy (Phase 32 B3.2): chosen among the ones this
    // project's repository has, read inside that workstream's own folder.
    if (at.startsWith('workstream:')) {
      // Its paths are from its repository's top: a project in a subfolder adds where it sits (E1).
      const copy = readWorkstreamCopy(await listWorkstreams(owningRoot, { includeIdle: true }), at.slice('workstream:'.length), `${projectPrefix(projectPath)}${relativePath}`);
      if (!copy) { res.status(404).json({ error: `No workstream ${at.slice('workstream:'.length)} in this project.` }); return; }
      res.json({ ok: true, content: copy.content, label: copy.label });
      return;
    }
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
// Phase 32 E1: what has changed in an opened project, by where, as an
// editor's source control tab lists it: staged, unstaged, untracked,
// committed since the graph's baseline, and each other worktree or branch,
// each group with the two points its files are diffed between. No plan.
app.get('/api/source-control', async (req, res) => {
  const projectPath = requireProjectRoot(req, res);
  if (!projectPath) return;
  const trimRoot = (p: string) => p.replace(/[\\/]+$/, '');
  const baseline = getBaseline();
  const baselineCommit = baseline && baseline.projectPath && trimRoot(baseline.projectPath) === trimRoot(projectPath) ? baseline.commitHash ?? null : null;
  let workstreams: Awaited<ReturnType<typeof listWorkstreams>> = [];
  try { workstreams = await listWorkstreams(projectPath, { includeIdle: false }); } catch { /* not a repository: the service says so */ }
  res.json(sourceControl(projectPath, baselineCommit, workstreams));
});

// Phase 32 E2: every point a person can compare (branches, remote branches as
// last fetched, tags, other worktrees' working copies), and the files that
// differ between any two, each side said plainly and the command git would
// use. A worktree is named by the id `listWorkstreams` gave it; refs are
// checked before they reach git.
app.get('/api/git/refs', async (req, res) => {
  const projectPath = requireProjectRoot(req, res);
  if (!projectPath) return;
  let workstreams: Awaited<ReturnType<typeof listWorkstreams>> = [];
  try { workstreams = await listWorkstreams(projectPath, { includeIdle: true }); } catch { /* not a repository: the listing says so */ }
  res.json(listRefs(projectPath, workstreams));
});

// Phase 32 E5 — branches here and on the remotes, as last fetched, with
// upstream, ahead and behind; pull requests as gh last read them. Local only:
// nothing here reaches a host.
app.get('/api/git/branches', async (req, res) => {
  const projectPath = requireProjectRoot(req, res);
  if (!projectPath) return;
  res.json(await listBranches(projectPath, getSettings().git));
});

// Fetch now: `git fetch --all --prune`, then the pull requests through gh.
// The person's action; the root is an opened project, never a body field.
app.post('/api/git/fetch', async (req, res) => {
  const projectPath = requireProjectRoot(req, res);
  if (!projectPath) return;
  const result = await fetchRemotes(projectPath);
  broadcast('git-remotes-changed', { project: projectPath });
  res.json({ ...result, listing: await listBranches(projectPath, getSettings().git) });
});

app.get('/api/git/refs/compare', (req, res) => {
  const projectPath = requireProjectRoot(req, res);
  if (!projectPath) return;
  const before = typeof req.query.before === 'string' ? req.query.before : '';
  const after = typeof req.query.after === 'string' ? req.query.after : '';
  if (!before || !after) { res.status(400).json({ error: 'Choose both sides: before and after.' }); return; }
  // Read only: git's worktrees, no agents placed, no watchers started.
  const workstreams = worktreesForCompare(projectPath);
  const result = filesBetween(projectPath, before, after, workstreams);
  if (!result.ok) { res.status(400).json({ error: result.error }); return; }
  const labels = { before: sideLabel(projectPath, before, workstreams), after: sideLabel(projectPath, after, workstreams) };
  const n = result.files.length;
  // Inside a sentence the app's own words start lower case; a branch keeps its name.
  const said = (l: string) => (/^(Where|Your|Last|Staged|Tag|Nothing|Commit) /.test(l) ? l[0].toLowerCase() + l.slice(1) : l);
  res.json({
    before, after, labels, files: result.files, truncated: result.truncated,
    command: diffCommand(before, after, workstreams, undefined),
    words: n === 0
      ? `${labels.before} and ${said(labels.after)} have the same files.`
      : `${n}${result.truncated ? '+' : ''} file${n === 1 ? ' differs' : 's differ'} between ${said(labels.before)} and ${said(labels.after)}.`,
  });
});

// Phase 32 E3: a file's positions on one side (its working copy, then each
// commit that changed it, following renames), each with its git author and
// what CodeTrellis knows of who made it; and the decisions recorded between
// two moments, for what was decided between two commits.
app.get('/api/git/file-history', (req, res) => {
  const projectPath = requireProjectRoot(req, res);
  if (!projectPath) return;
  const at = typeof req.query.at === 'string' && req.query.at ? req.query.at : 'live';
  const rel = typeof req.query.path === 'string' ? req.query.path : '';
  if (!isProjectRelativePath(rel)) {
    res.status(400).json({ error: 'A path relative to the project is required.' });
    return;
  }
  try {
    res.json(fileHistory(projectPath, at, rel, worktreesForCompare(projectPath), recordedKnowledge(projectPath)));
  } catch (err) {
    if (err instanceof FileHistoryError) { res.status(400).json({ error: err.message }); return; }
    throw err;
  }
});

// Phase 32 E4: who wrote each line of a file, as GitLens shows it (the git
// author always), with what CodeTrellis knows of why: the agent, how it
// knows, the session and the task and plan it worked on.
app.get('/api/git/line-history', (req, res) => {
  const projectPath = requireProjectRoot(req, res);
  if (!projectPath) return;
  const at = typeof req.query.at === 'string' && req.query.at ? req.query.at : 'live';
  const rel = typeof req.query.path === 'string' ? req.query.path : '';
  if (!isProjectRelativePath(rel)) { res.status(400).json({ error: 'A path relative to the project is required.' }); return; }
  try {
    res.json(lineHistory(projectPath, at, rel, worktreesForCompare(projectPath), recordedKnowledge(projectPath)));
  } catch (err) {
    if (err instanceof LineHistoryError) { res.status(400).json({ error: err.message }); return; }
    throw err;
  }
});

app.get('/api/record/decisions', (req, res) => {
  const from = Number(req.query.from);
  const to = Number(req.query.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
    res.status(400).json({ error: 'from and to are times in ms, from no later than to.' });
    return;
  }
  const decisions = decisionsBetween(from, to);
  res.json({
    from, to, decisions,
    words: decisions.length === 0
      ? 'Nothing was decided on this computer between these two moments.'
      : `${decisions.length} decision${decisions.length === 1 ? '' : 's'} recorded on this computer between these two moments.`,
  });
});

app.get('/api/comparands', async (req, res) => {
  const projectPath = requireProjectRoot(req, res);
  if (!projectPath) return;
  res.json(listComparands(projectPath, undefined, await comparandBranches(projectPath)));
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

app.get('/api/plans/:uid/pr-draft', async (req, res) => {
  const projectPath = requireProjectRoot(req, res);
  if (!projectPath) return;
  // Read-only: this never touches the repository. The agent does the git
  // and opens the PR with its own credentials; we supply the body it
  // cannot write.
  const before = req.query.before as string | undefined;
  const after = req.query.after as string | undefined;
  const result = buildPrDraft({
    planUid: req.params.uid,
    projectPath,
    before,
    after,
    architecture: await draftArchitecture(projectPath, before, after),
  });
  if (!result.ok) { res.status(404).json(result); return; }
  res.json(result.draft);
});

// The review queue (Phase 32 A5.4): each line of work with plan items, with
// where it stands and a suggested merge order, reasons shown, never enforced.
app.get('/api/review-queue', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  res.json(reviewQueue(projectRoot));
});

/**
 * Phase 32 B6.2 — the stack: every active plan in the project and its tasks,
 * with who is on each, where it is worked, and its dependencies across plans.
 */
app.get('/api/stack', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  res.json(buildStack(projectRoot));
});

/**
 * Phase 32 B9.1 — play-forward: every active plan's planned changes at once,
 * and where they will meet ("◇ planned overlap"), code and materials.
 */
app.get('/api/play-forward', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  res.json(buildPlayForward(projectRoot));
});

/**
 * Phase 32 B9.3a — a person acts on a planned overlap: re-sequence the plans
 * (`first`: the plan that goes first), tell the agents holding its tasks
 * once, or leave it. The author comes from the transport; no MCP tool
 * reaches these. The project is the query's, confined like every other.
 */
/** B9.3b — the inbox's notices of plans approved into planned overlaps, not yet seen. */
app.get('/api/play-forward/notices', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  res.json({ notices: approvalNotices(projectRoot) });
});

app.post('/api/play-forward/notices/:id/seen', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  if (!markNoticeSeen(projectRoot, Number(req.params.id), personFrom(req))) { res.status(404).json({ error: 'No such notice, or it was seen already.' }); return; }
  broadcast('play-forward-changed', { project: projectRoot });
  saveNow(() => exportDatabase());
  res.json({ ok: true });
});

app.post('/api/play-forward/overlaps/:id/:action', (req, res) => {
  const projectRoot = requireProjectRoot(req, res);
  if (!projectRoot) return;
  const action = req.params.action;
  if (action !== 'resequence' && action !== 'tell' && action !== 'leave') {
    res.status(404).json({ error: 'Unknown action: resequence, tell or leave.' });
    return;
  }
  const who = personFrom(req);
  const by = { author: who.author, authorType: who.authorType };
  try {
    let result: Record<string, unknown> = {};
    if (action === 'resequence') {
      const first = typeof req.body?.first === 'string' ? req.body.first : '';
      if (!first) { res.status(400).json({ error: 'Say which plan goes first: first (a plan uid).' }); return; }
      const r = resequence(projectRoot, req.params.id, first, by);
      for (const t of r.waiting) broadcast('plan-item-updated', { planUid: planItemService.getItem(t.uid)?.planUid, itemUid: t.uid, kind: 'action', changes: { dependencies: true } });
      result = { waiting: r.waiting };
    } else if (action === 'tell') {
      result = tellAgents(projectRoot, req.params.id, by);
    } else {
      leaveOverlap(projectRoot, req.params.id, by);
    }
    broadcast('play-forward-changed', { project: projectRoot });
    saveNow(() => exportDatabase());
    res.json({ ...result, playForward: buildPlayForward(projectRoot) });
  } catch (err) {
    if (err instanceof OverlapActionError) { res.status(err.status).json({ error: err.message }); return; }
    throw err;
  }
});

app.get('/api/plans/:uid/review', async (req, res) => {
  const projectPath = requireProjectRoot(req, res);
  if (!projectPath) return;
  const result = reviewPlan({
    planUid: req.params.uid,
    projectPath,
    before: req.query.before as string | undefined,
    after: req.query.after as string | undefined,
  });
  if (!result.ok) { res.status(404).json(result); return; }
  // V1 — what the change does to the architecture, at the top.
  const review = await withArchitecture(result.review, projectPath);
  if (req.query.format === 'markdown') {
    res.type('text/markdown').send(renderReviewMarkdown(review));
    return;
  }
  res.json(review);
});

// Phase 33 V1 — the architecture section with no plan: between two commits.
app.get('/api/review/architecture', async (req, res) => {
  const projectPath = requireProjectRoot(req, res);
  if (!projectPath) return;
  const base = typeof req.query.base === 'string' ? req.query.base : '';
  const head = typeof req.query.head === 'string' && req.query.head ? req.query.head : 'HEAD';
  if (!base || !isSafeGitRef(base) || !isSafeGitRef(head)) { res.status(400).json({ error: 'base (and head, default HEAD) must be commits or branch names' }); return; }
  const a = await architectureOf(projectPath, base, head);
  if ('error' in a) { res.status(400).json(a); return; }
  // V3 — what moved since this reviewer's last look at the line of work.
  const mark = lastMark(projectPath, head, personFrom(req).author);
  const since = mark ? sinceLastLook(projectPath, mark, a.head, a.words) : null;
  // V6 — what the linked task asked, only when the head is a task's branch.
  const task = taskOutcome(projectPath, base, head);
  if (req.query.format === 'markdown') { res.type('text/markdown').send(`${since ? `${since.words}\n\n` : ''}${architectureMarkdown(a)}${task ? `\n\n${taskMarkdown(task)}` : ''}`); return; }
  res.json({ ...a, ...(since ? { since } : {}), ...(task ? { task } : {}) });
});

// Phase 33 V3 — a reviewer marks a line of work reviewed at its head now,
// keeping what the review says, so the next look shows only what moved.
app.post('/api/review/seen', async (req, res) => {
  const projectPath = requireProjectRoot(req, res);
  if (!projectPath) return;
  const b = (req.body ?? {}) as Record<string, unknown>;
  const base = typeof b.base === 'string' ? b.base : '';
  const head = typeof b.head === 'string' && b.head ? b.head : 'HEAD';
  if (!base || !isSafeGitRef(base) || !isSafeGitRef(head)) { res.status(400).json({ error: 'base (and head, default HEAD) must be commits or branch names' }); return; }
  const a = await architectureOf(projectPath, base, head);
  if ('error' in a) { res.status(400).json(a); return; }
  const person = personFrom(req);
  res.json(markReviewed(projectPath, { target: head, reviewer: person.author, reviewerType: person.authorType, base: a.base, commit: a.head, findings: a.words }));
});

// --- Budgets (Phase 23) ---
//
// Time is measured for every agent; cost only where the agent reports a
// model we have prices for. An unknown cost comes back as null, never
// zero — see services/pricing.ts.
app.get('/api/plans/:uid/budget', (req, res) => {
  if (!planService.getPlan(req.params.uid)) { res.status(404).json({ error: 'Plan not found' }); return; }
  res.json(budgetService.getBudgetReport(req.params.uid));
});

/** Every change to the ceiling, newest first: who, how, before and after (§0.4g). */
app.get('/api/plans/:uid/budget/changes', (req, res) => {
  if (!planService.getPlan(req.params.uid)) { res.status(404).json({ error: 'Plan not found' }); return; }
  res.json(budgetService.listBudgetChanges(req.params.uid));
});

/** A person has seen an agent's change to the ceiling: it is no longer flagged. */
app.post('/api/plans/:uid/budget/changes/:id/acknowledge', (req, res) => {
  if (!planService.getPlan(req.params.uid)) { res.status(404).json({ error: 'Plan not found' }); return; }
  const id = Number(req.params.id);
  const change = Number.isInteger(id) ? budgetService.acknowledgeBudgetChange(req.params.uid, id, personFrom(req).author) : null;
  if (!change) { res.status(404).json({ error: 'No such budget change on this plan' }); return; }
  broadcast('plan-budget-changed', { planUid: req.params.uid, acknowledged: change.id });
  res.json(change);
});

app.put('/api/plans/:uid/budget', (req, res) => {
  if (!planService.getPlan(req.params.uid)) { res.status(404).json({ error: 'Plan not found' }); return; }
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
    // Recorded with who made it, tagged by how it arrived, as a criterion
    // decision is (decisionFrom). A person's change is never flagged.
    by: actorFrom(req),
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
  if (!planService.getPlan(req.params.uid)) { res.status(404).json({ error: 'Plan not found' }); return; }
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
  const rawPlanDir = (req.query.path as string) || (req.body && req.body.planDir);
  if (!rawPlanDir) {
    res.status(400).json({ error: 'planDir path required (?path=… or body.planDir)' });
    return;
  }
  // Confined: a plan directory of an opened project, compared on the real
  // path. See resolveTrustedPlanDir.
  let planDir: string;
  try {
    planDir = resolveTrustedPlanDir(rawPlanDir);
  } catch (err) {
    res.status(err instanceof ConfinementError ? 403 : 400).json({ error: err instanceof Error ? err.message : String(err) });
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
    personFrom(req).author,
    personFrom(req).authorType,
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
      ...personFrom(req),
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

// --- Phase 31 §13: the sign-off pack ---------------------------------
//
// The same rows as the PR draft's criteria table, as data, as a page that
// leaves the app, and checked later against the files it names. The plan
// comes from the path; the files a pack names are resolved inside the
// plan's own project (signoff-pack.ts), never where the pack says.

app.get('/api/plans/:uid/signoff-pack', (req, res) => {
  try {
    // Sealed with this computer's key and the record's head (B10.3).
    res.json(sealPack(buildSignoffPack(req.params.uid)));
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/plans/:uid/signoff-pack.html', (req, res) => {
  try {
    const pack = sealPack(buildSignoffPack(req.params.uid));
    const safe = pack.plan.title.replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'plan';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // A file to save, not a page to render inside the app's origin.
    res.setHeader('Content-Disposition', `attachment; filename="sign-off-pack-${safe}.html"`);
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(renderPackHtml(pack));
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** "Verify this pack": the saved page or its JSON, as text; re-hash every file it names. */
app.post(
  '/api/plans/:uid/signoff-pack/verify',
  express.text({ type: 'text/plain', limit: '20mb' }),
  async (req, res) => {
    try {
      const text = typeof req.body === 'string' ? req.body : '';
      if (!text.trim()) { res.status(400).json({ error: 'Send the saved pack (.html or .json) as text' }); return; }
      let pack: unknown;
      try { pack = packFromText(text); } catch (err) {
        res.status(400).json({ error: err instanceof PackError ? err.message : 'That file is not a readable sign-off pack' });
        return;
      }
      // The files still match? And the pack itself: who signed it, and unchanged since? (B10.3)
      res.json({ ...(await verifyPack(req.params.uid, pack)), seal: checkSeal(pack) });
    } catch (err) {
      res.status(err instanceof PackError ? 400 : 500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

// --- Phase 32 B10.4: the evidence export ------------------------------
//
// For a plan (`?plan=`: its project and its time) or a window of an opened
// project (`?project=&from=&to=`): the record's entries with how to
// recompute them, the frames, the stack and signals at both ends, the
// breakpoints and decisions, and the plan's sign-off pack; sealed with this
// computer's key. `?format=html` is the page to save.

app.get('/api/evidence', (req, res) => {
  const ms = (v: unknown) => (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : undefined);
  const plan = typeof req.query.plan === 'string' && req.query.plan ? req.query.plan : undefined;
  let projectPath: string | undefined;
  if (!plan) {
    const root = requireProjectRoot(req, res);
    if (!root) return;
    projectPath = root;
  }
  try {
    const evidence = sealEvidence(buildEvidence({ planUid: plan, projectPath, from: ms(req.query.from), to: ms(req.query.to) }));
    if (req.query.format !== 'html') { res.json(evidence); return; }
    const name = (evidence.window.plan?.title ?? 'window').replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'window';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // A file to save, not a page to render inside the app's origin.
    res.setHeader('Content-Disposition', `attachment; filename="evidence-${name}.html"`);
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(renderEvidenceHtml(evidence));
  } catch (err) {
    if (err instanceof EvidenceError) { res.status(err.status).json({ error: err.message }); return; }
    throw err;
  }
});

/** "Verify evidence": the saved page or its JSON, as text. Who signed it, whether its chain holds, and what changed here since. */
app.post('/api/evidence/verify', express.text({ type: 'text/plain', limit: '100mb' }), (req, res) => {
  const text = typeof req.body === 'string' ? req.body : '';
  if (!text.trim()) { res.status(400).json({ error: 'Send the saved evidence (.html or .json) as text' }); return; }
  try {
    res.json(verifyEvidence(evidenceFromText(text)));
  } catch (err) {
    if (err instanceof EvidenceError) { res.status(err.status).json({ error: err.message }); return; }
    throw err;
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
  const { templateId, projectPath: rawProjectPath, title, description, placeholderValues } = req.body || {};
  const projectPath = confineRoot(rawProjectPath, res, 'projectPath');
  if (!projectPath) return;
  if (!templateId || !projectPath) {
    res.status(400).json({ error: 'templateId and projectPath are required' });
    return;
  }
  try {
    const result = applyTemplate({
      templateId, projectPath, title, description, ...personFrom(req),
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

/**
 * Phase 31 §14 — fill an existing, empty plan from a template: what "Start
 * from a template" on an empty plan does. The project is the plan's own;
 * nothing about a location is taken from the request.
 */
app.post('/api/plans/:uid/apply-template', (req, res) => {
  const { templateId, placeholderValues } = req.body || {};
  if (typeof templateId !== 'string' || !templateId) {
    res.status(400).json({ error: 'templateId is required' });
    return;
  }
  try {
    const result = applyTemplateToPlan({
      planUid: req.params.uid,
      templateId,
      placeholderValues: placeholderValues && typeof placeholderValues === 'object' ? placeholderValues : undefined,
      ...personFrom(req),
    });
    for (const item of result.items) broadcast('plan-item-created', { planUid: req.params.uid, item });
    broadcast('plan-updated', { planUid: req.params.uid });
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
  const comment = commentService.addComment(targetType || 'plan', targetUid, personFrom(req).author, personFrom(req).authorType, body, commentType, parentUid);
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

/**
 * Phase 32 C2.5b — an item's approvals as signed statements: each one this
 * machine signed with git's SSH key (or kept local, and why), and each one
 * read from the plan's approvals/ folder, verified or not, and why not.
 */
app.get('/api/items/:uid/signed-approvals', (req, res) => {
  if (!planItemService.getItem(req.params.uid)) { res.status(404).json({ error: 'Item not found' }); return; }
  res.json(listSignedApprovals(req.params.uid));
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
      ...personFrom(req),
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
  // Both checked: an unknown one was accepted and broadcast (bug 27).
  if (!planService.getPlan(planUid)) { res.status(404).json({ error: 'Plan not found' }); return; }
  if (!sessionService.getActiveSessions().some((s) => s.sessionId === sessionId)) {
    res.status(404).json({ error: 'No active agent session with that id' });
    return;
  }
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

// Everything the copy surfaces need to explain the credential, not just
// carry it. The token is safe to return here: this API already required
// it to answer.
app.get('/api/mcp/setup', (_req, res) => {
  res.json(getMcpSetup());
});

// --- Logs API (Phase 13 follow-up) ---

app.get('/api/logs/tail', (req, res) => {
  // A size, or the default. `Number('abc')` is NaN, and NaN went straight
  // through `Math.min` into the read (Phase 32 §0.4k).
  const asked = req.query.maxBytes === undefined ? 64 * 1024 : Number(req.query.maxBytes);
  if (!Number.isInteger(asked) || asked < 1) {
    res.status(400).json({ error: 'maxBytes must be a whole number of bytes' });
    return;
  }
  const maxBytes = Math.min(asked, 1024 * 1024);
  res.json({
    path: getCurrentLogPath(),
    content: tailLog(maxBytes),
    // An empty tail means two different things; the panel says which.
    writing: isWritingLogFile(),
  });
});

app.get('/api/logs/path', (_req, res) => {
  res.json({ logFile: getCurrentLogPath(), logDir: getLogDir() });
});

// --- Build info (so Settings → About can show what's actually running) ---

/**
 * Running from source there is no bundler stamp, so `BUILD_INFO` has
 * the version but no commit or build number (see shared/build-info.ts).
 * Read those live from `git` when we can. In packaged Electron (no
 * source tree) this returns null and the stamped `BUILD_INFO` answers.
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

/** Granting is the person's: the app window, or a test backend (grant-guard.ts). */
const mayGrant = (req: express.Request): boolean => cameFromAppWindow(req) || httpGrantsAllowed();

app.put('/api/settings', (req, res) => {
  const before = getSettings();
  const grant = grantChange(req.body, before);
  if (grant && !mayGrant(req)) {
    res.status(403).json({ error: grantRefusal(grant.field, grant.where) });
    return;
  }
  let next: ReturnType<typeof updateSettings>;
  try {
    next = updateSettings(req.body || {});
  } catch (err) {
    if (err instanceof SettingsError) { res.status(400).json({ error: err.message }); return; }
    throw err;
  }
  // Tell the frontend (and any open Settings panels in other windows)
  // that settings changed.
  broadcast('settings-changed', { settings: next });
  // If the MCP port preference changed, the frontend should know that
  // a server restart may be needed for it to take effect.
  if (before.mcp.port !== next.mcp.port) {
    broadcast('mcp-port-config-changed', { configuredPort: next.mcp.port });
  }
  // B10.2 — a new retention window applies at once, and is itself kept in
  // the record: shortening it is what removes evidence.
  if (before.data.retentionDays !== next.data.retentionDays) {
    const person = personFrom(req);
    recordDecision('retention_changed', {
      from: before.data.retentionDays, to: next.data.retentionDays,
      fromWords: retentionWords(before.data.retentionDays), toWords: retentionWords(next.data.retentionDays),
      author: person.author, authorType: person.authorType,
    }, person.authorType);
    setLogRetention(next.data.retentionDays);
    try {
      pruneAgentEvents();
      pruneFrames();
      if (next.data.retentionDays !== null) pruneOldLogs(getLogDir(), new Date(), next.data.retentionDays);
    } catch (err) { console.warn('[Retention] applying the new window failed:', err); }
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
  const { projectPath: rawProjectPath, active, reason, until, allowedPlanUids } = req.body ?? {};
  const projectPath = confineRoot(rawProjectPath, res, 'projectPath');
  if (!projectPath) return;
  // Each field checked: it stored what it was sent, so `active: "no"` (truthy)
  // froze the project and an `until` that is not a date never expired
  // (Phase 32 §0.4h, bug 33).
  const problem =
    typeof active !== 'boolean' ? 'active must be true or false'
      : reason !== undefined && reason !== null && typeof reason !== 'string' ? 'reason must be text'
        : until !== undefined && until !== null && (typeof until !== 'string' || Number.isNaN(Date.parse(until))) ? 'until must be an ISO date, or null'
          : allowedPlanUids !== undefined && (!Array.isArray(allowedPlanUids) || !allowedPlanUids.every((u: unknown) => typeof u === 'string'))
            ? 'allowedPlanUids must be a list of plan uids'
            : null;
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  // Recorded with who made it and how it arrived, as a budget change is
  // (owner's decision, 0.4k). A person's change is never flagged.
  const status = setFreeze(projectPath, { active, reason, until, allowedPlanUids }, actorFrom(req));
  broadcast('freeze-changed', { projectRoot: projectPath, status });
  res.json(status);
});

/** Every recorded change to the project's freeze, newest first, with who made it. */
app.get('/api/freeze/changes', (req, res) => {
  const { listFreezeChanges } = _lazy___services_freeze_service;
  const projectPath = requireProjectRoot(req, res);
  if (!projectPath) return;
  res.json(listFreezeChanges(projectPath));
});

/** A person has seen an agent's change to the freeze: no longer flagged. */
app.post('/api/freeze/changes/:id/acknowledge', (req, res) => {
  const { acknowledgeFreezeChange } = _lazy___services_freeze_service;
  const projectPath = confineRoot((req.body ?? {}).projectPath, res, 'projectPath');
  if (!projectPath) return;
  const id = Number(req.params.id);
  const change = Number.isInteger(id) ? acknowledgeFreezeChange(projectPath, id, personFrom(req).author) : null;
  if (!change) { res.status(404).json({ error: 'No such freeze change on this project' }); return; }
  broadcast('freeze-changed', { projectRoot: projectPath, acknowledged: change.id });
  res.json(change);
});

// --- CDev Phase 8 — Audio capture REST surface ---

app.post('/api/audio/start', (req, res) => {
  const { audioBuffer, AudioRequestError } = _lazy___services_audio_buffer_service;
  try {
    audioBuffer.startCapture((req.body ?? {}).maxBufferSeconds);
  } catch (err) {
    if (err instanceof AudioRequestError) { res.status(400).json({ error: err.message }); return; }
    throw err;
  }
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
  const { audioBuffer, checkChunkMs, AudioRequestError } = _lazy___services_audio_buffer_service;
  const { audioBase64, durationMs } = (req.body ?? {}) as { audioBase64?: unknown; durationMs?: unknown };

  if (typeof audioBase64 !== 'string' || !audioBase64) {
    res.status(400).json({ error: 'audioBase64 (base64 text) and durationMs required' });
    return;
  }
  try {
    checkChunkMs(durationMs);
  } catch (err) {
    if (err instanceof AudioRequestError) { res.status(400).json({ error: err.message }); return; }
    throw err;
  }

  if (!audioBuffer.isCapturing()) {
    res.status(409).json({ error: 'Audio capture is not active' });
    return;
  }

  const data = Buffer.from(audioBase64, 'base64');
  audioBuffer.addChunk(data, durationMs as number);
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
  // Confirming a pairing gives a device access: the person's (grant-guard.ts).
  if (!mayGrant(req)) {
    res.status(403).json({ error: grantRefusal('pairings', 'Settings → Devices → Pair Mobile Device') });
    return;
  }
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
    if (!removed) { res.status(404).json({ error: 'device not found' }); return; }
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
    // What a paired device may do is the person's to decide (grant-guard.ts).
    if (Array.isArray(capabilities) && !mayGrant(req)) {
      res.status(403).json({ error: grantRefusal('a device\'s capabilities', 'Settings → Devices') });
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
    if (!sent) { res.status(404).json({ error: 'No such remote terminal on a connected peer' }); return; }
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
    // The app window is the person; plain HTTP is recorded as unverified (0.4d).
    const sent = peerService.respondToInputRequest(req.params.requestId, response, actorFrom(req));
    if (!sent) { res.status(404).json({ error: 'No pending input request with that id' }); return; }
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
    if (!peerService.unregisterPushToken(req.params.fingerprint)) {
      res.status(404).json({ error: 'no push token for that device' });
      return;
    }
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
    // The app window is the person; plain HTTP is unverified (0.4d).
    const doc = svc.createSystemDoc({
      projectPath, title, body, owner, tags, references, slug,
      author, authorType: personFrom(req).authorType,
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
    // Named fields only, and the author from how the request arrived. The
    // whole body went through, so `author` / `authorType` in it put anyone's
    // name on the edit (Phase 32 §0.4l).
    const { title, body, owner, tags, references } = req.body || {};
    const identity = getSettings().identity;
    const updated = svc.updateSystemDoc(req.params.uid, {
      title, body, owner, tags, references,
      author: identity.email || identity.displayName || 'human',
      authorType: personFrom(req).authorType,
    });
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
  if (!ok) { res.status(404).json({ error: 'not found' }); return; }
  broadcast('system-doc-removed', { uid: req.params.uid });
  saveNow(() => exportDatabase());
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
  // A tree change the item tree cannot hold (see assertValidParent) is the
  // caller's mistake, not the server's.
  if (err instanceof planItemService.PlanItemStructureError) {
    if (!res.headersSent) res.status(400).json({ error: err.message });
    return;
  }
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
        void startPlanFileWatcher(proj.path);
        void startRecordWatcher(proj.path);
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
  // A guarded plan document changed on disk is settled when its hold is answered (B7.5b).
  registerDiskHoldSettling();
  await initParser();

  // Phase 32 B1: keep every agent event that is broadcast, from here on.
  // This launch's token is masked if a tool argument ever carries it.
  // How long things are kept is the person's (B10.2); the log files learn it here.
  setLogRetention(retentionDays());
  startAgentEventLog(addBroadcastTarget, () => [getCapabilityToken()]);
  // B1.2: what the app records itself (a spec body edited) goes out the same way.
  setEventPublisher(broadcast);
  // B5.1: replay frames, at a turn's end, a status change and a commit, for
  // the project the server holds and never while it scans.
  setHeldProject(() => ({ path: lastScannedProject, scanning: scanInFlight ? scanInFlight.path : null }));
  setFramePublisher(broadcast);
  startReplayFrames();
  setRecordedListener((evt) => noteAgentActivity(evt));
  // C3.1: a state change made here is written as this device's record (when
  // its project shares task state); a teammate's record taken is told to the
  // window; a plan imported from its files has its records read.
  planItemService.setStateWriteListener((item, by) => { writeRecordFor(item, by); });
  // Every recorded plan event reaches the open windows' Activity as it happens.
  planEventService.setPlanEventListener((event) => { broadcast('plan-event', { planUid: event.planUid, event }); });
  setRecordAppliedListener((item) => {
    broadcast('plan-item-updated', { planUid: item.planUid, itemUid: item.uid, kind: item.kind, changes: { status: item.status, fromRecord: true } });
  });
  setPlanImportedListener((planUid, projectRoot) => {
    readAndTell(projectRoot, planUid);
    // A teammate's materials arrive with the plan's files (C3.4c).
    try { _lazy___services_artefact_watcher.watchPlanArtefacts(projectRoot, planUid); } catch (err) { console.warn('[Artefacts] Could not watch an imported plan\'s files:', err); }
  });
  // C3.2: people setting a task two ways at once is a signal; it starts and
  // ends with the records, so the project's signals are refreshed then.
  setSplitChangedListener((projectRoot) => { refreshSignals(projectRoot).catch((err) => console.warn('[Awareness] refresh failed:', err)); });
  // D1.5a: a teammate's test run arrived (or was forgotten): grounding is asked again.
  setRunsChangedListener((projectRoot) => { broadcast('tests-reported', { project: projectRoot }); });
  // Phase 33 C7: a teammate's check run arrived (or sharing went off): the Checks view asks again.
  setCheckRunsChangedListener((projectRoot) => { broadcast('check-runs-changed', { project: projectRoot }); });
  planItemService.setStatusChangeListener(({ planUid, itemUid }) => {
    const plan = planService.getPlan(planUid);
    if (!plan?.projectPath) return;
    const acting = actingSession();
    requestFrame({
      projectPath: plan.projectPath, reason: 'status', ref: itemUid,
      sessionId: acting?.sessionId ?? null, agentType: acting?.agentType ?? null,
      workstreamRoot: workstreamOfItem(itemUid),
    });
  });

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

  // Phase 32 C4.2a — recurring runs start as their moment comes while the app
  // runs; one that fell due while it was closed is asked about in the inbox.
  startRecurringScheduler((projectRoot, run) => {
    // C4.3b — the schedule may start a run's agent, when the person turned it on here.
    startRunAgent(projectRoot, run.info.rule, run.plan, true, (session) => broadcast('terminal-created', { session }));
    broadcast('plan-created', { plan: run.plan });
    broadcast('recurring-changed', { project: projectRoot });
  });

  // Phase 32 E5 — keep remotes current, only when Settings → Git says so
  // (off by default), and only for the project open in the window.
  startRemoteKeeper({
    settings: () => getSettings().git,
    activeRoot: () => getActiveProjectPath(),
    onFetched: (projectRoot) => broadcast('git-remotes-changed', { project: projectRoot }),
  });

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
        seedHeads(restore.path);
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
  // Headless (`codetrellis serve`, Phase 32 D1.1): a cloud session or a CI
  // job runs this for its agent, with nobody to offer an update to and no
  // reason to ask the network anything. It makes no request of its own.
  const headless = process.env.CODETRELLIS_HEADLESS === '1';
  if (!headless) {
    try {
      startUpdatePolling();
    } catch (err) {
      console.warn('[Backend] Update polling failed to start:', err);
    }
  }

  // CDev Phase 9 — peer connection manager. Starts mDNS discovery
  // and prepares for QR-based WebRTC pairing. Best-effort: if mDNS
  // fails (e.g. port 5353 in use), the rest of the app is unaffected.
  // Nor headless: no discovery and no phone to pair with on a runner.
  if (!headless) {
    try {
      peerService.startPeerManager();
    } catch (err) {
      console.warn('[Backend] Peer connection manager failed to start:', err);
    }
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

const execFileAsync = promisify(execFile);

async function captureGitCommitSnapshot(projectPath: string, commitHash: string): Promise<GitCommitSnapshotResult | null> {
  // Never hand git something it would read as an option (git-safety).
  if (!isSafeGitRef(commitHash)) return null;
  try {
    // Asynchronous throughout: this reads and parses a whole commit, and the
    // server answers nothing else while the event loop is held (see git-blobs).
    const { stdout: commitMeta } = await execFileAsync(
      'git',
      ['-C', projectPath, 'show', '-s', '--format=%H\t%h', commitHash],
      { encoding: 'utf8' },
    );
    if (!commitMeta.trim()) return null;

    const [resolvedCommitHash, shortCommitHash] = commitMeta.trim().split('\t');
    const { stdout: fileListOutput } = await execFileAsync(
      'git',
      ['-C', projectPath, 'ls-tree', '-r', '--name-only', resolvedCommitHash],
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
    );

    // Only what a parser reads: images, lockfiles and the rest were fetched and thrown away.
    const parseable = new Set(getParseableExtensions());
    const relativePaths = fileListOutput
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && parseable.has(path.extname(line).toLowerCase()));

    const contents = await readBlobsAtCommit(projectPath, resolvedCommitHash, relativePaths);
    const parsedFiles: NonNullable<ReturnType<typeof parseVirtualFile>>[] = [];
    let sinceYield = 0;
    for (const [relativePath, content] of contents) {
      const parsed = parseVirtualFile(path.join(projectPath, relativePath), content);
      if (parsed) parsedFiles.push(parsed);
      if (++sinceYield >= 8) { sinceYield = 0; await new Promise<void>((r) => setImmediate(r)); }
    }

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
