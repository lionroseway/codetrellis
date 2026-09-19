/**
 * Stuck sensor — CDev Phase 4.4.
 *
 * Watches the MCP tool-call stream for patterns indicating an agent
 * is looping without making progress. When a heuristic fires, posts
 * a `stuck` channel event as a soft pause-hint — informational only,
 * never interrupts the agent.
 *
 * Three heuristics (all conservative defaults, default-off):
 *
 *   1. **Repetition** — same tool called N+ times consecutively with
 *      low argument variation (< 30% Jaccard similarity change).
 *   2. **Error loop** — same tool errors N+ times in the last 10 calls.
 *   3. **Idle stall** — tool calls arriving but no file-changed
 *      broadcast in M minutes.
 *
 * Cooldown: after a heuristic fires, it's suppressed for the same
 * session for 10 minutes so we don't spam.
 *
 * The sensor is off by default; enabled per-project via
 * `sensors.stuck.enabled = true` in `.codetrellis/config.json`.
 */

import { getEffectiveSensorConfig } from './project-config-service';
import { onStuckDetected } from './sensor-bridge-service';

// --- Types -------------------------------------------------------------------

interface ToolCall {
  tool: string;
  args: string;
  phase: 'complete' | 'error';
  timestamp: number;
  sessionId: string;
  error?: string;
}

interface SessionWindow {
  calls: ToolCall[];
  /** Last time a file-changed or file-added event was observed. */
  lastFileActivity: number;
  /** Heuristic → timestamp of last fire. Cooldown check. */
  cooldowns: Map<string, number>;
}

// --- State -------------------------------------------------------------------

const windows = new Map<string, SessionWindow>();

/** How many recent calls to keep per session. */
const WINDOW_SIZE = 20;

/** How long a fired heuristic is suppressed (ms). */
const COOLDOWN_MS = 10 * 60_000;

/** Which project root to check config against, per session. */
const sessionProjectRoots = new Map<string, string>();

// --- Public API --------------------------------------------------------------

/**
 * Register the project root for a session so the sensor knows which
 * project config to consult. Called from the MCP tool wrapper when the
 * first tool call with a recognisable `project_path` / `project_root`
 * arg is seen.
 */
export function registerSessionProject(sessionId: string, projectRoot: string): void {
  if (!sessionProjectRoots.has(sessionId)) {
    sessionProjectRoots.set(sessionId, projectRoot);
  }
}

/**
 * Record a tool call from the MCP tool-call broadcast. Called from
 * the `broadcastToolEvent` hook in mcp/server.ts.
 */
export function recordToolCall(event: {
  tool: string;
  args: string;
  phase: 'complete' | 'error';
  sessionId: string | null;
  error?: string;
}): void {
  if (!event.sessionId) return;

  const sessionId = event.sessionId;
  let win = windows.get(sessionId);
  if (!win) {
    win = {
      calls: [],
      lastFileActivity: Date.now(),
      cooldowns: new Map(),
    };
    windows.set(sessionId, win);
  }

  const call: ToolCall = {
    tool: event.tool,
    args: event.args,
    phase: event.phase,
    timestamp: Date.now(),
    sessionId,
    error: event.error,
  };

  win.calls.push(call);
  if (win.calls.length > WINDOW_SIZE) {
    win.calls.shift();
  }

  // Try to extract project root from args for session registration.
  tryExtractProjectRoot(sessionId, event.args);

  // Run heuristics.
  const projectRoot = sessionProjectRoots.get(sessionId);
  if (!projectRoot) return;

  const cfg = getEffectiveSensorConfig(projectRoot);
  if (!cfg.stuck.enabled) return;

  checkRepetition(win, cfg.stuck.repetitionThreshold, sessionId, projectRoot);
  checkErrorLoop(win, cfg.stuck.errorLoopThreshold, sessionId, projectRoot);
  checkIdleStall(win, cfg.stuck.idleMinutes, sessionId, projectRoot);
}

/**
 * Notify the sensor that a file was changed or added in the project.
 * Resets the idle-stall clock for all sessions associated with that
 * project.
 */
export function recordFileActivity(projectRoot: string): void {
  const now = Date.now();
  for (const [sessionId, root] of sessionProjectRoots.entries()) {
    if (root === projectRoot) {
      const win = windows.get(sessionId);
      if (win) win.lastFileActivity = now;
    }
  }
}

/**
 * Clean up a session's window when the session disconnects.
 */
export function clearSession(sessionId: string): void {
  windows.delete(sessionId);
  sessionProjectRoots.delete(sessionId);
}

/** Test teardown. */
export function resetStuckSensor(): void {
  windows.clear();
  sessionProjectRoots.clear();
}

// --- Heuristics --------------------------------------------------------------

/**
 * Repetition: same tool called N+ times in a row with low argument
 * variation. "Low variation" = Jaccard similarity > 0.7 between
 * consecutive arg token sets.
 */
