/**
 * The lines of parallel work in a repository (Phase 32 A1.3).
 *
 * A workstream is one working tree plus the agents in it. They are derived,
 * never created: from `git worktree list` for the folders, and from the
 * sessions A1.1 bound (MCP) and A1.2 followed (Claude Code's own log) for who
 * is in each. The main checkout is a worktree like any other; two or more
 * agents in one folder make it a **shared** checkout, the weak case the UI
 * names rather than hides (awareness spec §4.1).
 *
 * `deriveWorkstreams` is pure, so the rules are tested without git or a
 * database; `listWorkstreams` only gathers its inputs.
 */

import fs from 'node:fs';
import type { AgentSessionInfo, Workstream, WorkstreamAgent, WorkstreamChanges, WorkstreamIntent } from '../../shared/types';
import { listWorktrees, type Worktree } from './worktree-service';
import { getActiveSessions } from './session-service';
import { getIntent } from './intent-service';
import { getChanges, syncWorkstreamWatchers, watchRefs } from './workstream-watch-service';
import { withSymbolChanges, type SymbolParser } from './workstream-symbols';
import { branchWorkstreamsOf, showAt } from './branch-workstreams';
import { getEffectiveSensorConfig } from './project-config-service';
import { listTrustedRoots } from './trusted-roots';
import { getRecentProject } from './recent-projects-service';

/** A Claude Code session the watcher follows (see `claude-code-watcher.ts`). */
export interface ClaudeLogSession {
  sessionId: string;
  workstreamRoot: string;
}

export interface WorkstreamInputs {
  worktrees: readonly Worktree[];
  mcpSessions: readonly AgentSessionInfo[];
  claudeSessions: readonly ClaudeLogSession[];
  /** Each working tree's changes (A1.4). Absent means none known. */
  changes?: (folder: string) => WorkstreamChanges;
  realpath?: (p: string) => string;
}

const NO_CHANGES: WorkstreamChanges = { base: null, files: [], truncated: false };

const isClaude = (agentType: string) => agentType.toLowerCase().includes('claude');

/**
 * Every working tree of the repository, with the agents in each.
 *
 * Sessions are placed by comparing folders canonically, because a session is
 * bound to a root as the user opened it and git lists worktrees by their real
 * path; the two differ for anything reached through a symlink.
 *
 * **One Claude agent, seen twice.** A Claude Code session connected to
 * CodeTrellis is both an MCP session and a session in Claude's log, under two
 * unrelated ids. Nothing links them except the folder, so within one folder
 * each Claude MCP session accounts for one log session, and only the log
 * sessions left over are added (a Claude session that never connected is
 * still an agent at work). Two Claude agents in one folder with only one
 * connected therefore count as two, which is right; which log belongs to
 * which connection is not knowable here, and nothing below depends on it.
 */
export function deriveWorkstreams(input: WorkstreamInputs): Workstream[] {
  const realpath = input.realpath ?? fs.realpathSync.native;
  const canon = (p: string) => {
    try {
      return realpath(p);
    } catch {
      return p;
    }
  };

  const trees = input.worktrees.filter((w) => !w.bare && !w.prunable);
  const byCanon = new Map(trees.map((w) => [canon(w.path), w.path]));
  const agentsIn = new Map<string, WorkstreamAgent[]>(trees.map((w) => [w.path, []]));
  const logsIn = new Map<string, ClaudeLogSession[]>();

  for (const s of input.mcpSessions) {
    if (s.status !== 'active' || !s.workstreamRoot) continue;
    const tree = byCanon.get(canon(s.workstreamRoot));
    if (!tree) continue;
    agentsIn.get(tree)!.push({
      sessionId: s.sessionId,
      agentType: s.agentType,
      model: s.model ?? null,
      source: 'mcp',
      lastSeen: s.lastSeen,
    });
  }
  for (const s of input.claudeSessions) {
    const tree = byCanon.get(canon(s.workstreamRoot));
    if (!tree) continue;
    logsIn.set(tree, [...(logsIn.get(tree) ?? []), s]);
  }

  return trees.map((w) => {
    const agents = agentsIn.get(w.path)!;
    const connectedClaude = agents.filter((a) => isClaude(a.agentType)).length;
    for (const log of (logsIn.get(w.path) ?? []).slice(connectedClaude)) {
      agents.push({ sessionId: log.sessionId, agentType: 'claude-code', model: null, source: 'claude-log', lastSeen: null });
    }
    const changes = input.changes?.(w.path) ?? NO_CHANGES;
    return {
      root: w.path,
      branch: w.branch,
      head: w.head,
      main: w.isMain,
      shape: agents.length >= 2 ? 'shared' : 'worktree',
      agents,
      changes,
      // Spec §4.1: idle is no agent AND no changes. A worktree an agent left
      // with work in it is still a line of work.
      idle: agents.length === 0 && changes.files.length === 0,
    };
  });
}

/**
 * Where the Claude sessions come from, published by the backend at startup.
 *
 * The watcher imports the server (to broadcast), and the server imports this
 * service, so importing the watcher here would be a cycle — the same
 * inversion `trusted-roots` uses for the active project.
 */
let claudeSource: () => readonly ClaudeLogSession[] = () => [];

export function setClaudeSessionSource(source: () => readonly ClaudeLogSession[]): void {
  claudeSource = source;
}

/**
 * How a changed file becomes symbols (A1.5), published by the backend: the
 * app's own tree-sitter parser, which this service does not import so that
 * it stays testable without the grammars loaded. Unset, files keep their
 * paths and carry no symbols.
 */
