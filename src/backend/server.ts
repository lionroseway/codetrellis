import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { WebSocketServer, WebSocket } from 'ws';
import { scanDirectory, countFiles, collectFilePaths } from './services/project-scanner';
import { detectMonorepo } from './services/monorepo-detector';
import { initParser, parseFiles, parseVirtualFile } from './services/ast-parser';
import { initDatabase, storeParsedFile, searchSymbols, getFileSymbols, getDbStats, resolveImports, getDependencyEdges, getFileDependencies, clearAstData } from './services/database';
import { startWatching } from './services/file-watcher';
import { startClaudeCodeWatcher, getWatcherStatus } from './agent/claude-code-watcher';
import { captureSnapshot, setBaseline, computeDiff, getBaseline } from './services/diff-engine';
import { startMcpServer, getMcpStatus, getMcpConfig } from './mcp/server';
import { startAutoSave, saveNow } from './services/persistence';
import { exportDatabase } from './services/database';
import * as planService from './services/plan-service';
import * as commentService from './services/comment-service';
import * as sessionService from './services/session-service';
import {
  recordProjectOpen,
  listRecentProjects,
  removeRecentProject,
  setRecentProjectPinned,
} from './services/recent-projects-service';
import { discoverSystems, buildAliasMap } from './services/system-discovery';

const app = express();
app.use(express.json());

const server = http.createServer(app);

// WebSocket server for real-time events (agent events, scan progress, file changes)
const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Set<WebSocket>();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
});

export function broadcast(type: string, payload: unknown): void {
  const message = JSON.stringify({ type, payload });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// --- API Routes ---

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Get git branch for a path
app.get('/api/git/branch', (req, res) => {
  const projectPath = req.query.path as string;
  if (!projectPath) { res.json({ branch: null }); return; }

  try {
    const headPath = path.join(projectPath, '.git', 'HEAD');
    if (fs.existsSync(headPath)) {
      const head = fs.readFileSync(headPath, 'utf-8').trim();
      const match = head.match(/^ref: refs\/heads\/(.+)$/);
      res.json({ branch: match ? match[1] : 'detached' });
    } else {
      res.json({ branch: null });
    }
  } catch {
    res.json({ branch: null });
  }
});

// List git branches and worktrees for a project
app.get('/api/git/info', (req, res) => {
  const projectPath = req.query.path as string;
  if (!projectPath) { res.json({ branches: [], worktrees: [], status: null }); return; }

  const gitDir = path.join(projectPath, '.git');
  if (!fs.existsSync(gitDir)) { res.json({ branches: [], worktrees: [], status: null }); return; }

  // Current branch
  let currentBranch: string | null = null;
  try {
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf-8').trim();
    const match = head.match(/^ref: refs\/heads\/(.+)$/);
    currentBranch = match ? match[1] : 'detached';
  } catch { /* ignore */ }

  // List branches
  const branches: string[] = [];
  const refsDir = path.join(gitDir, 'refs', 'heads');
  if (fs.existsSync(refsDir)) {
    try {
      const readBranches = (dir: string, prefix = '') => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            readBranches(path.join(dir, entry.name), `${prefix}${entry.name}/`);
          } else {
            branches.push(`${prefix}${entry.name}`);
          }
        }
      };
      readBranches(refsDir);
    } catch { /* ignore */ }
  }

  // List worktrees
  const worktrees: Array<{ path: string; branch: string | null }> = [];
  const worktreesDir = path.join(gitDir, 'worktrees');
  if (fs.existsSync(worktreesDir)) {
    try {
      for (const entry of fs.readdirSync(worktreesDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const wtDir = path.join(worktreesDir, entry.name);
        let wtBranch: string | null = null;
        try {
          const head = fs.readFileSync(path.join(wtDir, 'HEAD'), 'utf-8').trim();
          const match = head.match(/^ref: refs\/heads\/(.+)$/);
          wtBranch = match ? match[1] : null;
        } catch { /* ignore */ }
        // Read gitdir to find worktree path
        let wtPath: string | null = null;
        try {
          wtPath = fs.readFileSync(path.join(wtDir, 'gitdir'), 'utf-8').trim();
          wtPath = path.dirname(wtPath); // gitdir points to .git inside worktree
        } catch { /* ignore */ }
        worktrees.push({ path: wtPath || entry.name, branch: wtBranch });
      }
    } catch { /* ignore */ }
  }

  // Git status summary (untracked, modified, staged counts)
  let untracked = 0;
  let modified = 0;
  try {
    // Quick scan — check if index exists
    const indexExists = fs.existsSync(path.join(gitDir, 'index'));
    if (!indexExists) {
      // No index = no commits yet, everything is untracked
      untracked = -1; // signal "no commits"
    }
  } catch { /* ignore */ }

  res.json({ currentBranch, branches, worktrees, hasCommits: untracked !== -1 });
});

