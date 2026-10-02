/**
 * Branches and pull requests (Phase 32 E5).
 *
 * Every local branch and every remote-tracking branch, each with when it
 * last changed and, for a local branch, its upstream and how far ahead and
 * behind it is; and the repository's pull requests with their state, read
 * through the person's own `gh` when it is installed and signed in.
 *
 * Two kinds of read, kept apart (Track E, "network only when asked"):
 *
 *  - the branches are local: `git for-each-ref`, as of the last fetch,
 *    which the listing says;
 *  - fetching and reading pull requests reach a host, so they run when the
 *    person presses Fetch now, or when Settings → Git → keep remotes current
 *    is on (off by default) and its interval has passed for the project open
 *    in the window. Never otherwise.
 *
 * Both run with `execFile`, never a shell, asynchronously so a slow host
 * never stalls the server, with prompts off: a remote that wants a password
 * fails and says so rather than waiting on a terminal nobody sees. Nothing
 * is sent anywhere by CodeTrellis itself; git and gh use the person's own
 * credentials as they would in a terminal.
 *
 * Every row reads two ways: a plain sentence ("2 commits not pushed yet")
 * and git's own word and command (`ahead 2`, `git branch -vv`).
 */

import { execFile } from 'node:child_process';
import { FETCH_INTERVAL_CHOICES, type GitSettings } from '../../shared/types';
import { isSafeGitRef } from './git-safety';
import { fetchedAt, shortRefName, whenWords } from './git-refs';

export interface BranchRow {
  /** The comparand for the compare pair: `commit:refs/heads/x`. */
  spec: string;
  kind: 'branch' | 'remote';
  name: string;
  sha: string;
  /** When its last commit was made, ms. */
  at: number | null;
  subject: string | null;
  current: boolean;
  /** A local branch's upstream as git shows it (`origin/x`). */
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  /** Its upstream was deleted on the remote and pruned here. */
  gone: boolean;
  /** For a remote branch, the local branch that follows it. */
  trackedBy: string | null;
  /** For a person. */
  words: string;
  /** Git's words: `ahead 2, behind 1`, `upstream gone`, `no upstream`. */
  term: string;
}

export type PullState = 'open' | 'draft' | 'merged' | 'closed';

export interface PullRequest {
  number: number;
  title: string;
  state: PullState;
  head: string;
  base: string;
  author: string | null;
  updatedAt: number | null;
  url: string | null;
  review: 'approved' | 'changes requested' | 'waiting on review' | null;
  words: string;
  /** The pair that shows what it changes, when both branches are here. */
  compare: { before: string; after: string } | null;
}

export type PullStatus = 'never' | 'ok' | 'no-gh' | 'signed-out' | 'not-github' | 'error';

export interface PullListing {
  status: PullStatus;
  readAt: number | null;
  pulls: PullRequest[];
  words: string;
  command: string;
}

export interface FetchState {
  /** When this repository last fetched, by anyone (FETCH_HEAD), ms. */
  at: number | null;
  words: string;
  command: string;
  running: boolean;
  error: string | null;
  auto: { on: boolean; everyMinutes: number; words: string };
}

export interface BranchListing {
  project: string;
  git: boolean;
  branch: string | null;
  remotes: string[];
  branches: BranchRow[];
  remoteBranches: BranchRow[];
  commands: { branches: string; remoteBranches: string };
  fetch: FetchState;
  pulls: PullListing;
}

export const FETCH_COMMAND = 'git fetch --all --prune';
export const PR_COMMAND = 'gh pr list --state all';
const MAX_BRANCHES = 200;
const MAX_PULLS = 50;
const FETCH_TIMEOUT_MS = 120_000;
const GH_TIMEOUT_MS = 60_000;

/** The gh to run: `CODETRELLIS_GH` when set (tests, an unusual install), else `gh` on the PATH. */
export const ghBinary = (): string => process.env.CODETRELLIS_GH || 'gh';

interface Ran { code: number | null; stdout: string; stderr: string; missing: boolean }

