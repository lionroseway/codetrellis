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
import { listWorktreesAsync, type Worktree } from './worktree-service';
import { getActiveSessions } from './session-service';
import { getIntent } from './intent-service';
import { getChanges, isWatchedFolder, syncWorkstreamWatchers, watchRefs } from './workstream-watch-service';
import { uncachedSymbolFiles, withSymbolChanges, type SymbolParser } from './workstream-symbols';
import { branchWorkstreamsOf, notifyBranchesWarmed, showAtAsync } from './branch-workstreams';
import { getEffectiveSensorConfig } from './project-config-service';
import { listTrustedRoots } from './trusted-roots';
import { gitAsync } from './git-env';
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
  /** Each working tree's changes (A1.4), worked out beforehand. Absent means none known. */
  changes?: (folder: string) => WorkstreamChanges | undefined;
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
 *
 * Git runs without blocking the server (`gitAsync`): a listing used to hold
 * the backend's only thread for every call it made, and requests waited.
 *
 * Callers asking at the same time share one listing (Phase 33 follow-up): the
 * window asks six times as it opens (workstreams, source control,
 * comparands), and on a checkout with many worktrees each ran the whole pass
 * at once, every git call six times over. A `fresh` caller still gets a pass
 * of its own.
 */
export async function listWorkstreams(projectRoot: string, opts: { includeIdle?: boolean; fresh?: boolean } = {}): Promise<Workstream[]> {
  let all: Workstream[];
  if (opts.fresh) {
    all = await listAll(projectRoot, true);
  } else {
    let p = listing.get(projectRoot);
    if (!p) {
      p = listAll(projectRoot, false).finally(() => listing.delete(projectRoot));
      listing.set(projectRoot, p);
    }
    all = await p;
  }
  return opts.includeIdle ? [...all] : all.filter((w) => !w.idle);
}

/** How many trees' changes are measured at once: git runs off the server's thread. */
const CHANGES_CONCURRENCY = 6;

/** Listings under way, by project, for callers that ask while one runs. */
const listing = new Map<string, Promise<Workstream[]>>();

