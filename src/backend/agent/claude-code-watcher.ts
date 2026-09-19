import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { AgentEvent } from '../../shared/types';
import { broadcast } from '../server';
import { recordTokens } from '../services/budget-service';

/**
 * Where Claude Code keeps its session records.
 *
 * Read through functions rather than pinned at module load, and overridable,
 * because a hardcoded `~/.claude` is untestable by construction — which is
 * why this module had no tests and why a watcher that never rebound to a
 * restarted session went unnoticed. Same shape as `CODETRELLIS_DATA_DIR`.
 */
const claudeDir = (): string =>
  process.env.CODETRELLIS_CLAUDE_DIR || path.join(os.homedir(), '.claude');
const sessionsDir = (): string => path.join(claudeDir(), 'sessions');
const projectsDir = (): string => path.join(claudeDir(), 'projects');

/** Poll cadence. Overridable so a test does not have to wait real seconds. */
const pollIntervalMs = (): number =>
  Number(process.env.CODETRELLIS_WATCHER_POLL_MS) || 2000;

let watchInterval: ReturnType<typeof setInterval> | null = null;
let tailPosition = 0;
let activeSessionId: string | null = null;
let activeJsonlPath: string | null = null;
let eventCounter = 0;

/**
 * Find active Claude Code sessions matching a project path.
 */