app.get('/api/git/status', (req, res) => {
  const projectPath = req.query.path as string;
  if (!projectPath) {
    res.status(400).json({ error: 'path query param required' });
    return;
  }

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
  const projectPath = req.query.path as string;
  if (!projectPath) {
    res.status(400).json({ error: 'path query param required' });
    return;
  }

  res.json(getGitHeadCommit(projectPath) || { commitHash: null, shortCommitHash: null });
});

// Resolve a branch name to its tip commit. Used by the branch popover to set
// the diff baseline to "branch X's HEAD" without checking it out.
app.get('/api/git/branch-tip', (req, res) => {
  const projectPath = req.query.path as string;
  const branch = req.query.branch as string;
  if (!projectPath || !branch) {
    res.status(400).json({ error: 'path and branch query params required' });
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
  const projectPath = req.query.path as string;
  const limitParam = Number(req.query.limit);
  if (!projectPath) {
    res.status(400).json({ error: 'path query param required' });
    return;
  }

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

      // Get branch
      let branch: string | null = null;
      try {
        const headPath = path.join(session.cwd, '.git', 'HEAD');
        if (fs.existsSync(headPath)) {
          const head = fs.readFileSync(headPath, 'utf-8').trim();
          const match = head.match(/^ref: refs\/heads\/(.+)$/);
          branch = match ? match[1] : 'detached';
        }
      } catch { /* ignore */ }

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

app.delete('/api/recent-projects', (req, res) => {
  const { projectPath } = req.body || {};
  if (!projectPath || typeof projectPath !== 'string') {
    res.status(400).json({ error: 'projectPath is required' });
    return;
  }
  removeRecentProject(projectPath);
  res.json({ ok: true });
});

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
  const projectPath = req.query.project as string;
  if (!projectPath) {
    res.status(400).json({ error: 'project query param required' });
    return;
  }

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


// Browse directories (for folder picker)
app.get('/api/fs/browse', (req, res) => {
  const dirPath = (req.query.path as string) || os.homedir();
  try {
    const resolved = path.resolve(dirPath);
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => ({ name: e.name, path: path.join(resolved, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({ current: resolved, parent: path.dirname(resolved), dirs });
  } catch {
    res.status(400).json({ error: `Cannot read: ${dirPath}` });
  }
});

// Scan a project directory
app.post('/api/project/scan', async (req, res) => {
  const { projectPath } = req.body;
  if (!projectPath || typeof projectPath !== 'string') {
    res.status(400).json({ error: 'projectPath is required' });
    return;
  }

  if (!fs.existsSync(projectPath)) {
    res.status(400).json({ error: `Path does not exist: ${projectPath}` });
    return;
  }

  console.log(`[API] Scanning project: ${projectPath}`);

  // Drop AST data from any previously-scanned project. Without this,
  // files/symbols/imports accumulate across project switches and queries
  // like search return the union of every project ever opened.
  clearAstData();

  // Record this project as recently opened (best-effort — don't fail scan if it errors)
  try {
    const branchInfo = getGitBranchName(projectPath);
    recordProjectOpen(projectPath, branchInfo);
  } catch (err) {
    console.warn('[API] Failed to record recent project:', err);
  }

  const monorepoConfig = detectMonorepo(projectPath);
  const fileTree = scanDirectory(projectPath);
  const fileCount = countFiles(fileTree);

  // Parse all source files for AST data
  const filePaths = collectFilePaths(fileTree);
  const parsedFiles = await parseFiles(filePaths);

  for (const parsed of parsedFiles) {
    storeParsedFile(parsed, projectPath);
  }

  // Discover systems (npm packages, Python projects, Rust crates, ...)
  // and use them to build the workspace-alias map. Without this, only
  // relative imports resolve — workspace-aliased imports like `@swf/ui`
  // get dropped, leaving apps disconnected from their package layer.
  const systems = discoverSystems(projectPath);
  const aliasMap = buildAliasMap(systems);
  console.log(`[API] Discovered ${systems.length} systems, ${aliasMap.length} aliases`);
  for (const sys of systems) {
    console.log(`[API]   · ${sys.relativeRoot || '(root)'} · ${sys.manifestKind} · ${sys.language} · ${sys.packageName ?? sys.name}`);
  }

  // Resolve import paths to actual files. Per-language dispatch: each
  // file's language picks the right resolver (TS / Python / Rust /
  // PHP / Java / ...). Systems list is needed by Python / Rust / PHP /
  // Java to anchor absolute imports at the importer's project root.
  resolveImports(projectPath, aliasMap, systems);

  const stats = getDbStats();
  console.log(`[API] Parsed ${stats.fileCount} files, ${stats.symbolCount} symbols, ${stats.importCount} imports, ${stats.resolvedImports} resolved`);

  // Capture baseline snapshot for diffing
  const depEdges = getDependencyEdges();
  const fileData = parsedFiles.map((f) => ({
    path: f.path.startsWith('/') ? path.relative(projectPath, f.path) : f.path,
    hash: f.contentHash,
    symbolCount: f.symbols.length,
  }));
  setBaseline(captureSnapshot(fileData, depEdges), getGitHeadCommit(projectPath) || undefined);

  // Start watching for file changes
  startWatching(projectPath);

  // Start watching for Claude Code sessions
  startClaudeCodeWatcher(projectPath);

  // Convert Map to plain object for JSON serialization
  const depGraph: Record<string, string[]> = {};
  monorepoConfig.dependencyGraph.forEach((v, k) => { depGraph[k] = v; });

  res.json({
    monorepoConfig: { ...monorepoConfig, dependencyGraph: depGraph },
    fileTree,
    fileCount,
    astStats: stats,
  });
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
  if (!fs.existsSync(filePath)) {
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
    const buffer = fs.readFileSync(filePath);
    const content = (truncated ? buffer.subarray(0, MAX_BYTES) : buffer).toString('utf-8');

    const startParam = req.query.start ? parseInt(String(req.query.start), 10) : undefined;
    const endParam = req.query.end ? parseInt(String(req.query.end), 10) : undefined;
    const projectPath = (req.query.project as string) || undefined;

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
    let isDirty = false;
    if (projectPath) {
      const fullAnnotations = computeGitLineAnnotations(projectPath, filePath, fullLineCount);
      if (fullAnnotations) {
        annotations = fullAnnotations.slice(start - 1, end);
        isDirty = fullAnnotations.some((a) => a !== 'unchanged');
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
    '.php': 'php', '.rb': 'ruby', '.sh': 'bash', '.md': 'markdown',
    '.yml': 'yaml', '.yaml': 'yaml', '.toml': 'toml', '.sql': 'sql',
  };
  return map[ext] || 'plaintext';
}

/**
 * Returns a status array (one entry per line in the working-tree file) marking
 * lines added or modified relative to HEAD. Returns null if the file isn't
 * tracked yet (whole file is implicitly 'added' — caller can detect via
 * isDirty=true) or if git fails.
 */
function computeGitLineAnnotations(
  projectPath: string,
  filePath: string,
  lineCount: number,
): Array<'unchanged' | 'added' | 'modified'> | null {
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
        return Array(lineCount).fill('added');
      }
    } catch {
      return Array(lineCount).fill('added');
    }

    // Diff against HEAD (working tree, not index) with zero context
    const diffOut = execFileSync(
      'git',
      ['-C', projectPath, 'diff', '--no-color', '-U0', 'HEAD', '--', relative],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );

    const annotations: Array<'unchanged' | 'added' | 'modified'> = Array(lineCount).fill('unchanged');
    const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;
    let match: RegExpExecArray | null;
    while ((match = HUNK_RE.exec(diffOut)) !== null) {
      const startLine = parseInt(match[1], 10);
      const lineCountInHunk = match[2] != null ? parseInt(match[2], 10) : 1;
      // Was the hunk preceded by deletions? Crude heuristic: scan the hunk body
      // for both '+' and '-' lines to decide added vs modified.
      const blockStart = match.index + match[0].length;
      const nextHunk = diffOut.indexOf('\n@@', blockStart);
      const block = diffOut.slice(blockStart, nextHunk === -1 ? undefined : nextHunk);
      const hasRemoval = /^-/m.test(block);
      const status = hasRemoval ? 'modified' : 'added';

      for (let i = 0; i < lineCountInHunk; i += 1) {
        const idx = startLine - 1 + i;
        if (idx >= 0 && idx < annotations.length) {
          annotations[idx] = status;
        }
      }
    }
    return annotations;
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
function computeFileDrift(
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
    const tasks = planService.getTasksByPlan(plan.uid);
    const matching = tasks.filter(
      (t) => t.affectedFiles.some((f) => f === relative || f === filePath),
    );
    if (matching.length > 0) {
      planUids.push(plan.uid);
      for (const t of matching) taskUids.push(t.uid);
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
app.get('/api/dependencies', (_req, res) => {
  res.json(getDependencyEdges());
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

  // Re-scan and re-parse to get current state
  const projectPath = req.query.project as string;
  if (!projectPath) {
    res.json({ error: 'project query param required' });
    return;
  }

  const fileTree = scanDirectory(projectPath);
  const filePaths = collectFilePaths(fileTree);
  const parsedFiles = await parseFiles(filePaths);

  for (const parsed of parsedFiles) {
    storeParsedFile(parsed, projectPath);
  }
  resolveImports(projectPath);

  const currentEdges = getDependencyEdges();
  const currentFileData = parsedFiles.map((f) => ({
    path: path.relative(projectPath, f.path),
    hash: f.contentHash,
    symbolCount: f.symbols.length,
  }));

  const currentSnapshot = captureSnapshot(currentFileData, currentEdges);
  const diff = computeDiff(currentSnapshot);
  res.json({
    ...(diff || { summary: { added: 0, removed: 0, modified: 0, edgesAdded: 0, edgesRemoved: 0 } }),
    git: getGitWorkingTreeStatus(projectPath),
  });
});

// Baseline snapshot captured during scan
app.get('/api/baseline', (_req, res) => {
  const baseline = getBaseline();
  if (!baseline) {
    res.status(404).json({ error: 'No baseline captured yet. Scan a project first.' });
    return;
  }

  res.json({
    id: 0,
    name: 'Baseline',
    commitHash: baseline.commitHash || null,
    shortCommitHash: baseline.shortCommitHash || null,
    data: {
      files: [...baseline.files.entries()].map(([path, info]) => ({
        path,
        contentHash: info.hash,
        symbolCount: info.symbolCount,
      })),
      edges: [...baseline.edges].map((edge) => {
        const [source, target] = edge.split('->');
        return { source, target, specifiers: [] };
      }),
    },
  });
});

app.post('/api/baseline/capture', async (req, res) => {
  const { projectPath, commitHash } = req.body || {};
  if (!projectPath || typeof projectPath !== 'string') {
    res.status(400).json({ error: 'projectPath is required' });
    return;
  }

  if (commitHash && typeof commitHash !== 'string') {
    res.status(400).json({ error: 'commitHash must be a string when provided' });
    return;
  }

  if (commitHash) {
    const commitSnapshot = await captureGitCommitSnapshot(projectPath, commitHash);
    if (!commitSnapshot) {
      res.status(400).json({ error: 'Unable to capture baseline for the selected commit' });
      return;
    }
    setBaseline(commitSnapshot.snapshot, {
      commitHash: commitSnapshot.commitHash,
      shortCommitHash: commitSnapshot.shortCommitHash,
    });
  } else {
    const fileTree = scanDirectory(projectPath);
    const filePaths = collectFilePaths(fileTree);
    const parsedFiles = await parseFiles(filePaths);

    for (const parsed of parsedFiles) {
      storeParsedFile(parsed, projectPath);
    }
    resolveImports(projectPath);

    const depEdges = getDependencyEdges();
    const fileData = parsedFiles.map((f) => ({
      path: path.relative(projectPath, f.path),
      hash: f.contentHash,
      symbolCount: f.symbols.length,
    }));
    const snapshot = captureSnapshot(fileData, depEdges);
    const head = getGitHeadCommit(projectPath);
    setBaseline(snapshot, head || undefined);
  }

  const baseline = getBaseline();
  res.json({
    id: 0,
    name: 'Baseline',
    commitHash: baseline?.commitHash || null,
    shortCommitHash: baseline?.shortCommitHash || null,
    data: {
      files: [...(baseline?.files.entries() || [])].map(([filePath, info]) => ({
        path: filePath,
        contentHash: info.hash,
        symbolCount: info.symbolCount,
      })),
      edges: [...(baseline?.edges || [])].map((edge) => {
        const [source, target] = edge.split('->');
        return { source, target, specifiers: [] };
      }),
    },
  });
});

// --- Plan API ---

// List plans
app.get('/api/plans', (req, res) => {
  const projectPath = req.query.project as string | undefined;
  const status = req.query.status as string | undefined;
  res.json(planService.listPlans(projectPath, status));
});

// Create plan
app.post('/api/plans', (req, res) => {
  const { title, description, tasks, projectPath } = req.body;
  if (!title || !projectPath) { res.status(400).json({ error: 'title and projectPath required' }); return; }
  const plan = planService.createPlan({ title, description: description || '', tasks: tasks || [] }, 'user', 'human', projectPath);
  broadcast('plan-created', { plan });
  saveNow(() => exportDatabase());
  res.json(plan);
});

// Get plan
app.get('/api/plans/:uid', (req, res) => {
  const plan = planService.getPlan(req.params.uid);
  if (!plan) { res.status(404).json({ error: 'Plan not found' }); return; }
  res.json(plan);
});

// Update plan
app.put('/api/plans/:uid', (req, res) => {
  const { title, description, status } = req.body;
  const plan = planService.getPlan(req.params.uid);
  planService.updatePlan(req.params.uid, { title, description, status }, 'user');

  // Auto-capture trellis snapshot when plan is approved
  if (status === 'approved' && plan?.projectPath) {
    try {
      const { captureCurrentTrellis } = require('./services/trellis-service');
      const snapshot = captureCurrentTrellis(plan.projectPath, req.params.uid, `Baseline for "${plan.title}"`);
      broadcast('trellis-captured', { snapshot: { id: snapshot.id, name: snapshot.name } });
    } catch (err) {
      console.warn('[API] Failed to capture trellis snapshot:', err);
    }
  }

  broadcast('plan-updated', { planUid: req.params.uid, status });
  saveNow(() => exportDatabase());
  res.json({ ok: true });
});

// Delete (archive) plan
app.delete('/api/plans/:uid', (req, res) => {
  planService.deletePlan(req.params.uid);
  res.json({ ok: true });
});

// List tasks for a plan
app.get('/api/plans/:uid/tasks', (req, res) => {
  res.json(planService.getTasksByPlan(req.params.uid));
});

// Update task — accepts the full set of task fields.
app.put('/api/plans/:uid/tasks/:taskUid', (req, res) => {
  const {
    status, assignee, assigneeType, assigneeModel, description,
    affectedFiles, affectedSymbols, newConnections, removedConnections,
    dependencies, fileSpec, symbolSpecs,
  } = req.body;
  planService.updateTask(req.params.taskUid, {
    status, assignee, assigneeType, assigneeModel, description,
    affectedFiles, affectedSymbols, newConnections, removedConnections,
    dependencies, fileSpec, symbolSpecs,
  });
  broadcast('task-updated', { planUid: req.params.uid, taskUid: req.params.taskUid, status });
  saveNow(() => exportDatabase());
  res.json({ ok: true });
});

// Append a code reference (path + line range + note) to an existing task.
app.post('/api/plans/:uid/tasks/:taskUid/code-reference', (req, res) => {
  const { filePath, startLine, endLine, note, codeSnippet } = req.body || {};
  if (!filePath || typeof filePath !== 'string') {
    res.status(400).json({ error: 'filePath is required' });
    return;
  }
  const task = planService.appendTaskCodeReference(req.params.taskUid, {
    filePath, startLine, endLine, note, codeSnippet,
  });
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  broadcast('task-updated', { planUid: req.params.uid, taskUid: req.params.taskUid });
  saveNow(() => exportDatabase());
  res.json(task);
});

// Append a brand-new task to a plan (used by the "Add to plan as new task" flow).
app.post('/api/plans/:uid/tasks', (req, res) => {
  const { description, affectedFiles, affectedSymbols, fileSpec } = req.body || {};
  if (!description || typeof description !== 'string') {
    res.status(400).json({ error: 'description is required' });
    return;
  }
  const task = planService.appendTaskToPlan(req.params.uid, {
    description, affectedFiles, affectedSymbols, fileSpec,
  });
  if (!task) {
    res.status(404).json({ error: 'Plan not found' });
    return;
  }
  broadcast('task-updated', { planUid: req.params.uid, taskUid: task.uid });
  saveNow(() => exportDatabase());
  res.json(task);
});

// Claim task
app.post('/api/plans/:uid/tasks/:taskUid/claim', (req, res) => {
  const { agentId, agentType, model } = req.body;
  const result = planService.claimTask(req.params.taskUid, agentId, agentType, model);
  if (result.ok) {
    broadcast('task-claimed', { planUid: req.params.uid, taskUid: req.params.taskUid, agentId });
    if (result.conflicts) {
      broadcast('conflict-detected', { planUid: req.params.uid, taskUid: req.params.taskUid, message: result.conflicts.join('; ') });
    }
  }
  res.json(result);
});

// Get next available task
app.get('/api/plans/:uid/next-task', (req, res) => {
  const task = planService.getNextTask(req.params.uid);
  res.json(task || { none: true });
});

// Plan versions
app.get('/api/plans/:uid/versions', (req, res) => {
  res.json(planService.getPlanVersions(req.params.uid));
});

// Plan projection
app.get('/api/plans/:uid/projection', (req, res) => {
  const { computeProjection } = require('./services/projection-service');
  res.json(computeProjection(req.params.uid));
});

// Plan deviations
app.get('/api/plans/:uid/deviations', (req, res) => {
  const { getDeviations } = require('./services/deviation-service');
  res.json(getDeviations(req.params.uid));
});

// Reconcile deviations
app.post('/api/plans/:uid/reconcile', (req, res) => {
  const { resolveDeviation } = require('./services/deviation-service');
  const { deviations } = req.body; // [{id, action}]
  if (!Array.isArray(deviations)) { res.status(400).json({ error: 'deviations array required' }); return; }
  for (const d of deviations) {
    resolveDeviation(d.id, d.action);
  }
  res.json({ ok: true, resolved: deviations.length });
});

// --- Plan Spec Documents API ---

app.get('/api/plans/:uid/docs', (req, res) => {
  const { listPlanDocuments, listPlanDocumentSummaries } = require('./services/plan-documents-service');
  if (req.query.summary === '1') {
    res.json(listPlanDocumentSummaries(req.params.uid));
  } else {
    res.json(listPlanDocuments(req.params.uid));
  }
});

app.post('/api/plans/:uid/docs', (req, res) => {
  const { createPlanDocument } = require('./services/plan-documents-service');
  const { docType, title, body, author, authorType } = req.body || {};
  if (!docType || !title) {
    res.status(400).json({ error: 'docType and title are required' });
    return;
  }
  const doc = createPlanDocument({
    planUid: req.params.uid,
    docType,
    title,
    body: body ?? '',
    author: author ?? 'human',
    authorType: authorType ?? 'human',
  });
  broadcast('plan-doc-created', { doc });
  saveNow(() => exportDatabase());
  res.json(doc);
});

app.get('/api/plans/:uid/docs/by-type/:docType', (req, res) => {
  const { getPlanDocumentByType } = require('./services/plan-documents-service');
  const doc = getPlanDocumentByType(req.params.uid, req.params.docType);
  if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }
  res.json(doc);
});

app.get('/api/plans/:uid/docs/search', (req, res) => {
  const { searchPlanDocuments } = require('./services/plan-documents-service');
  const q = (req.query.q as string) || '';
  res.json(searchPlanDocuments(req.params.uid, q));
});

app.get('/api/plan-docs/:docUid', (req, res) => {
  const { getPlanDocument } = require('./services/plan-documents-service');
  const doc = getPlanDocument(req.params.docUid);
  if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }
  res.json(doc);
});

app.put('/api/plan-docs/:docUid', (req, res) => {
  const { updatePlanDocument } = require('./services/plan-documents-service');
  const { title, body, docType, changeSummary, author } = req.body || {};
  const doc = updatePlanDocument(req.params.docUid, { title, body, docType, changeSummary, author });
  if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }
  broadcast('plan-doc-updated', { doc });
  saveNow(() => exportDatabase());
  res.json(doc);
});

app.delete('/api/plan-docs/:docUid', (req, res) => {
  const { deletePlanDocument } = require('./services/plan-documents-service');
  deletePlanDocument(req.params.docUid);
  broadcast('plan-doc-deleted', { docUid: req.params.docUid });
  saveNow(() => exportDatabase());
  res.json({ ok: true });
});

app.get('/api/plan-docs/:docUid/versions', (req, res) => {
  const { getPlanDocumentVersions } = require('./services/plan-documents-service');
  res.json(getPlanDocumentVersions(req.params.docUid));
});

// --- Trellis Snapshots API ---

app.post('/api/trellis/capture', (req, res) => {
  const { projectPath, planUid, name } = req.body;
  if (!projectPath) { res.status(400).json({ error: 'projectPath required' }); return; }
  const { captureCurrentTrellis } = require('./services/trellis-service');
  const snapshot = captureCurrentTrellis(projectPath, planUid, name);
  broadcast('trellis-captured', { snapshot: { id: snapshot.id, name: snapshot.name, snapshotType: snapshot.snapshotType } });
  saveNow(() => exportDatabase());
  res.json({ id: snapshot.id, name: snapshot.name, snapshotType: snapshot.snapshotType, createdAt: snapshot.createdAt });
});

app.get('/api/trellis/snapshots', (req, res) => {
  const { listSnapshots } = require('./services/trellis-service');
  const planUid = req.query.plan as string | undefined;
  res.json(listSnapshots(planUid));
});

app.get('/api/trellis/:id', (req, res) => {
  const { getSnapshot } = require('./services/trellis-service');
  const snapshot = getSnapshot(parseInt(req.params.id));
  if (!snapshot) { res.status(404).json({ error: 'Snapshot not found' }); return; }
  res.json(snapshot);
});

app.get('/api/trellis/:id/diff', (req, res) => {
  const { computeTrellisDiff } = require('./services/trellis-service');
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
  const comment = commentService.addComment(targetType || 'plan', targetUid, 'user', 'human', body, commentType, parentUid);
  broadcast('comment-added', { comment });
  saveNow(() => exportDatabase());
  res.json(comment);
});

// --- Sessions API ---

app.get('/api/sessions', (_req, res) => {
  res.json(sessionService.getActiveSessions());
});

// Database stats
app.get('/api/stats', (_req, res) => {
  res.json(getDbStats());
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

// --- Server lifecycle ---

const DEFAULT_PORT = 3001;

export async function startServer(port = DEFAULT_PORT): Promise<http.Server> {
  await initDatabase();
  await initParser();

  // Start persistent auto-save for plan data
  startAutoSave(() => exportDatabase(), 30000);

  // Start MCP server for agent integration
  try {
    await startMcpServer();
  } catch (err) {
    console.warn('[Backend] MCP server failed to start:', err);
  }

  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`[Backend] Server running on http://localhost:${port}`);
      resolve(server);
    });
  });
}

export { app, server };

// If run directly (web mode), start the server
if (require.main === module) {
  startServer().catch(console.error);
}

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

async function captureGitCommitSnapshot(projectPath: string, commitHash: string): Promise<GitCommitSnapshotResult | null> {
  try {
    const commitMeta = execFileSync(
      'git',
      ['-C', projectPath, 'show', '-s', '--format=%H\t%h', commitHash],
      { encoding: 'utf8' },
    ).trim();

    if (!commitMeta) return null;

    const [resolvedCommitHash, shortCommitHash] = commitMeta.split('\t');
    const fileListOutput = execFileSync(
      'git',
      ['-C', projectPath, 'ls-tree', '-r', '--name-only', resolvedCommitHash],
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
    );

    const relativePaths = fileListOutput
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const parsedFiles = relativePaths
      .map((relativePath) => {
        const absolutePath = path.join(projectPath, relativePath);
        try {
          const content = execFileSync(
            'git',
            ['-C', projectPath, 'show', `${resolvedCommitHash}:${relativePath}`],
            { encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 },
          );
          return parseVirtualFile(absolutePath, content);
        } catch {
          return null;
        }
      })
      .filter((file): file is NonNullable<typeof file> => Boolean(file));

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

function getGitWorkingTreeStatus(projectPath: string): {
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
    const output = execFileSync(
      'git',
      ['-C', projectPath, 'status', '--porcelain=v1', '--untracked-files=all'],
      { encoding: 'utf8' },
    );

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
      const filePath = rawPath.includes('->') ? rawPath.split('->').pop()?.trim() || rawPath : rawPath;

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

function getGitBranchName(projectPath: string): string | null {
  try {
    const headPath = path.join(projectPath, '.git', 'HEAD');
    if (!fs.existsSync(headPath)) return null;
    const head = fs.readFileSync(headPath, 'utf-8').trim();
    const match = head.match(/^ref: refs\/heads\/(.+)$/);
    return match ? match[1] : 'detached';
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
