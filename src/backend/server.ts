import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { scanDirectory, countFiles, collectFilePaths } from './services/project-scanner';
import { detectMonorepo } from './services/monorepo-detector';
import { initParser, parseFiles } from './services/ast-parser';
import { initDatabase, storeParsedFile, searchSymbols, getFileSymbols, getDbStats, resolveImports, getDependencyEdges, getFileDependencies } from './services/database';
import { startWatching } from './services/file-watcher';
import { startClaudeCodeWatcher, getWatcherStatus } from './agent/claude-code-watcher';
import { captureSnapshot, setBaseline, computeDiff, getBaseline } from './services/diff-engine';
import { startMcpServer, getMcpStatus, getMcpConfig } from './mcp/server';
import { startAutoSave, saveNow } from './services/persistence';
import { exportDatabase } from './services/database';
import * as planService from './services/plan-service';
import * as commentService from './services/comment-service';
import * as sessionService from './services/session-service';

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

  const monorepoConfig = detectMonorepo(projectPath);
  const fileTree = scanDirectory(projectPath);
  const fileCount = countFiles(fileTree);

  // Parse all source files for AST data
  const filePaths = collectFilePaths(fileTree);
  const parsedFiles = await parseFiles(filePaths);

  for (const parsed of parsedFiles) {
    storeParsedFile(parsed, projectPath);
  }

  // Resolve import paths to actual files
  resolveImports(projectPath);

  const stats = getDbStats();
  console.log(`[API] Parsed ${stats.fileCount} files, ${stats.symbolCount} symbols, ${stats.importCount} imports, ${stats.resolvedImports} resolved`);

  // Capture baseline snapshot for diffing
  const depEdges = getDependencyEdges();
  const fileData = parsedFiles.map((f) => ({
    path: f.path.startsWith('/') ? path.relative(projectPath, f.path) : f.path,
    hash: f.contentHash,
    symbolCount: f.symbols.length,
  }));
  setBaseline(captureSnapshot(fileData, depEdges));

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

  res.json(diff || { summary: { added: 0, removed: 0, modified: 0, edgesAdded: 0, edgesRemoved: 0 } });
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
  planService.updatePlan(req.params.uid, { title, description, status }, 'user');
  broadcast('plan-updated', { planUid: req.params.uid });
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

// Update task
app.put('/api/plans/:uid/tasks/:taskUid', (req, res) => {
  const { status, assignee, assigneeType, assigneeModel, description } = req.body;
  planService.updateTask(req.params.taskUid, { status, assignee, assigneeType, assigneeModel, description });
  broadcast('task-updated', { planUid: req.params.uid, taskUid: req.params.taskUid, status });
  saveNow(() => exportDatabase());
  res.json({ ok: true });
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