function checkRepetition(
  win: SessionWindow,
  threshold: number,
  sessionId: string,
  projectRoot: string,
): void {
  if (win.calls.length < threshold) return;
  if (isOnCooldown(win, 'repetition')) return;

  // Look at the tail of the window.
  const tail = win.calls.slice(-threshold);
  const toolName = tail[0].tool;

  // All must be the same tool.
  if (!tail.every((c) => c.tool === toolName)) return;

  // Check arg similarity: at least 70% of consecutive pairs must be > 0.7.
  let highSimilarityCount = 0;
  for (let i = 1; i < tail.length; i++) {
    if (jaccardSimilarity(tokenize(tail[i - 1].args), tokenize(tail[i].args)) > 0.7) {
      highSimilarityCount++;
    }
  }
  const similarityRatio = highSimilarityCount / (tail.length - 1);
  if (similarityRatio < 0.7) return;

  // Fire.
  setCooldown(win, 'repetition');
  const planUid = inferPlanUid(win);
  if (!planUid) return;

  onStuckDetected({
    planUid,
    sessionId,
    heuristic: 'repetition',
    description:
      `Agent called \`${toolName}\` ${threshold}+ times consecutively with similar arguments. ` +
      'This may indicate the agent is retrying without learning from the result.',
    projectRoot,
  });
}

/**
 * Error loop: same tool errors N+ times in the last 10 calls.
 */
function checkErrorLoop(
  win: SessionWindow,
  threshold: number,
  sessionId: string,
  projectRoot: string,
): void {
  if (win.calls.length < threshold) return;
  if (isOnCooldown(win, 'error-loop')) return;

  const recent = win.calls.slice(-10);
  const errors = recent.filter((c) => c.phase === 'error');
  if (errors.length < threshold) return;

  // Check if errors cluster on the same tool.
  const toolCounts = new Map<string, number>();
  for (const e of errors) {
    toolCounts.set(e.tool, (toolCounts.get(e.tool) ?? 0) + 1);
  }
  const [topTool, topCount] = [...toolCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topCount < threshold) return;

  setCooldown(win, 'error-loop');
  const planUid = inferPlanUid(win);
  if (!planUid) return;

  onStuckDetected({
    planUid,
    sessionId,
    heuristic: 'error-loop',
    description:
      `Agent's last 10 tool calls include ${topCount} errors on \`${topTool}\`. ` +
      'The agent may be stuck in an error-retry loop.',
    projectRoot,
  });
}

/**
 * Idle stall: tool calls arriving but no file activity in M minutes.
 */
function checkIdleStall(
  win: SessionWindow,
  idleMinutes: number,
  sessionId: string,
  projectRoot: string,
): void {
  if (win.calls.length < 3) return; // need a few calls to establish activity
  if (isOnCooldown(win, 'idle-stall')) return;

  const now = Date.now();
  const idleMs = idleMinutes * 60_000;
  const timeSinceFile = now - win.lastFileActivity;
  if (timeSinceFile < idleMs) return;

  // Verify the session has been active (calls) during the idle period.
  const recentCalls = win.calls.filter((c) => c.timestamp > now - idleMs);
  if (recentCalls.length < 3) return; // agent wasn't actively calling tools

  setCooldown(win, 'idle-stall');
  const planUid = inferPlanUid(win);
  if (!planUid) return;

  onStuckDetected({
    planUid,
    sessionId,
    heuristic: 'idle-stall',
    description:
      `Agent has been calling tools for ${idleMinutes}+ minutes without producing any file changes. ` +
      'This may indicate the agent is reading or reasoning but not making progress.',
    projectRoot,
  });
}

// --- Helpers -----------------------------------------------------------------

function isOnCooldown(win: SessionWindow, heuristic: string): boolean {
  const lastFire = win.cooldowns.get(heuristic);
  if (!lastFire) return false;
  return Date.now() - lastFire < COOLDOWN_MS;
}

function setCooldown(win: SessionWindow, heuristic: string): void {
  win.cooldowns.set(heuristic, Date.now());
}

/**
 * Infer the plan UID the agent is working on from recent tool args.
 * Looks for `plan_uid` or `planUid` in the args strings.
 */
function inferPlanUid(win: SessionWindow): string | null {
  // Walk backwards through recent calls for a plan_uid reference.
  for (let i = win.calls.length - 1; i >= 0; i--) {
    const match = win.calls[i].args.match(/"plan_uid"\s*:\s*"([^"]+)"/);
    if (match) return match[1];
    const match2 = win.calls[i].args.match(/"planUid"\s*:\s*"([^"]+)"/);
    if (match2) return match2[1];
  }
  return null;
}

/**
 * Try to extract a project root from tool args and register it
 * for this session (so subsequent calls can look up sensor config).
 */
function tryExtractProjectRoot(sessionId: string, args: string): void {
  if (sessionProjectRoots.has(sessionId)) return;
  const match = args.match(/"project_(?:root|path)"\s*:\s*"([^"]+)"/);
  if (match) {
    sessionProjectRoots.set(sessionId, match[1]);
  }
}

/**
 * Tokenize a string into a set of whitespace/punctuation-delimited
 * tokens. Used for Jaccard similarity of tool args.
 */
function tokenize(s: string): Set<string> {
  const tokens = s.toLowerCase().split(/[\s,{}[\]":]+/).filter(Boolean);
  return new Set(tokens);
}

/**
 * Jaccard similarity coefficient between two token sets.
 * Returns 0–1 (1 = identical).
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}