function run(bin: string, args: string[], cwd: string, timeout: number, env: NodeJS.ProcessEnv = {}): Promise<Ran> {
  return new Promise((resolve) => {
    execFile(bin, args, {
      cwd, timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true,
      env: { ...process.env, ...env },
    }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { code?: string | number }) | null;
      resolve({
        code: e ? (typeof e.code === 'number' ? e.code : -1) : 0,
        stdout: String(stdout ?? ''), stderr: String(stderr ?? ''),
        missing: e?.code === 'ENOENT',
      });
    }).stdin?.end();
  });
}

/** Git with no prompt: a remote that wants a password fails instead of waiting. */
const QUIET_GIT: NodeJS.ProcessEnv = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '' };
const QUIET_GH: NodeJS.ProcessEnv = { GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', GH_SPINNER_DISABLED: '1', NO_COLOR: '1', CLICOLOR: '0' };

const gitSync = (root: string, args: string[]) => run('git', args, root, 30_000, QUIET_GIT);

/** `[ahead 2, behind 1]`, `[gone]` or empty (level with it), as `%(upstream:track)` writes it. */
export function parseTrack(track: string): { ahead: number; behind: number; gone: boolean } {
  if (/\bgone\b/.test(track)) return { ahead: 0, behind: 0, gone: true };
  const ahead = /ahead (\d+)/.exec(track);
  const behind = /behind (\d+)/.exec(track);
  return { ahead: ahead ? Number(ahead[1]) : 0, behind: behind ? Number(behind[1]) : 0, gone: false };
}

const commits = (n: number) => `${n} commit${n === 1 ? '' : 's'}`;

/** What a local branch is to its upstream, in a sentence and in git's words. */
export function trackWords(upstream: string | null, t: { ahead: number; behind: number; gone: boolean }): { words: string; term: string } {
  if (!upstream) return { words: 'Only here: not pushed anywhere yet', term: 'no upstream' };
  if (t.gone) return { words: `Its upstream ${upstream} was deleted on the remote`, term: 'upstream gone' };
  if (!t.ahead && !t.behind) return { words: `Level with ${upstream}`, term: 'up to date' };
  const parts: string[] = [];
  if (t.ahead) parts.push(`${commits(t.ahead)} not pushed yet`);
  if (t.behind) parts.push(`${commits(t.behind)} on ${upstream} not here yet`);
  return {
    words: parts.join('; '),
    term: [t.ahead ? `ahead ${t.ahead}` : '', t.behind ? `behind ${t.behind}` : ''].filter(Boolean).join(', '),
  };
}

// ── Pull requests, through gh ────────────────────────────────────────────

interface GhPull {
  number: number; title: string; state: string; isDraft?: boolean;
  headRefName: string; baseRefName: string; author?: { login?: string } | null;
  updatedAt?: string; url?: string; reviewDecision?: string | null;
}

const REVIEW: Record<string, PullRequest['review']> = {
  APPROVED: 'approved', CHANGES_REQUESTED: 'changes requested', REVIEW_REQUIRED: 'waiting on review',
};

/** A remote-tracking ref for a branch name, origin first; null when none was fetched. */
function remoteRefFor(name: string, remoteRefs: readonly string[]): string | null {
  return remoteRefs.find((r) => r === `refs/remotes/origin/${name}`)
    ?? remoteRefs.find((r) => r.replace(/^refs\/remotes\/[^/]+\//, '') === name)
    ?? null;
}

/** gh's pull requests as rows, each with the pair that shows what it changes when both branches were fetched. */
export function toPulls(rows: GhPull[], remoteRefs: readonly string[], now: number): PullRequest[] {
  return rows.slice(0, MAX_PULLS).map((p) => {
    const state: PullState = p.state === 'MERGED' ? 'merged' : p.state === 'CLOSED' ? 'closed' : p.isDraft ? 'draft' : 'open';
    const review = state === 'open' ? (REVIEW[p.reviewDecision ?? ''] ?? null) : null;
    const updatedAt = p.updatedAt ? Date.parse(p.updatedAt) || null : null;
    const head = remoteRefFor(p.headRefName, remoteRefs);
    const base = remoteRefFor(p.baseRefName, remoteRefs);
    const stateWords = state === 'open' ? (review ? `Open, ${review}` : 'Open') : state === 'draft' ? 'Draft, not ready for review' : state === 'merged' ? 'Merged' : 'Closed without merging';
    return {
      number: p.number, title: p.title, state, head: p.headRefName, base: p.baseRefName,
      author: p.author?.login ?? null, updatedAt, url: typeof p.url === 'string' && /^https:\/\//.test(p.url) ? p.url : null, review,
      words: `${stateWords} · ${p.headRefName} into ${p.baseRefName}${p.author?.login ? ` · ${p.author.login}` : ''}${updatedAt ? ` · ${whenWords(updatedAt, now)}` : ''}`,
      compare: head && base ? { before: `merge-base:${base}...${head}`, after: `commit:${head}` } : null,
    };
  });
}

/** What gh said, as a status a person can act on. */
export function ghStatus(r: Ran): { status: PullStatus; detail: string } {
  if (r.missing) return { status: 'no-gh', detail: '' };
  const said = `${r.stderr}\n${r.stdout}`;
  if (r.code === 4 || /gh auth login|not logged in|authentication required|GH_TOKEN/i.test(said)) return { status: 'signed-out', detail: '' };
  if (/none of the git remotes|no git remotes|known GitHub host|unable to determine|not a git repository/i.test(said)) return { status: 'not-github', detail: '' };
  return { status: 'error', detail: said.trim().split('\n').find(Boolean)?.slice(0, 200) ?? `gh exited with ${r.code}` };
}

export function pullWords(status: PullStatus, pulls: readonly PullRequest[], readAt: number | null, now: number, detail = ''): string {
  switch (status) {
    case 'never': return 'Pull requests are read through the gh CLI when you fetch.';
    case 'no-gh': return 'Pull requests need the gh CLI (cli.github.com), installed and signed in. Branches work without it.';
    case 'signed-out': return 'gh is installed but not signed in: run gh auth login in a terminal, then fetch again.';
    case 'not-github': return 'This repository has no GitHub remote, so there are no pull requests for gh to read.';
    case 'error': return `gh could not read pull requests: ${detail || 'it gave no reason'}.`;
    default: {
      const open = pulls.filter((p) => p.state === 'open' || p.state === 'draft').length;
      const read = `read ${whenWords(readAt, now)}`;
      if (!pulls.length) return `No pull requests on this repository, ${read}.`;
      return `${open} open of the ${pulls.length} most recent, ${read}.`;
    }
  }
}

const pullCache = new Map<string, { status: PullStatus; readAt: number | null; pulls: PullRequest[]; detail: string }>();

/** Ask gh for this repository's pull requests (network), and keep the answer for the listing. */
export async function readPullRequests(projectRoot: string, now = Date.now()): Promise<PullListing> {
  const r = await run(ghBinary(), [
    'pr', 'list', '--state', 'all', '--limit', String(MAX_PULLS),
    '--json', 'number,title,state,isDraft,headRefName,baseRefName,author,updatedAt,url,reviewDecision',
  ], projectRoot, GH_TIMEOUT_MS, QUIET_GH);
  let entry: { status: PullStatus; readAt: number | null; pulls: PullRequest[]; detail: string };
  if (r.code === 0) {
    let rows: GhPull[] = [];
    try { rows = JSON.parse(r.stdout || '[]'); } catch { rows = []; }
    entry = { status: 'ok', readAt: now, pulls: Array.isArray(rows) ? toPulls(rows, await remoteRefs(projectRoot), now) : [], detail: '' };
  } else {
    const s = ghStatus(r);
    // Keep what was read before: a host that is down does not empty the list.
    const prev = pullCache.get(projectRoot);
    entry = { status: s.status, readAt: prev?.readAt ?? null, pulls: prev?.pulls ?? [], detail: s.detail };
  }
  pullCache.set(projectRoot, entry);
  return pullListing(projectRoot, now);
}

export function pullListing(projectRoot: string, now = Date.now()): PullListing {
  const e = pullCache.get(projectRoot) ?? { status: 'never' as const, readAt: null, pulls: [], detail: '' };
  return { status: e.status, readAt: e.readAt, pulls: e.pulls, words: pullWords(e.status, e.pulls, e.readAt, now, e.detail), command: PR_COMMAND };
}

async function remoteRefs(projectRoot: string): Promise<string[]> {
  const r = await gitSync(projectRoot, ['for-each-ref', '--format=%(refname)', 'refs/remotes']);
  return r.code === 0 ? r.stdout.split('\n').filter((x) => x && isSafeGitRef(x) && !x.endsWith('/HEAD')) : [];
}

// ── Fetching ─────────────────────────────────────────────────────────────

export interface FetchResult { ok: boolean; at: number | null; words: string; command: string; error: string | null }

const fetching = new Map<string, Promise<FetchResult>>();
const fetchError = new Map<string, string | null>();

/**
 * `git fetch --all --prune`, then gh's pull requests: one run per project at
 * a time; a second ask while one runs waits for it rather than starting
 * another.
 */
export function fetchRemotes(projectRoot: string): Promise<FetchResult> {
  const running = fetching.get(projectRoot);
  if (running) return running;
  const p = (async (): Promise<FetchResult> => {
    const remotes = await listRemotes(projectRoot);
    if (!remotes.length) {
      fetchError.set(projectRoot, null);
      return { ok: false, at: fetchedAt(projectRoot), words: 'This repository has no remote to fetch from.', command: FETCH_COMMAND, error: 'no remote' };
    }
    const r = await run('git', ['fetch', '--all', '--prune', '--quiet'], projectRoot, FETCH_TIMEOUT_MS, QUIET_GIT);
    const error = r.code === 0 ? null : (r.stderr.trim().split('\n').filter(Boolean).pop() ?? `git fetch exited with ${r.code}`).slice(0, 300);
    fetchError.set(projectRoot, error);
    await readPullRequests(projectRoot);
    const at = fetchedAt(projectRoot);
    return {
      ok: !error, at, command: FETCH_COMMAND, error,
      words: error ? `Could not fetch: ${error}` : `Fetched ${remotes.join(', ')} ${whenWords(at, Date.now())}.`,
    };
  })().finally(() => fetching.delete(projectRoot));
  fetching.set(projectRoot, p);
  return p;
}

async function listRemotes(projectRoot: string): Promise<string[]> {
  const r = await gitSync(projectRoot, ['remote']);
  return r.code === 0 ? r.stdout.split('\n').map((s) => s.trim()).filter(Boolean) : [];
}

export function autoWords(git: GitSettings): string {
  return git.keepRemotesCurrent
    ? `Kept current: fetched every ${git.everyMinutes} min while this project is open (Settings → Git).`
    : 'Remotes are as last fetched. Fetch now, or keep them current in Settings → Git (off).';
}

// ── The listing ──────────────────────────────────────────────────────────

/** Every branch here and on the remotes, as last fetched, and the pull requests as last read. */
export async function listBranches(projectRoot: string, git: GitSettings, now = Date.now()): Promise<BranchListing> {
  const empty = (isGit: boolean): BranchListing => ({
    project: projectRoot, git: isGit, branch: null, remotes: [], branches: [], remoteBranches: [],
    commands: { branches: 'git branch -vv', remoteBranches: 'git branch -r' },
    fetch: { at: null, words: 'Never fetched', command: FETCH_COMMAND, running: false, error: null, auto: { on: git.keepRemotesCurrent, everyMinutes: git.everyMinutes, words: autoWords(git) } },
    pulls: pullListing(projectRoot, now),
  });
  if ((await gitSync(projectRoot, ['rev-parse', '--git-dir'])).code !== 0) return empty(false);
  const listing = empty(true);
  const head = await gitSync(projectRoot, ['symbolic-ref', '--short', '-q', 'HEAD']);
  listing.branch = head.code === 0 ? head.stdout.trim() || null : null;
  listing.remotes = await listRemotes(projectRoot);

  const rows = await gitSync(projectRoot, [
    'for-each-ref', '--sort=-committerdate',
    '--format=%(refname)%00%(objectname:short)%00%(committerdate:unix)%00%(subject)%00%(upstream)%00%(upstream:track)',
    'refs/heads', 'refs/remotes',
  ]);
  const trackedBy = new Map<string, string>();
  const parsed = (rows.code === 0 ? rows.stdout.split('\n').filter(Boolean) : []).map((line) => {
    const [ref, sha, unix, subject, upstream, track] = line.split('\0');
    return { ref, sha, at: unix ? Number(unix) * 1000 : null, subject: subject || null, upstream: upstream || null, track: track ?? '' };
  }).filter((r) => isSafeGitRef(r.ref) && !r.ref.endsWith('/HEAD'));
  for (const r of parsed) if (r.ref.startsWith('refs/heads/') && r.upstream) trackedBy.set(r.upstream, shortRefName(r.ref));

  const fetched = fetchedAt(projectRoot);
  for (const r of parsed) {
    const name = shortRefName(r.ref);
    if (r.ref.startsWith('refs/heads/')) {
      if (listing.branches.length >= MAX_BRANCHES) continue;
      const upstream = r.upstream ? shortRefName(r.upstream) : null;
      const t = parseTrack(r.track);
      const said = trackWords(upstream, t);
      listing.branches.push({
        spec: `commit:${r.ref}`, kind: 'branch', name, sha: r.sha, at: r.at, subject: r.subject,
        current: name === listing.branch, upstream, ahead: upstream && !t.gone ? t.ahead : null, behind: upstream && !t.gone ? t.behind : null,
        gone: t.gone, trackedBy: null, words: said.words, term: said.term,
      });
    } else {
      if (listing.remoteBranches.length >= MAX_BRANCHES) continue;
      const [remote, ...rest] = name.split('/');
      const local = trackedBy.get(r.ref) ?? null;
      listing.remoteBranches.push({
        spec: `commit:${r.ref}`, kind: 'remote', name, sha: r.sha, at: r.at, subject: r.subject,
        current: false, upstream: null, ahead: null, behind: null, gone: false, trackedBy: local,
        words: `${rest.join('/')} on ${remote}, as last fetched${local ? `; your ${local} follows it` : '; no branch here follows it'}`,
        term: local ? `upstream of ${local}` : 'remote-tracking',
      });
    }
  }
  const error = fetchError.get(projectRoot) ?? null;
  listing.fetch = {
    ...listing.fetch, at: fetched, running: fetching.has(projectRoot), error,
    words: listing.remotes.length === 0 ? 'No remote: this repository is only here'
      : fetched === null ? 'Never fetched: remote branches are as they were when cloned'
        : `Last fetched ${whenWords(fetched, now)}`,
  };
  return listing;
}

// ── Keeping remotes current (Settings → Git, off by default) ─────────────

/** Whether the keeper should fetch now: on, and the interval has passed since the last fetch or the last try. */
export function keeperDue(git: GitSettings, lastFetched: number | null, lastTried: number | null, now: number): boolean {
  if (!git.keepRemotesCurrent) return false;
  const every = (FETCH_INTERVAL_CHOICES as readonly number[]).includes(git.everyMinutes) ? git.everyMinutes : 15;
  const since = Math.max(lastFetched ?? -Infinity, lastTried ?? -Infinity);
  return now - since >= every * 60_000;
}

export interface KeeperDeps {
  settings: () => GitSettings;
  /** The project open in the window; the keeper fetches nothing else. */
  activeRoot: () => string | null;
  onFetched: (projectRoot: string, result: FetchResult) => void;
  now?: () => number;
}

const triedAt = new Map<string, number>();

/** One look: fetch the open project if keeping current is on and it is due. Returns the run, if one started. */
export function keeperTick(deps: KeeperDeps): Promise<FetchResult> | null {
  const root = deps.activeRoot();
  if (!root || fetching.has(root)) return null;
  const now = (deps.now ?? Date.now)();
  if (!keeperDue(deps.settings(), fetchedAt(root), triedAt.get(root) ?? null, now)) return null;
  triedAt.set(root, now);
  return fetchRemotes(root).then((r) => { deps.onFetched(root, r); return r; });
}

/** Look once a minute. Off in settings, each look does nothing. */
export function startRemoteKeeper(deps: KeeperDeps, everyMs = 60_000): () => void {
  const timer = setInterval(() => { void keeperTick(deps)?.catch(() => { /* said in the listing */ }); }, everyMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** Tests: forget what was read and tried. */
export function resetBranchState(): void {
  pullCache.clear(); fetchError.clear(); triedAt.clear();
}