let symbolParser: SymbolParser | null = null;

export function setSymbolParser(parse: SymbolParser | null): void {
  symbolParser = parse;
}

/** The parser set at boot, for others that need a file's functions (B4.2c). */
export function getSymbolParser(): SymbolParser | null {
  return symbolParser;
}

/**
 * The workstreams of the repository `projectRoot` belongs to. The caller has
 * already confined `projectRoot` to an opened project. Idle ones are left
 * out unless asked for. `fresh` recomputes folders nothing watches rather
 * than reusing a recent answer.
 */
export function listWorkstreams(projectRoot: string, opts: { includeIdle?: boolean; fresh?: boolean } = {}): Workstream[] {
  let claudeSessions: readonly ClaudeLogSession[] = [];
  try {
    claudeSessions = claudeSource();
  } catch { /* the watcher is optional; MCP sessions still place agents */ }
  // A folder that is not a git repository still has agents working in it:
  // it is one working tree, with no branch.
  const listed = listWorktrees(projectRoot);
  const worktrees: Worktree[] = listed.length
    ? listed
    : [{ path: projectRoot, branch: null, head: null, isMain: true, isCurrent: true, bare: false, prunable: false }];
  // Changes are measured from where each tree branched off the main
  // checkout's branch (or its commit, when detached).
  const main = worktrees.find((w) => w.isMain);
  const mainRef = main?.branch ?? main?.head ?? null;
  // Clones the person included (A1.7c), or opened: same repository, another
  // folder. Treated like a worktree from here on.
  const clones = listed.length ? cloneTrees(projectRoot, worktrees) : [];
  const cloneRoots = new Set(clones.map((c) => c.path));
  const derived = deriveWorkstreams({
    worktrees: [...worktrees, ...clones],
    mcpSessions: getActiveSessions(),
    claudeSessions,
    changes: (folder) => {
      const changes = getChanges(folder, mainRef, { fresh: opts.fresh });
      return symbolParser ? withSymbolChanges(folder, changes, symbolParser) : changes;
    },
  });
  const all = derived.map((w) => (cloneRoots.has(w.root) ? { ...w, shape: 'clone' as const } : w));
  // This listing is the discovery pass: watch what is active, and stop
  // watching what went idle.
  syncWorkstreamWatchers(
    all.filter((w) => !w.idle).map((w) => ({ folder: w.root, mainRef })),
    all.map((w) => w.root),
  ).catch(() => {});

  // Branches with no checkout here (A1.7a): committed work, no folder, no
  // agent on this machine. Read from local refs only, never fetched.
  const branches = main && listed.length ? branchWorkstreams(main.path, main.branch, mainRef, worktrees, projectRoot) : [];
  if (main && listed.length) watchRefs(main.path);
  const withBranches = withIntents([...all, ...branches]);
  return opts.includeIdle ? withBranches : withBranches.filter((w) => !w.idle);
}

/**
 * Each workstream with the intents its agents declared (A2.4). Only a
 * session placed in a workstream, so still active, counts: an intent
 * belongs to the work in progress, not to an agent that has gone.
 */
function withIntents(all: Workstream[]): Workstream[] {
  return all.map((w) => {
    const intents = w.agents.map((a) => getIntent(a.sessionId)).filter((i): i is WorkstreamIntent => i !== null);
    return intents.length ? { ...w, intents } : w;
  });
}

function branchWorkstreams(repo: string, mainBranch: string | null, mainRef: string | null, worktrees: readonly Worktree[], projectRoot: string): Workstream[] {
  let windowDays: number;
  try {
    windowDays = getEffectiveSensorConfig(projectRoot).awareness.branchWindowDays;
  } catch {
    windowDays = 7;
  }
  const checkedOut = new Set(worktrees.map((w) => w.branch).filter((b): b is string => !!b));
  return branchWorkstreamsOf(repo, { mainBranch, mainRef, checkedOut, windowDays }).map((b) => ({
    root: `branch:${b.short}`,
    ref: b.ref,
    branch: b.short,
    head: b.head,
    main: false,
    shape: 'branch' as const,
    agents: [],
    changes: symbolParser
      ? withSymbolChanges(repo, b.changes, symbolParser, { head: b.head, read: (rel) => showAt(repo, b.head, rel) })
      : b.changes,
    idle: b.changes.files.length === 0,
  }));
}

const canonicalPath = (p: string): string => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return p;
  }
};

/**
 * Other checkouts of the same repository that the person trusts: a folder
 * they included when an agent reported it (A1.7c), or opened themselves.
 * "Same repository" is the normalised origin URL recorded when each was
 * opened — no git runs in a folder to decide it. A project with no origin has
 * no clones by this rule.
 */
function cloneTrees(projectRoot: string, worktrees: readonly Worktree[]): Worktree[] {
  const origin = getRecentProject(projectRoot)?.originUrl ?? null;
  if (!origin) return [];
  const own = new Set(worktrees.map((w) => canonicalPath(w.path)));
  own.add(canonicalPath(projectRoot));
  const out: Worktree[] = [];
  for (const root of listTrustedRoots()) {
    if (own.has(canonicalPath(root))) continue;
    if (getRecentProject(root)?.originUrl !== origin) continue;
    const self = listWorktrees(root).find((w) => w.isMain);
    out.push({ path: root, branch: self?.branch ?? null, head: self?.head ?? null, isMain: false, isCurrent: false, bare: false, prunable: false });
  }
  return out;
}