function findActiveSession(projectRoot: string): { sessionId: string; jsonlPath: string } | null {
  if (!fs.existsSync(sessionsDir())) return null;

  const sessionFiles = fs.readdirSync(sessionsDir()).filter((f) => f.endsWith('.json'));

  for (const file of sessionFiles) {
    try {
      const session = JSON.parse(fs.readFileSync(path.join(sessionsDir(), file), 'utf-8'));

      // Check if session's cwd matches our project
      if (session.cwd !== projectRoot) continue;

      // Check if the process is still alive
      try {
        process.kill(session.pid, 0);
      } catch {
        continue; // Process is dead
      }

      // Find the JSONL file — Claude encodes paths by replacing every "/" with "-" (leading dash kept)
      const encodedPath = projectRoot.replace(/\//g, '-');
      const projectDir = path.join(projectsDir(), encodedPath);

      if (!fs.existsSync(projectDir)) continue;

      const jsonlFile = `${session.sessionId}.jsonl`;
      const jsonlPath = path.join(projectDir, jsonlFile);

      if (fs.existsSync(jsonlPath)) {
        return { sessionId: session.sessionId, jsonlPath };
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Parse a JSONL line into an AgentEvent if relevant.
 */
function parseJsonlEntry(line: string): AgentEvent | null {
  try {
    const entry = JSON.parse(line);
    const type = entry.type;

    if (type === 'assistant') {
      // Phase 23 — token usage. Claude Code records it on every
      // assistant entry, and it is the only place any agent tells us
      // what it actually spent. Reported to the budget service as a side
      // effect rather than as an event, because it is accounting, not
      // something the Timeline should render.
      //
      // Cache tokens are carried separately on purpose: for a long agent
      // session they dominate, and pricing them at the input rate would
      // overstate cost several-fold.
      const usage = entry.message?.usage;
      const sessionId = entry.sessionId ?? entry.session_id;
      if (usage && typeof sessionId === 'string') {
        try {
          recordTokens({
            sessionId,
            model: entry.message?.model ?? null,
            tokens: {
              inputTokens: usage.input_tokens ?? 0,
              outputTokens: usage.output_tokens ?? 0,
              cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
              cacheReadTokens: usage.cache_read_input_tokens ?? 0,
            },
          });
        } catch { /* accounting must never break the watcher */ }
      }

      const content = entry.message?.content;
      if (!Array.isArray(content)) return null;

      for (const block of content) {
        if (block.type === 'tool_use') {
          const toolName = block.name;
          const input = block.input || {};

          // File operations
          if (toolName === 'Read') {
            return makeEvent('file_changed', {
              action: 'read',
              file: input.file_path,
              tool: toolName,
            });
          }
          if (toolName === 'Write') {
            return makeEvent('file_changed', {
              action: 'write',
              file: input.file_path,
              tool: toolName,
            });
          }
          if (toolName === 'Edit') {
            return makeEvent('file_changed', {
              action: 'edit',
              file: input.file_path,
              tool: toolName,
            });
          }
          if (toolName === 'Bash') {
            return makeEvent('file_changed', {
              action: 'bash',
              command: (input.command || '').substring(0, 200),
              tool: toolName,
            });
          }
          if (toolName === 'Glob' || toolName === 'Grep') {
            return makeEvent('architecture_query', {
              tool: toolName,
              pattern: input.pattern || input.query,
            });
          }

          // Generic tool call
          return makeEvent('file_changed', {
            action: 'tool',
            tool: toolName,
          });
        }

        if (block.type === 'text') {
          // Check for plan-like content
          const text = block.text || '';
          if (isPlanLike(text)) {
            return makeEvent('plan_reported', {
              text: text.substring(0, 1000),
            });
          }
        }
      }
    }

    if (type === 'user') {
      return makeEvent('session_start', {
        message: (entry.message?.content || '').substring(0, 200),
        timestamp: entry.timestamp,
      });
    }

    return null;
  } catch {
    return null;
  }
}

function isPlanLike(text: string): boolean {
  // Simple heuristic: text contains numbered steps or bullet points with action verbs
  const lines = text.split('\n').filter((l) => l.trim());
  const numberedLines = lines.filter((l) => /^\s*\d+[.)]\s/.test(l));
  if (numberedLines.length >= 3) return true;

  const hasHeaders = lines.some((l) => l.startsWith('##') || l.startsWith('**'));
  const hasBullets = lines.filter((l) => /^\s*[-*]\s/.test(l)).length >= 3;
  if (hasHeaders && hasBullets) return true;

  return false;
}

function makeEvent(type: AgentEvent['type'], payload: Record<string, unknown>): AgentEvent {
  return {
    id: `cc-${++eventCounter}`,
    timestamp: Date.now(),
    source: 'claude-code-watcher',
    type,
    payload,
  };
}

/**
 * Read new lines from the JSONL file since last position.
 */
function tailJsonl(): void {
  if (!activeJsonlPath) return;

  try {
    const stat = fs.statSync(activeJsonlPath);
    if (stat.size <= tailPosition) return;

    const fd = fs.openSync(activeJsonlPath, 'r');
    const buffer = Buffer.alloc(stat.size - tailPosition);
    fs.readSync(fd, buffer, 0, buffer.length, tailPosition);
    fs.closeSync(fd);

    tailPosition = stat.size;

    const lines = buffer.toString('utf-8').split('\n').filter((l) => l.trim());

    for (const line of lines) {
      const event = parseJsonlEntry(line);
      if (event) {
        broadcast('agent-event', event);
      }
    }
  } catch {
    // File may have been rotated or deleted
  }
}

/**
 * How many 2s ticks between re-checks for a DIFFERENT session while bound.
 * Five is ~10s — fast enough that a restarted agent reappears before anyone
 * looks, slow enough that parsing every session file stays negligible.
 */
const REBIND_CHECK_TICKS = 5;

/**
 * Bind to a session's JSONL and announce it.
 *
 * Tailing starts at the CURRENT end of the file, not the beginning: the
 * backlog of a session already in progress is history, and replaying it would
 * put a finished conversation through the Timeline as if it were happening now.
 */
function bindToSession(session: { sessionId: string; jsonlPath: string }): void {
  const rebinding = activeSessionId !== null && activeSessionId !== session.sessionId;
  activeSessionId = session.sessionId;
  activeJsonlPath = session.jsonlPath;
  try {
    tailPosition = fs.statSync(activeJsonlPath).size;
  } catch {
    tailPosition = 0;
  }
  console.log(
    `[ClaudeWatcher] ${rebinding ? 'Rebound to new' : 'Found active'} session: ${activeSessionId}`,
  );
  broadcast('agent-event', makeEvent('session_start', { sessionId: activeSessionId }));
}

/**
 * Start watching for Claude Code activity in the given project.
 */
export function startClaudeCodeWatcher(projectRoot: string): void {
  stopClaudeCodeWatcher();

  // Try to find an active session immediately
  const session = findActiveSession(projectRoot);
  if (session) {
    bindToSession(session);
  } else {
    console.log('[ClaudeWatcher] No active Claude Code session found, polling...');
  }

  // Poll every 2 seconds: find or re-find a session, then tail it.
  //
  // The rebind is the point. This used to bind once and then only ever tail,
  // because `activeJsonlPath` was cleared by nothing but `stopClaudeCodeWatcher`
  // and the watcher is started only from the scan path. So when a user exited
  // Claude Code and started a fresh session in the same directory — which writes
  // a DIFFERENT <sessionId>.jsonl — this kept statting the old, now-static file
  // forever. `tailJsonl` sees `size <= tailPosition`, returns, and says nothing.
  // The Timeline, the detected-plan banner and token accounting all went quietly
  // dead for the rest of the project's life, with no error anywhere.
  //
  // `findActiveSession` parses every file in the sessions directory, so it runs
  // every tick only while unbound. Once bound it runs every REBIND_CHECK_TICKS,
  // which picks up a restarted agent within ~10s — far below the threshold where
  // anyone would notice, and a twentieth of the I/O.
  let ticksSinceRebindCheck = 0;
  watchInterval = setInterval(() => {
    const dueForRebindCheck =
      !activeJsonlPath || ++ticksSinceRebindCheck >= REBIND_CHECK_TICKS;

    if (dueForRebindCheck) {
      ticksSinceRebindCheck = 0;
      const session = findActiveSession(projectRoot);
      // A null result means no LIVE session right now — the agent has exited
      // and not been replaced. Stay bound: the file is static so tailing costs
      // nothing, and the next check rebinds the moment a new one appears.
      if (session && session.sessionId !== activeSessionId) bindToSession(session);
    }

    if (activeJsonlPath) tailJsonl();
  }, pollIntervalMs());

  console.log(`[ClaudeWatcher] Watching for Claude Code sessions in ${projectRoot}`);
}

export function stopClaudeCodeWatcher(): void {
  if (watchInterval) {
    clearInterval(watchInterval);
    watchInterval = null;
  }
  activeSessionId = null;
  activeJsonlPath = null;
  tailPosition = 0;
}

export function getWatcherStatus(): {
  watching: boolean;
  sessionId: string | null;
  jsonlPath: string | null;
} {
  return {
    watching: watchInterval !== null,
    sessionId: activeSessionId,
    jsonlPath: activeJsonlPath,
  };
}
