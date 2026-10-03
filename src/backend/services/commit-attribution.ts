/**
 * Who made a commit, as far as CodeTrellis knows, and how it knows (Phase
 * 32 E3, E4).
 *
 * The git author is always the commit's own and is never replaced, as
 * GitLens shows it. On top of it, in order of how sure the knowledge is:
 *
 *  - **commit message**: CodeTrellis's own `agent: <name>` line, or a
 *    `Co-Authored-By:` trailer naming an agent (Claude Code, Codex and
 *    others write one);
 *  - **seen**: a replay frame recorded the commit landing while an agent's
 *    session was being recorded there;
 *  - **timing**: the commit was made while an agent's session was open in
 *    the same checkout. Said as "probably", since a person in that checkout
 *    could have committed too.
 *
 * Where the session is known, the task it had claimed and that task's plan
 * are added. With none of these, the commit is the git author's alone.
 */

import fs from 'node:fs';
import { getDb } from './database';
import { framesByCommit } from './replay-frames';

export type AttributionHow = 'commit message' | 'seen' | 'timing';

export interface Attribution {
  agent: string;
  how: AttributionHow;
  /** Said plainly, with how. */
  words: string;
  sessionId?: string | null;
  /** The task the session had claimed, and its plan, when known. */
  task?: { uid: string; title: string } | null;
  plan?: { uid: string; title: string } | null;
}

/** What CodeTrellis recorded, injected so the rules can be tested without a database. */
export interface Knowledge {
  /** By full sha: who CodeTrellis saw working when it landed. */
  seenBy(shas: string[]): Map<string, { agentType: string | null; sessionId: string | null; workstreamRoot: string | null }>;
  /** The agent session open in this checkout at a time, if any. */
  sessionAt(checkoutRoot: string, at: number): { sessionId: string; agentType: string } | null;
  /** The task a session claimed, and its plan. */
  taskOf(sessionId: string): { task: { uid: string; title: string }; plan: { uid: string; title: string } } | null;
}

export const NO_KNOWLEDGE: Knowledge = { seenBy: () => new Map(), sessionAt: () => null, taskOf: () => null };

/** Agents whose names appear in `Co-Authored-By:` trailers. */
const AGENT_NAMES = /\b(claude|codex|copilot|cursor|gemini|aider|devin|windsurf|amp)\b/i;

/** What the commit message says about who made it: the `agent:` line, or an agent's Co-Authored-By trailer. */
export function agentFromMessage(body: string): Pick<Attribution, 'agent' | 'how' | 'words'> | null {
  const line = body.match(/^agent:\s*(\S+)/m);
  if (line) return { agent: line[1], how: 'commit message', words: `${line[1]}, from the commit message` };
  for (const m of body.matchAll(/^Co-Authored-By:\s*([^<\n]+?)\s*<[^>\n]*>\s*$/gim)) {
    const name = m[1].match(AGENT_NAMES);
    if (name) {
      const agent = name[1].toLowerCase();
      return { agent, how: 'commit message', words: `${agent}, from the commit's Co-Authored-By trailer (${m[1].trim()})` };
    }
  }
  return null;
}

const basename = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p;

/**
 * Attribute each commit: the message first, then what was seen, then
 * timing in the checkout it was read in. Commits with none are left out of the map.
 */
export function attributeCommits(
  rows: ReadonlyArray<{ sha: string; at: number; body: string }>,
  /** The checkout these commits were read in, for timing; null for a ref, which no one checkout made. */
  checkoutRoot: string | null,
  know: Knowledge = NO_KNOWLEDGE,
): Map<string, Attribution> {
  const out = new Map<string, Attribution>();
  const seen = know.seenBy(rows.map((r) => r.sha));
  for (const r of rows) {
    const frame = seen.get(r.sha);
    const fromMessage = agentFromMessage(r.body);
    let a: Attribution | null = fromMessage ? { ...fromMessage, sessionId: frame?.sessionId ?? null } : null;
    if (!a && frame?.agentType) {
      a = {
        agent: frame.agentType, how: 'seen', sessionId: frame.sessionId,
        words: `${frame.agentType}, seen: it landed while CodeTrellis recorded ${frame.agentType}'s session${frame.workstreamRoot ? ` in ${basename(frame.workstreamRoot)}` : ''}`,
      };
    }
    if (!a && checkoutRoot) {
      const open = know.sessionAt(checkoutRoot, r.at);
      if (open) {
        a = {
          agent: open.agentType, how: 'timing', sessionId: open.sessionId,
          words: `probably ${open.agentType}: committed while ${open.agentType}'s session was open in this checkout`,
        };
      }
    }
    if (!a) continue;
    if (a.sessionId) {
      const t = know.taskOf(a.sessionId);
      if (t) { a.task = t.task; a.plan = t.plan; }
    }
    out.set(r.sha, a);
  }
  return out;
}

/** A session is still "open" for this long after it was last seen. */
const SESSION_GRACE_MS = 10 * 60_000;
const trim = (p: string) => p.replace(/[\\/]+$/, '');

/** What this computer's database knows, for a project. */
export function recordedKnowledge(projectPath: string): Knowledge {
  return {
    seenBy: (shas) => framesByCommit(projectPath, shas),
    sessionAt: (checkoutRoot, at) => {
      // Sessions are placed by the folder's realpath; a checkout opened as a
      // project through a link (macOS's /var, /tmp) asks in its opened
      // spelling. Either names the same checkout.
      const spelled = trim(checkoutRoot);
      let real = spelled;
      try { real = fs.realpathSync.native(spelled); } catch { /* gone: the spelling is all there is */ }
      const row = getDb().exec(
        `SELECT session_id, agent_type FROM agent_sessions
         WHERE workstream_root IN (?, ?) AND connected_at <= ? AND last_seen + ? >= ?
         ORDER BY connected_at DESC LIMIT 1`,
        // A commit's time is whole seconds: one made in the second the session started is in it.
        [spelled, real, at + 999, SESSION_GRACE_MS, at],
      )[0]?.values?.[0];
      return row ? { sessionId: String(row[0]), agentType: String(row[1]) } : null;
    },
    taskOf: (sessionId) => {
      const row = getDb().exec(
        `SELECT i.uid, i.title, p.uid, p.title FROM plan_items i JOIN plans p ON p.uid = i.plan_uid
         WHERE i.assignee_session = ? ORDER BY i.rowid DESC LIMIT 1`,
        [sessionId],
      )[0]?.values?.[0];
      return row ? { task: { uid: String(row[0]), title: String(row[1]) }, plan: { uid: String(row[2]), title: String(row[3]) } } : null;
    },
  };
}

/**
 * A path a git read may take from a request: relative to the project, not
 * climbing out of it, not an option and not one of git's magic pathspecs.
 */
export function isProjectRelativePath(rel: unknown): rel is string {
  return typeof rel === 'string' && rel.length > 0 && !rel.startsWith('-') && !rel.startsWith(':')
    && !rel.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(rel) && !rel.split(/[\\/]/).includes('..');
}
