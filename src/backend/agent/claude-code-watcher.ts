import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { AgentEvent } from '../../shared/types';
import { broadcast } from '../server';
import { recordTokens } from '../services/budget-service';
import { eventId } from '../services/agent-event-log';
import { matchWorkstreamRoot, candidateWorkstreamRoots } from '../services/workstream-binding';

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

/**
 * Every Claude Code session being followed, by its session id (Phase 32 A1.2).
 *
 * This was one session: the first live one whose cwd equalled the opened
 * project exactly. Two agents in two worktrees of the same repository, or one
 * in a package folder, were invisible — and parallel work is the case Track A
 * exists for. Now every live session under a folder CodeTrellis trusts is
 * followed at once, and each carries the folder it belongs to.
 */
interface Watched {
  jsonlPath: string;
  /** Bytes of the jsonl already read. */
  position: number;
  /** The trusted root the session works in, as the user opened it. */
  workstreamRoot: string;
}
const watched = new Map<string, Watched>();

/** The session most recently followed, for the one-session fields of the status. */
let lastBound: string | null = null;

interface LiveSession {
  sessionId: string;
  jsonlPath: string;
  workstreamRoot: string;
}

/**
 * The folders Claude Code keeps a session's jsonl under, for a cwd.
 *
 * Claude Code names the directory after the cwd with separators turned into
 * dashes. Older releases replaced only `/`; current ones replace every
 * character that is not a letter or digit (so `.` in `my.repo` becomes `-`
 * too). Both are tried, the older first because it is what this watcher
 * has always read.
 */
function jsonlDirsFor(cwd: string): string[] {
  const dirs = [cwd.replace(/\//g, '-'), cwd.replace(/[^a-zA-Z0-9]/g, '-')];
  return [...new Set(dirs)].map((d) => path.join(projectsDir(), d));
}

/**
 * Every live Claude Code session working inside one of `folders`.
 *
 * A session's cwd is matched to the folder it falls in (the deepest, when
 * folders nest — a worktree inside the main checkout's tree), so an agent run
 * from `packages/api` belongs to the repository it is in. The cwd is only
 * used to CHOOSE among folders we already trust; nothing outside Claude's own
 * directory is read because of it.
 */
function findLiveSessions(folders: readonly string[]): LiveSession[] {
  if (!folders.length || !fs.existsSync(sessionsDir())) return [];
  const live: LiveSession[] = [];
  for (const file of fs.readdirSync(sessionsDir()).filter((f) => f.endsWith('.json'))) {
    try {
      const session = JSON.parse(fs.readFileSync(path.join(sessionsDir(), file), 'utf-8'));
      if (typeof session.sessionId !== 'string' || typeof session.cwd !== 'string') continue;
      const workstreamRoot = matchWorkstreamRoot(session.cwd, folders);
      if (!workstreamRoot) continue;
      try {
        process.kill(session.pid, 0);
      } catch {
        continue; // the process has exited
      }
      const jsonlPath = jsonlDirsFor(session.cwd)
        .map((dir) => path.join(dir, `${session.sessionId}.jsonl`))
        .find((p) => fs.existsSync(p));
      if (jsonlPath) live.push({ sessionId: session.sessionId, jsonlPath, workstreamRoot });
    } catch {
      continue;
    }
  }
  return live;
}

/**
 * Parse a JSONL line into an AgentEvent if relevant.
 */
function parseJsonlEntries(line: string): AgentEvent[] {
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
      if (!Array.isArray(content)) return [];

      // One event per block. A message routinely carries several tool calls
      // (Claude Code batches independent reads and edits), and returning on
      // the first one undercounted every edit after it (Phase 32 bug 3).
      const events: AgentEvent[] = [];
      for (const block of content) {
        if (block.type === 'tool_use') {
          events.push(toolUseEvent(block.name, block.input || {}));
        } else if (block.type === 'text') {
          // Check for plan-like content
          const text = block.text || '';
          if (isPlanLike(text)) {
            events.push(makeEvent('plan_reported', {
              text: text.substring(0, 1000),
            }));
          }
        }
      }
      return events;
    }

    if (type === 'user') {
      return [makeEvent('session_start', {
        message: (entry.message?.content || '').substring(0, 200),
        timestamp: entry.timestamp,
      })];
    }

    return [];
  } catch {
    return [];
  }
}

