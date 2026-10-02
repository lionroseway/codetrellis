/**
 * Source control, with no plan needed (Phase 32 E1).
 *
 * What has changed in an opened project, grouped as an editor's source
 * control tab groups it, each group with the two points its files are
 * compared between:
 *
 *  - **staged**: the last commit against the index;
 *  - **changes**: the index against the working tree;
 *  - **untracked**: new files git does not yet know;
 *  - **committed since you opened it**: the commit the baseline was taken
 *    at against the last commit, which is what the graph's Diff shows
 *    once an agent has committed its work;
 *  - **each other worktree or branch**: what it changed since it left main,
 *    which the graph's workstream marks show and this checkout's own
 *    working tree does not have.
 *
 * The defect that started Track E was these disagreeing: the graph showed
 * an agent's changes and the code view, comparing this checkout's last
 * commit with its working tree, showed none (a commit, or a worktree).
 *
 * Everything is `git` through `execFileSync` in the project's folder; paths
 * are the project's, so a project that is a subfolder of its repository
 * lists only its own files, relative to itself.
 */

import { execFileSync } from 'node:child_process';
import type { ChangedFileStatus, Workstream } from '../../shared/types';
import { isSafeGitRef } from './git-safety';

export type SourceChangeStatus = ChangedFileStatus | 'untracked';
export type SourceGroupKind = 'staged' | 'changes' | 'untracked' | 'since-opened' | 'workstream';

export interface SourceFile {
  /** Relative to the opened project (or to the workstream's folder), with `/`. */
  path: string;
  status: SourceChangeStatus;
  /** The old path, for a rename. */
  from?: string;
}

export interface SourceGroup {
  /** Stable within a listing: the kind, or `workstream:<root>`. */
  id: string;
  kind: SourceGroupKind;
  title: string;
  /** One line for a person: what the two sides are. */
  words: string;
  /** The comparands its files are diffed between (`/api/file/at`'s `at`). */
  before: string;
  after: string;
  /** What each side is called above the diff. */
  labels: { before: string; after: string };
  /**
   * The same thing as git says it (Track E: beginners and advanced users
   * alike). `term` is git's word for the group, beside its plain title;
   * `command` lists what the group shows, to run or to learn from; a
   * file's own diff is `command` plus `-- <path>`.
   */
  git: { term: string | null; command: string };
  files: SourceFile[];
  /** More files changed than are listed. */
  truncated?: boolean;
  /** For a worktree or branch: which, and who works in it. */
  workstream?: { id: string; branch: string | null; agents: string[] };
}

export interface SourceControl {
  project: string;
  /** Not a git repository (or git is missing): nothing to compare. */
  git: boolean;
  branch: string | null;
  head: { sha: string; subject: string } | null;
  groups: SourceGroup[];
  /** One sentence: what changed where, or that nothing has. */
  words: string;
}

const MAX_FILES = 500;
const trim = (p: string) => p.replace(/[\\/]+$/, '');

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
}

const STATUS: Record<string, ChangedFileStatus> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'added', T: 'modified', U: 'modified' };

/** `git status --porcelain=v1 -z` entries, with paths made relative to the project (`prefix` stripped). */
export function parsePorcelain(out: string, prefix: string): { staged: SourceFile[]; changes: SourceFile[]; untracked: SourceFile[] } {
  const staged: SourceFile[] = [];
  const changes: SourceFile[] = [];
  const untracked: SourceFile[] = [];
  const rel = (p: string) => (prefix && p.startsWith(prefix) ? p.slice(prefix.length) : p);
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    const x = entry[0];
    const y = entry[1];
    const file = rel(entry.slice(3));
    // A rename or copy is followed by its old path.
    const from = x === 'R' || x === 'C' || y === 'R' || y === 'C' ? rel(parts[++i] ?? '') : undefined;
    if (x === '?' && y === '?') { untracked.push({ path: file, status: 'untracked' }); continue; }
    if (x === '!') continue;
    if (x !== ' ' && STATUS[x]) staged.push({ path: file, status: STATUS[x], ...(x === 'R' && from ? { from } : {}) });
    if (y !== ' ' && STATUS[y]) changes.push({ path: file, status: STATUS[y], ...(y === 'R' && from ? { from } : {}) });
  }
  return { staged, changes, untracked };
}

