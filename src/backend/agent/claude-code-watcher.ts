import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { AgentEvent } from '../../shared/types';
import { broadcast } from '../server';

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const SESSIONS_DIR = path.join(CLAUDE_DIR, 'sessions');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

let watchInterval: ReturnType<typeof setInterval> | null = null;
let tailPosition = 0;
let activeSessionId: string | null = null;
let activeJsonlPath: string | null = null;
let eventCounter = 0;

/**
 * Find active Claude Code sessions matching a project path.
 */
function findActiveSession(projectRoot: string): { sessionId: string; jsonlPath: string } | null {
  if (!fs.existsSync(SESSIONS_DIR)) return null;

  const sessionFiles = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json'));

  for (const file of sessionFiles) {
    try {
      const session = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf-8'));

      // Check if session's cwd matches our project
      if (session.cwd !== projectRoot) continue;

      // Check if the process is still alive
      try {
        process.kill(session.pid, 0);
      } catch {
        continue; // Process is dead
      }

      // Find the JSONL file — Claude encodes paths as -Users-username-... (leading dash kept)
      const encodedPath = projectRoot.replace(/\//g, '-');
      const projectDir = path.join(PROJECTS_DIR, encodedPath);

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
  const numberedLines = lines.filter((l) => /^\s*\d+[\.\)]\s/.test(l));
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
 * Start watching for Claude Code activity in the given project.
 */
export function startClaudeCodeWatcher(projectRoot: string): void {
  stopClaudeCodeWatcher();

  // Try to find an active session immediately
  const session = findActiveSession(projectRoot);
  if (session) {
    activeSessionId = session.sessionId;
    activeJsonlPath = session.jsonlPath;
    // Start from end of file (only tail new entries)
    try {
      tailPosition = fs.statSync(activeJsonlPath).size;
    } catch {
      tailPosition = 0;
    }
    console.log(`[ClaudeWatcher] Found active session: ${activeSessionId}`);
    broadcast('agent-event', makeEvent('session_start', { sessionId: activeSessionId }));
  } else {
    console.log('[ClaudeWatcher] No active Claude Code session found, polling...');
  }

  // Poll every 2 seconds: check for new sessions and tail JSONL
  watchInterval = setInterval(() => {
    if (!activeJsonlPath) {
      const session = findActiveSession(projectRoot);
      if (session) {
        activeSessionId = session.sessionId;
        activeJsonlPath = session.jsonlPath;
        try {
          tailPosition = fs.statSync(activeJsonlPath).size;
        } catch {
          tailPosition = 0;
        }
        console.log(`[ClaudeWatcher] Found active session: ${activeSessionId}`);
        broadcast('agent-event', makeEvent('session_start', { sessionId: activeSessionId }));
      }
    } else {
      tailJsonl();
    }
  }, 2000);

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