async function listAll(projectRoot: string, fresh: boolean): Promise<Workstream[]> {
  let claudeSessions: readonly ClaudeLogSession[] = [];
  try {
    claudeSessions = claudeSource();
  } catch { /* the watcher is optional; MCP sessions still place agents */ }
  // A folder that is not a git repository still has agents working in it:
  // it is one working tree, with no branch.
  const listed = await listWorktreesAsync(projectRoot);
  const worktrees: Worktree[] = listed.length
    ? listed
    : [{ path: projectRoot, branch: null, head: null, isMain: true, isCurrent: true, bare: false, prunable: false }];
  // Changes are measured from where each tree branched off the main
  // checkout's branch (or its commit, when detached).
  const main = worktrees.find((w) => w.isMain);
  const mainRef = main?.branch ?? main?.head ?? null;
  // Clones the person included (A1.7c), or opened: same repository, another
  // folder. Treated like a worktree from here on.
  const clones = listed.length ? await cloneTrees(projectRoot, worktrees) : [];
  const cloneRoots = new Set(clones.map((c) => c.path));
  const trees = [...worktrees, ...clones];
  // Each tree's changes first, a few trees at a time (Phase 33 follow-up: one
  // after another, 50 worktrees took 5 s before anything answered), then the
  // pure derivation. The opened project's own tree first, so it is the one
  // whose symbols fit the budget.
  const changesOf = new Map<string, WorkstreamChanges>();
  const folders = [...new Set(trees.filter((w) => !w.bare && !w.prunable).map((w) => w.path))];
  const todo = [...folders.filter((f) => f === projectRoot), ...folders.filter((f) => f !== projectRoot)];
  // Symbols inside a budget, as for branches (Phase 33 0.1, and this follow-up
  // for worktrees): 50 worktrees with 8,000 changed files between them were
  // all parsed before the first listing answered, which took minutes. A tree
  // past the budget is listed with its files and parsed in the background.
  let symbolBudget = INLINE_SYMBOL_FILES;
  const later: SymbolJob[] = [];
  const measure = async () => {
    for (let folder = todo.shift(); folder !== undefined; folder = todo.shift()) {
      const changes = await getChanges(folder, mainRef, { fresh });
      if (!symbolParser) { changesOf.set(folder, changes); continue; }
      const pending = uncachedSymbolFiles(folder, changes);
      if (pending <= symbolBudget) {
        symbolBudget -= pending;
        changesOf.set(folder, await withSymbolChanges(folder, changes, symbolParser));
      } else {
        changesOf.set(folder, changes);
        later.push({ folder, changes });
      }
    }
  };
  await Promise.all(Array.from({ length: CHANGES_CONCURRENCY }, measure));
  const derived = deriveWorkstreams({
    worktrees: trees,
    // Sessions read after the awaits above, so an agent that connected meanwhile is placed.
    mcpSessions: getActiveSessions(),
    claudeSessions,
    changes: (folder) => changesOf.get(folder),
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
  const branches = main && listed.length ? await branchWorkstreams(main.path, main.branch, mainRef, worktrees, projectRoot) : [];
  if (main && listed.length) void watchRefs(main.path).catch(() => {});
  // The rest of the worktrees' symbols once this answer is ready, not while it is worked out.
  warmSymbols(`${main?.path ?? projectRoot}\0trees`, main?.path ?? projectRoot, later);
  return withIntents([...all, ...branches]);
}

/** Where a line of work is checked out, and on which branch: all a section check needs. */
export interface WorkstreamPlace {
  /** A worktree or clone folder, or `branch:<name>` for a branch checked out nowhere. */
  root: string;
  branch: string | null;
}

/**
 * Every place work on this repository can happen, without what was changed
 * there: its worktrees, the clones the person trusts, and each branch checked
 * out in none of them (a remote one only where no local branch has its name).
 * A few cheap git reads.
 *
 * For the checks that only ask where a section is worked and which branch a
 * caller is on (Phase 32 C5.1). `listWorkstreams` measures every line of work
 * and parses the functions each branch changed; on a checkout with a few
 * hundred branches a claim waited on that for longer than an agent waits,
 * and timed out before it could claim anything.
 */
export async function listWorkstreamPlaces(projectRoot: string): Promise<WorkstreamPlace[]> {
  const worktrees = await listWorktreesAsync(projectRoot);
  if (!worktrees.length) return [];
  const trees = [...worktrees, ...(await cloneTrees(projectRoot, worktrees))].filter((w) => !w.bare && !w.prunable);
  const places: WorkstreamPlace[] = trees.map((w) => ({ root: w.path, branch: w.branch }));
  const checkedOut = new Set(trees.map((w) => w.branch).filter((b): b is string => Boolean(b)));
  const main = worktrees.find((w) => w.isMain) ?? worktrees[0];
  let refs: Array<{ ref: string; short: string }> = [];
  try {
    refs = (await gitAsync(main.path, ['for-each-ref', '--format=%(refname)%00%(refname:short)', 'refs/heads', 'refs/remotes']))
      .split('\n')
      .map((line) => { const [ref, short] = line.split('\0'); return { ref, short }; })
      .filter((r) => r.ref && r.short && !r.ref.endsWith('/HEAD'));
  } catch { /* no branches to add: the worktrees are still known */ }
  const local = new Set(refs.filter((r) => r.ref.startsWith('refs/heads/')).map((r) => r.short));
  for (const r of refs) {
    if (checkedOut.has(r.short)) continue;
    if (r.ref.startsWith('refs/remotes/') && local.has(r.short.split('/').slice(1).join('/'))) continue;
    places.push({ root: `branch:${r.short}`, branch: r.short });
  }
  return places;
}

/**
 * A session has just bound to `folder` (Phase 32 A1.1). Run the discovery
 * pass for each trusted repository it is a working tree of, so its watchers
 * and its neighbours' start now.
 *
 * Watchers used to start only when something listed the lines of work (the
 * window's strip, `list_workstreams`). With no window, an agent that
 * connected and edited was watched by nobody, and the agent beside it was not
 * told of an overlap until something happened to list them.
 */
export async function discoverAround(folder: string): Promise<void> {
  // Already watched (the opened project, or a folder an earlier pass found):
  // nothing to start. Most connections are this, and a pass is many git calls.
  if (isWatchedFolder(folder)) return;
  for (const root of listTrustedRoots()) {
    try {
      if (root !== folder && !(await listWorktreesAsync(root)).some((w) => w.path === folder)) continue;
      await listWorkstreams(root, { includeIdle: true });
    } catch { /* discovery is best-effort; a connection never waits on it */ }
  }
}

/**
 * The branches of the lines of work, for a picker (Phase 32 A5.1): each
 * linked worktree's branch, then each branch with committed work and no
 * checkout here. Git reads only. Unlike `listWorkstreams` it starts no
 * watchers and places no agents, so a picker asking does not become the
 * discovery pass.
 */
export async function workstreamBranches(projectRoot: string): Promise<string[]> {
  const worktrees = await listWorktreesAsync(projectRoot);
  const main = worktrees.find((w) => w.isMain);
  if (!main) return [];
  const mainRef = main.branch ?? main.head ?? null;
  const out = worktrees.filter((w) => !w.isMain && w.branch).map((w) => w.branch as string);
  for (const b of await branchWorkstreams(main.path, main.branch, mainRef, worktrees, projectRoot)) {
    if (!b.idle && b.branch && !out.includes(b.branch)) out.push(b.branch);
  }
  return out;
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

async function branchWorkstreams(repo: string, mainBranch: string | null, mainRef: string | null, worktrees: readonly Worktree[], projectRoot: string): Promise<Workstream[]> {
  let windowDays: number;
  try {
    windowDays = getEffectiveSensorConfig(projectRoot).awareness.branchWindowDays;
  } catch {
    windowDays = 7;
  }
  const checkedOut = new Set(worktrees.map((w) => w.branch).filter((b): b is string => !!b));
  const out: Workstream[] = [];
  // Symbols are parsed inside a budget too (Phase 33 0.1). The branches'
  // own listing has one (HD4b), but every branch's changed files were then
  // parsed before answering: twenty branches of forty files each made the
  // window's first read of awareness take 7 s, and over 10 s under load.
  // A branch whose files would overrun the budget is listed with what is
  // parsed so far, and the rest are parsed in the background; the window is
  // told when they are ready, as for the branches themselves.
  let symbolBudget = INLINE_SYMBOL_FILES;
  const later: SymbolJob[] = [];
  for (const b of await branchWorkstreamsOf(repo, { mainBranch, mainRef, checkedOut, windowDays })) {
    const atCommit = { head: b.head, read: (rel: string) => showAtAsync(repo, b.head, rel) };
    let changes = b.changes;
    if (symbolParser) {
      const pending = uncachedSymbolFiles(repo, b.changes, atCommit);
      if (pending <= symbolBudget) {
        symbolBudget -= pending;
        changes = await withSymbolChanges(repo, b.changes, symbolParser, atCommit);
      } else {
        later.push({ folder: repo, changes: b.changes, atCommit });
      }
    }
    out.push({
      root: `branch:${b.short}`,
      ref: b.ref,
      branch: b.short,
      head: b.head,
      main: false,
      shape: 'branch' as const,
      agents: [],
      changes,
      idle: b.changes.files.length === 0,
    });
  }
  warmSymbols(repo, repo, later);
  return out;
}

/** Changed files one listing parses, for its worktrees and again for its branches, before it answers. */
export const INLINE_SYMBOL_FILES = 60;
const symbolWarming = new Map<string, Promise<void>>();

/** Settles when no branch's or worktree's symbols are being parsed for `repo` (tests). */
export function branchSymbolsWarmed(repo: string): Promise<void> {
  return Promise.all([symbolWarming.get(repo), symbolWarming.get(`${repo}\0trees`)]).then(() => undefined);
}

/** A tree's or a branch's changes whose symbols are parsed later. */
type SymbolJob = { folder: string; changes: WorkstreamChanges; atCommit?: { head: string; read: (rel: string) => Promise<string | null> } };

/** Parse `jobs` in the background, then tell the window (keyed by `key`: branches and worktrees warm apart). */
function warmSymbols(key: string, repo: string, jobs: SymbolJob[]): void {
  if (!symbolParser || jobs.length === 0 || symbolWarming.has(key)) return;
  const parse = symbolParser;
  const run = (async () => {
    // After this listing has answered: a new file parses with no git to wait
    // on, so the first one would otherwise run before the answer returns.
    await new Promise<void>((resolve) => setImmediate(resolve));
    // One after another: parsing shares the backend's thread, and
    // withSymbolChanges already yields after each file.
    for (const j of jobs) await withSymbolChanges(j.folder, j.changes, parse, j.atCommit).catch(() => undefined);
  })().finally(() => {
    symbolWarming.delete(key);
    notifyBranchesWarmed(repo);
  });
  symbolWarming.set(key, run);
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
async function cloneTrees(projectRoot: string, worktrees: readonly Worktree[]): Promise<Worktree[]> {
  const origin = getRecentProject(projectRoot)?.originUrl ?? null;
  if (!origin) return [];
  const own = new Set(worktrees.map((w) => canonicalPath(w.path)));
  own.add(canonicalPath(projectRoot));
  const out: Worktree[] = [];
  for (const root of listTrustedRoots()) {
    if (own.has(canonicalPath(root))) continue;
    if (getRecentProject(root)?.originUrl !== origin) continue;
    const self = (await listWorktreesAsync(root)).find((w) => w.isMain);
    out.push({ path: root, branch: self?.branch ?? null, head: self?.head ?? null, isMain: false, isCurrent: false, bare: false, prunable: false });
  }
  return out;
}