/** The event one `tool_use` block becomes. */
function toolUseEvent(toolName: string, input: Record<string, unknown>): AgentEvent {
  if (toolName === 'Read') return makeEvent('file_changed', { action: 'read', file: input.file_path, tool: toolName });
  if (toolName === 'Write') return makeEvent('file_changed', { action: 'write', file: input.file_path, tool: toolName });
  if (toolName === 'Edit') return makeEvent('file_changed', { action: 'edit', file: input.file_path, tool: toolName });
  if (toolName === 'Bash') {
    return makeEvent('file_changed', { action: 'bash', command: String(input.command ?? '').substring(0, 200), tool: toolName });
  }
  if (toolName === 'Glob' || toolName === 'Grep') {
    return makeEvent('architecture_query', { tool: toolName, pattern: input.pattern || input.query });
  }
  // Generic tool call
  return makeEvent('file_changed', { action: 'tool', tool: toolName });
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
    id: eventId('cc'),
    timestamp: Date.now(),
    source: 'claude-code-watcher',
    type,
    payload,
  };
}

/**
 * Read one session's new lines and broadcast what they say.
 *
 * Every event is tagged with the session and its workstream, so two agents
 * working at once stay apart in the Timeline (turns are grouped by session)
 * and each can be placed on its own folder.
 */
function tailSession(sessionId: string, w: Watched): void {
  try {
    const stat = fs.statSync(w.jsonlPath);
    if (stat.size <= w.position) return;

    const fd = fs.openSync(w.jsonlPath, 'r');
    const buffer = Buffer.alloc(stat.size - w.position);
    fs.readSync(fd, buffer, 0, buffer.length, w.position);
    fs.closeSync(fd);

    // Only complete lines. A line Claude Code is still writing is read on the
    // next tick instead of being parsed half-way and lost.
    const text = buffer.toString('utf-8');
    const complete = text.lastIndexOf('\n') + 1;
    w.position += Buffer.byteLength(text.slice(0, complete), 'utf-8');

    for (const line of text.slice(0, complete).split('\n')) {
      if (!line.trim()) continue;
      for (const event of parseJsonlEntries(line)) {
        event.payload = { ...event.payload, sessionId, workstreamRoot: w.workstreamRoot };
        broadcast('agent-event', event);
      }
    }
  } catch {
    // File may have been rotated or deleted
  }
}

/**
 * How many ticks between looks for sessions that started or ended, while at
 * least one is followed. Five is ~10s at the default cadence — fast enough
 * that a new agent appears before anyone looks, slow enough that parsing
 * every session file stays negligible. With nothing followed it looks every
 * tick.
 */
const REBIND_CHECK_TICKS = 5;

/**
 * Start following a session and announce it.
 *
 * Tailing starts at the CURRENT end of the file, not the beginning: the
 * backlog of a session already in progress is history, and replaying it would
 * put a finished conversation through the Timeline as if it were happening now.
 */
function follow(session: LiveSession): void {
  let position = 0;
  try {
    position = fs.statSync(session.jsonlPath).size;
  } catch { /* a file that vanished starts from nothing */ }
  watched.set(session.sessionId, { jsonlPath: session.jsonlPath, position, workstreamRoot: session.workstreamRoot });
  lastBound = session.sessionId;
  console.log(`[ClaudeWatcher] Following session ${session.sessionId} in ${session.workstreamRoot}`);
  broadcast('agent-event', makeEvent('session_start', {
    sessionId: session.sessionId,
    workstreamRoot: session.workstreamRoot,
  }));
}