/** `git diff --name-status -z` output as files. */
export function parseNameStatus(out: string, prefix: string): SourceFile[] {
  const rel = (p: string) => (prefix && p.startsWith(prefix) ? p.slice(prefix.length) : p);
  const parts = out.split('\0').filter((p) => p.length > 0);
  const files: SourceFile[] = [];
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i];
    const kind = code[0];
    if (kind === 'R' || kind === 'C') {
      const from = parts[++i];
      const to = parts[++i];
      if (to) files.push(kind === 'R' ? { path: rel(to), status: 'renamed', from: rel(from) } : { path: rel(to), status: 'added' });
    } else {
      const p = parts[++i];
      if (p && STATUS[kind]) files.push({ path: rel(p), status: STATUS[kind] });
    }
  }
  return files;
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * What has changed in the project, by where. `baselineCommit` is the commit
 * the graph's baseline was taken at, for this project; `workstreams` are its
 * repository's (A1.3), the opened checkout among them.
 */
export function sourceControl(projectRoot: string, baselineCommit: string | null, workstreams: readonly Workstream[]): SourceControl {
  const project = trim(projectRoot);
  let prefix = '';
  try {
    prefix = git(project, ['rev-parse', '--show-prefix']).trim();
  } catch {
    return { project, git: false, branch: null, head: null, groups: [], words: 'This folder is not a git repository, so there is nothing to compare it with.' };
  }

  let head: SourceControl['head'] = null;
  try {
    const [sha, ...subject] = git(project, ['log', '-1', '--format=%h%x09%s']).trim().split('\t');
    if (sha) head = { sha, subject: subject.join('\t') };
  } catch { /* no commits yet */ }
  let branch: string | null = null;
  try { branch = git(project, ['symbolic-ref', '--short', '-q', 'HEAD']).trim() || null; } catch { /* detached */ }

  const groups: SourceGroup[] = [];
  const headSpec = head ? 'commit:HEAD' : 'none';
  const at = head ? `${branch ?? 'HEAD'} ${head.sha}` : 'no commit yet';
  try {
    const { staged, changes, untracked } = parsePorcelain(git(project, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']), prefix);
    if (staged.length) groups.push({ id: 'staged', kind: 'staged', title: 'Ready to commit', words: `Staged: these go into the next commit. Compared with the last commit (${at})`, git: { term: 'staged', command: 'git diff --cached' }, before: headSpec, after: 'index', labels: { before: `Last commit (${head?.sha ?? 'none'})`, after: 'Staged' }, files: staged.slice(0, MAX_FILES), truncated: staged.length > MAX_FILES || undefined });
    if (changes.length) groups.push({ id: 'changes', kind: 'changes', title: 'Changed, not staged', words: 'Edited but not yet staged for a commit. Compared with what is staged', git: { term: 'unstaged', command: 'git diff' }, before: 'index', after: 'live', labels: { before: 'Staged', after: 'Working tree' }, files: changes.slice(0, MAX_FILES), truncated: changes.length > MAX_FILES || undefined });
    if (untracked.length) groups.push({ id: 'untracked', kind: 'untracked', title: 'New files', words: 'Files git is not tracking yet, so there is nothing earlier to compare them with', git: { term: 'untracked', command: 'git status --untracked-files' }, before: 'none', after: 'live', labels: { before: 'Nothing (new file)', after: 'Working tree' }, files: untracked.slice(0, MAX_FILES), truncated: untracked.length > MAX_FILES || undefined });
  } catch { /* status unreadable: the rest still answers */ }

  // Committed since the graph's baseline: an agent that commits leaves the
  // working tree clean, and the graph still shows what it did.
  if (head && baselineCommit && isSafeGitRef(baselineCommit)) {
    try {
      const commits = Number(git(project, ['rev-list', '--count', `${baselineCommit}..HEAD`]).trim()) || 0;
      if (commits > 0) {
        const files = parseNameStatus(git(project, ['diff', '--name-status', '-z', '-M', baselineCommit, 'HEAD', '--', '.']), prefix);
        const base = baselineCommit.slice(0, 7);
        if (files.length) groups.push({ id: 'since-opened', kind: 'since-opened', title: 'Committed since you opened it', words: `${count(commits, 'commit')} since ${base}, when the graph's baseline was taken`, git: { term: null, command: `git diff ${base}..HEAD` }, before: `commit:${baselineCommit}`, after: 'commit:HEAD', labels: { before: `When you opened it (${base})`, after: `Last commit (${head.sha})` }, files: files.slice(0, MAX_FILES), truncated: files.length > MAX_FILES || undefined });
      }
    } catch { /* the baseline's commit is gone (rewritten history): nothing to say */ }
  }

  // Other worktrees and branches: their work is not in this checkout. The
  // checkout this project is in (the project itself, or the repository's
  // top when the project is a subfolder) is not "other work"; another's
  // files are listed relative to the project, and only those inside it.
  for (const w of workstreams) {
    const wroot = trim(w.root);
    if (wroot === project || project.startsWith(`${wroot}/`) || project.startsWith(`${wroot}\\`)) continue;
    const inside = w.changes.files
      .filter((f) => !prefix || f.path.startsWith(prefix))
      .map((f) => ({ ...f, path: f.path.slice(prefix.length), ...(f.from ? { from: f.from.startsWith(prefix) ? f.from.slice(prefix.length) : f.from } : {}) }));
    if (inside.length === 0) continue;
    const name = w.branch ?? w.root.split(/[\\/]/).pop() ?? w.root;
    const base = w.changes.base;
    const agents = [...new Set(w.agents.map((a) => a.agentType).filter((a): a is string => !!a))];
    const where = w.root.startsWith('branch:') ? 'branch' : 'worktree';
    groups.push({
      id: `workstream:${w.root}`, kind: 'workstream', title: name,
      words: `${where === 'worktree' ? 'A worktree' : 'A branch'} with ${count(inside.length, 'changed file')} since it left main${agents.length ? `, worked on by ${agents.join(' and ')}` : ''}`,
      before: base && isSafeGitRef(base) ? `commit:${base}` : 'none', after: `workstream:${w.root}`,
      labels: { before: base ? `Where it left main (${base.slice(0, 7)})` : 'Nothing', after: name },
      git: {
        term: where,
        // A worktree's working copy, committed or not; a branch's own commits.
        command: where === 'worktree'
          ? `git -C ${w.root} diff ${base ? base.slice(0, 7) : 'HEAD'}`
          : `git diff ${base ? base.slice(0, 7) : 'main'}...${w.branch ?? name}`,
      },
      files: inside.map((f) => ({ path: f.path, status: f.status, ...(f.from ? { from: f.from } : {}) })),
      truncated: w.changes.truncated || undefined,
      workstream: { id: w.root, branch: w.branch, agents },
    });
  }

  // A file both staged and changed again is one file.
  const local = new Set(groups.filter((g) => g.kind === 'staged' || g.kind === 'changes' || g.kind === 'untracked').flatMap((g) => g.files.map((f) => f.path))).size;
  const since = groups.find((g) => g.kind === 'since-opened');
  const others = groups.filter((g) => g.kind === 'workstream');
  const said = [
    local ? `${count(local, 'file')} changed in this checkout` : null,
    since ? `${count(since.files.length, 'file')} committed since you opened it` : null,
    others.length ? `work in ${count(others.length, 'other worktree or branch', 'other worktrees and branches')}` : null,
  ].filter(Boolean);
  const words = said.length
    ? `${said.join('; ')}.`
    : `Nothing has changed: this checkout matches its last commit${head ? ` (${head.sha} “${head.subject}”)` : ''}, and no other worktree or branch has work in progress.`;
  return { project, git: true, branch, head, groups, words };
}

/** Where the project sits in its repository (`packages/api/`), or '' at the top or outside git. */
export function projectPrefix(projectRoot: string): string {
  try { return git(trim(projectRoot), ['rev-parse', '--show-prefix']).trim(); } catch { return ''; }
}