/**
 * Reconcile the followed set with the sessions that are live now.
 *
 * A session that has gone is read one last time, so the lines it wrote as it
 * exited still arrive, and then dropped without an event: an agent that
 * exited is not news, and the Timeline already shows its last turn.
 */
function reconcile(live: LiveSession[]): void {
  const liveIds = new Set(live.map((s) => s.sessionId));
  for (const [id, w] of watched) {
    if (liveIds.has(id)) continue;
    tailSession(id, w);
    watched.delete(id);
    if (lastBound === id) lastBound = [...watched.keys()].pop() ?? null;
  }
  for (const s of live) if (!watched.has(s.sessionId)) follow(s);
}

/** Folders the watcher looks in: every trusted root and its live worktrees. */
type FolderSource = () => readonly string[];

/**
 * How long a folder list is reused. Listing worktrees runs git once per
 * trusted root, which is too much for every tick and not worth caching longer:
 * a worktree created for a new agent is followed within half a minute.
 */
const FOLDERS_TTL_MS = 30_000;

/**
 * Start watching for Claude Code activity.
 *
 * Every live session working in `projectRoot`, or in any other root
 * CodeTrellis trusts, or in one of their worktrees, is followed at once.
 * `folders` replaces that list (tests use it to avoid needing git and a
 * database).
 */
export function startClaudeCodeWatcher(projectRoot: string, folders?: FolderSource): void {
  stopClaudeCodeWatcher();

  let cached: { at: number; list: readonly string[] } | null = null;
  const currentFolders = (): readonly string[] => {
    if (folders) return folders();
    if (cached && Date.now() - cached.at < FOLDERS_TTL_MS) return cached.list;
    let list: string[];
    try {
      list = [...new Set([projectRoot, ...candidateWorkstreamRoots()])];
    } catch {
      list = [projectRoot];
    }
    cached = { at: Date.now(), list };
    return list;
  };

  reconcile(findLiveSessions(currentFolders()));
  if (!watched.size) console.log('[ClaudeWatcher] No active Claude Code session found, polling...');

  // Look for sessions that started or ended, then read what the followed ones
  // wrote.
  //
  // Looking again is the point. This used to bind once and then only ever
  // tail, so when a user exited Claude Code and started a fresh session in the
  // same directory — which writes a DIFFERENT <sessionId>.jsonl — it kept
  // statting the old, now-static file forever, and the Timeline, the
  // detected-plan banner and token accounting all went quietly dead.
  let ticksSinceCheck = 0;
  watchInterval = setInterval(() => {
    if (!watched.size || ++ticksSinceCheck >= REBIND_CHECK_TICKS) {
      ticksSinceCheck = 0;
      reconcile(findLiveSessions(currentFolders()));
    }
    for (const [id, w] of watched) tailSession(id, w);
  }, pollIntervalMs());

  console.log(`[ClaudeWatcher] Watching for Claude Code sessions in ${projectRoot} and its workstreams`);
}

export function stopClaudeCodeWatcher(): void {
  if (watchInterval) {
    clearInterval(watchInterval);
    watchInterval = null;
  }
  watched.clear();
  lastBound = null;
}

export interface WatchedSession {
  sessionId: string;
  jsonlPath: string;
  workstreamRoot: string;
}

/**
 * What the watcher is following. `sessionId` and `jsonlPath` name the session
 * most recently followed, as they did when there could be only one; `sessions`
 * is all of them.
 */
export function getWatcherStatus(): {
  watching: boolean;
  sessionId: string | null;
  jsonlPath: string | null;
  sessions: WatchedSession[];
} {
  const latest = lastBound ? watched.get(lastBound) : undefined;
  return {
    watching: watchInterval !== null,
    sessionId: latest ? lastBound : null,
    jsonlPath: latest?.jsonlPath ?? null,
    sessions: [...watched].map(([sessionId, w]) => ({ sessionId, jsonlPath: w.jsonlPath, workstreamRoot: w.workstreamRoot })),
  };
}
