import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { searchSymbols, getDependencyEdges, getFileDependencies, getDbStats } from '../services/database';
import { broadcast } from '../server';
import { z } from 'zod';
import * as planService from '../services/plan-service';
import * as commentService from '../services/comment-service';
import * as sessionService from '../services/session-service';
import { saveNow } from '../services/persistence';
import { exportDatabase } from '../services/database';

const MCP_PORT = 19432;

let mcpServer: McpServer | null = null;
let httpServer: http.Server | null = null;
let connectedTransports = new Map<string, SSEServerTransport>();
// Maps MCP transport sessionId → registered agent sessionId
let transportToAgent = new Map<string, string>();

export async function startMcpServer(): Promise<void> {
  if (mcpServer) return;

  mcpServer = new McpServer(
    { name: 'codetrellis', version: '0.1.0' },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
      instructions: 'CodeTrellis provides codebase architecture analysis. Use these tools to understand how files connect, search for symbols, and report your plans.',
    }
  );

  // --- Tools ---

  mcpServer.registerTool(
    'search_symbols',
    {
      description: 'Search for functions, classes, interfaces, and other symbols across the codebase by name',
      inputSchema: {
        query: z.string().describe('Symbol name to search for (substring match)'),
      },
    },
    async ({ query }) => {
      const results = searchSymbols(query);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(results, null, 2),
        }],
      };
    }
  );

  mcpServer.registerTool(
    'get_dependencies',
    {
      description: 'Get what a file imports and what imports it. Returns incoming and outgoing dependency edges.',
      inputSchema: {
        file_path: z.string().describe('Absolute path to the file'),
      },
    },
    async ({ file_path }) => {
      const deps = getFileDependencies(file_path);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(deps, null, 2),
        }],
      };
    }
  );

  mcpServer.registerTool(
    'check_architecture',
    {
      description: 'Query the codebase dependency graph. Returns all file-to-file import edges, showing how the codebase is connected.',
      inputSchema: {
        query: z.string().optional().describe('Optional: filter edges by file path substring'),
      },
    },
    async ({ query }) => {
      let edges = getDependencyEdges();
      if (query) {
        edges = edges.filter(
          (e) => e.sourceRelative.includes(query) || e.targetRelative.includes(query)
        );
      }
      const stats = getDbStats();
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ stats, edges }, null, 2),
        }],
      };
    }
  );

  // --- Plan Management Tools ---

  mcpServer.registerTool(
    'create_plan',
    {
      description: 'Create a structured plan in CodeTrellis describing what you intend to do. The plan will be displayed in the UI for the user to review, comment on, and approve. Returns the plan UID.',
      inputSchema: {
        title: z.string().describe('Brief title of the plan'),
        description: z.string().optional().describe('Detailed description of what this plan achieves'),
        project_path: z.string().describe('Absolute path to the project this plan is for'),
        tasks: z.array(z.object({
          description: z.string().describe('What this task does'),
          affected_files: z.array(z.string()).optional().describe('Files this task will create/modify/delete'),
          affected_symbols: z.array(z.string()).optional().describe('Functions/classes this task will add/change'),
          new_connections: z.array(z.object({ from: z.string(), to: z.string() })).optional().describe('New import relationships'),
          removed_connections: z.array(z.object({ from: z.string(), to: z.string() })).optional().describe('Import relationships to remove'),
        })).describe('Ordered list of tasks'),
      },
    },
    async ({ title, description, project_path, tasks }) => {
      const plan = planService.createPlan(
        { title, description: description || '', tasks: tasks.map((t: any) => ({
          description: t.description,
          affectedFiles: t.affected_files,
          affectedSymbols: t.affected_symbols,
          newConnections: t.new_connections,
          removedConnections: t.removed_connections,
        })) },
        'agent', 'mcp', project_path,
      );
      broadcast('plan-created', { plan });
      saveNow(() => exportDatabase());
      return { content: [{ type: 'text' as const, text: JSON.stringify(plan, null, 2) }] };
    }
  );

  mcpServer.registerTool(
    'get_plan',
    {
      description: 'Read a plan by its UID. Returns the full plan with all tasks, status, and metadata.',
      inputSchema: { plan_uid: z.string().describe('Plan UID') },
    },
    async ({ plan_uid }) => {
      const plan = planService.getPlan(plan_uid);
      if (!plan) return { content: [{ type: 'text' as const, text: 'Plan not found' }] };
      return { content: [{ type: 'text' as const, text: JSON.stringify(plan, null, 2) }] };
    }
  );

  mcpServer.registerTool(
    'update_plan',
    {
      description: 'Update a plan (title, description, or status). Creates a new version snapshot.',
      inputSchema: {
        plan_uid: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        status: z.enum(['draft', 'review', 'approved', 'in_progress', 'completed', 'archived']).optional(),
      },
    },
    async ({ plan_uid, title, description, status }) => {
      planService.updatePlan(plan_uid, { title, description, status }, 'agent');
      broadcast('plan-updated', { planUid: plan_uid });
      saveNow(() => exportDatabase());
      return { content: [{ type: 'text' as const, text: `Plan ${plan_uid} updated.` }] };
    }
  );

  mcpServer.registerTool(
    'list_plans',
    {
      description: 'List all plans, optionally filtered by project path or status.',
      inputSchema: {
        project_path: z.string().optional(),
        status: z.string().optional(),
      },
    },
    async ({ project_path, status }) => {
      const plans = planService.listPlans(project_path, status);
      return { content: [{ type: 'text' as const, text: JSON.stringify(plans, null, 2) }] };
    }
  );

  // --- Task Management Tools ---

  mcpServer.registerTool(
    'claim_task',
    {
      description: 'Claim a task from a plan. Only succeeds if the task is unclaimed and pending.',
      inputSchema: {
        plan_uid: z.string(),
        task_uid: z.string(),
        agent_type: z.string().optional().describe('e.g. claude-code, cursor'),
        model: z.string().optional().describe('e.g. claude-opus-4'),
      },
    },
    async ({ plan_uid, task_uid, agent_type, model }) => {
      const ok = planService.claimTask(task_uid, agent_type || 'mcp-agent', agent_type || 'mcp', model);
      if (ok) {
        broadcast('task-claimed', { planUid: plan_uid, taskUid: task_uid, agentId: agent_type || 'mcp-agent' });
        saveNow(() => exportDatabase());
      }
      return { content: [{ type: 'text' as const, text: ok ? `Task ${task_uid} claimed.` : 'Task already claimed or not pending.' }] };
    }
  );

  mcpServer.registerTool(
    'update_task',
    {
      description: 'Update task status. Use this to report progress: pending → in_progress → done.',
      inputSchema: {
        plan_uid: z.string(),
        task_uid: z.string(),
        status: z.enum(['pending', 'assigned', 'in_progress', 'done', 'blocked', 'skipped']),
      },
    },
    async ({ plan_uid, task_uid, status }) => {
      planService.updateTask(task_uid, { status });
      broadcast('task-updated', { planUid: plan_uid, taskUid: task_uid, status });
      saveNow(() => exportDatabase());
      return { content: [{ type: 'text' as const, text: `Task ${task_uid} → ${status}` }] };
    }
  );

  mcpServer.registerTool(
    'get_next_task',
    {
      description: 'Get the next available unclaimed task from a plan, respecting dependency order.',
      inputSchema: { plan_uid: z.string() },
    },
    async ({ plan_uid }) => {
      const task = planService.getNextTask(plan_uid);
      if (!task) return { content: [{ type: 'text' as const, text: 'No tasks available — all claimed, completed, or blocked by dependencies.' }] };
      return { content: [{ type: 'text' as const, text: JSON.stringify(task, null, 2) }] };
    }
  );

  // --- Comment Tools ---

  mcpServer.registerTool(
    'add_comment',
    {
      description: 'Leave a comment on a plan or task. Use this to communicate with the user or other agents.',
      inputSchema: {
        target_uid: z.string().describe('Plan UID or Task UID to comment on'),
        body: z.string().describe('Comment text (markdown supported)'),
        comment_type: z.enum(['comment', 'suggestion', 'approval', 'concern', 'status_update']).optional(),
        parent_uid: z.string().optional().describe('Parent comment UID for threading'),
      },
    },
    async ({ target_uid, body, comment_type, parent_uid }) => {
      const comment = commentService.addComment('plan', target_uid, 'agent', 'mcp', body, comment_type || 'comment', parent_uid);
      broadcast('comment-added', { comment });
      saveNow(() => exportDatabase());
      return { content: [{ type: 'text' as const, text: `Comment added to ${target_uid}` }] };
    }
  );

  mcpServer.registerTool(
    'get_comments',
    {
      description: 'Read all comments on a plan or task.',
      inputSchema: { target_uid: z.string() },
    },
    async ({ target_uid }) => {
      const comments = commentService.getComments(target_uid);
      return { content: [{ type: 'text' as const, text: JSON.stringify(comments, null, 2) }] };
    }
  );

  // --- Session Tools ---

  mcpServer.registerTool(
    'register_session',
    {
      description: 'Register this agent connection with CodeTrellis. Identifies who you are and what model you use.',
      inputSchema: {
        agent_type: z.string().describe('Agent type, e.g. claude-code, cursor, aider'),
        model: z.string().optional().describe('Model name, e.g. claude-opus-4, gpt-4o'),
      },
    },
    async ({ agent_type, model }) => {
      const sessionId = `mcp-${Date.now()}`;
      sessionService.registerSession(sessionId, agent_type, model);
      broadcast('session-registered', { sessionId, agentType: agent_type, model });
      saveNow(() => exportDatabase());
      return { content: [{ type: 'text' as const, text: `Session registered: ${sessionId}` }] };
    }
  );

  mcpServer.registerTool(
    'set_active_plan',
    {
      description: 'Associate this agent session with a plan, indicating you are working on it.',
      inputSchema: { plan_uid: z.string() },
    },
    async ({ plan_uid }) => {
      // Find the most recent session for this transport
      const sessions = sessionService.getActiveSessions();
      if (sessions.length > 0) {
        sessionService.setActivePlan(sessions[sessions.length - 1].sessionId, plan_uid);
      }
      return { content: [{ type: 'text' as const, text: `Active plan set to ${plan_uid}` }] };
    }
  );

  // Legacy tool — kept for backward compatibility
  mcpServer.registerTool(
    'report_plan',
    {
      description: '[Legacy] Report a plan. Prefer create_plan instead.',
      inputSchema: {
        title: z.string(),
        steps: z.array(z.object({
          description: z.string(),
          files: z.array(z.string()).optional(),
        })),
      },
    },
    async ({ title, steps }) => {
      // Delegate to create_plan
      const plan = planService.createPlan(
        { title, description: '', tasks: steps.map((s: any) => ({ description: s.description, affectedFiles: s.files })) },
        'agent', 'mcp', '',
      );
      broadcast('plan-created', { plan });
      saveNow(() => exportDatabase());
      return { content: [{ type: 'text' as const, text: `Plan "${title}" created with UID: ${plan.uid}` }] };
    }
  );

  mcpServer.registerTool(
    'check_conformity',
    {
      description: 'Check if proposed imports would violate architectural boundaries (circular dependencies, layer violations)',
      inputSchema: {
        proposed_imports: z.array(z.object({
          from: z.string().describe('File that would contain the import'),
          importing: z.string().describe('File being imported'),
        })).describe('List of proposed import relationships to check'),
      },
    },
    async ({ proposed_imports }) => {
      const edges = getDependencyEdges();
      const edgeSet = new Set(edges.map((e) => `${e.sourceRelative}->${e.targetRelative}`));
      const violations: Array<{ rule: string; message: string }> = [];

      for (const imp of proposed_imports) {
        // Check for circular dependency
        const reverse = `${imp.importing}->${imp.from}`;
        if (edgeSet.has(reverse)) {
          violations.push({
            rule: 'circular-dependency',
            message: `Adding ${imp.from} -> ${imp.importing} would create a circular dependency (${imp.importing} already imports ${imp.from})`,
          });
        }
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            conformant: violations.length === 0,
            violations,
            checkedImports: proposed_imports.length,
          }, null, 2),
        }],
      };
    }
  );

  // --- Resources ---

  mcpServer.registerResource(
    'project://graph',
    'project://graph',
    {
      description: 'Current dependency graph as JSON — all file-to-file import edges',
      mimeType: 'application/json',
    },
    async () => {
      const edges = getDependencyEdges();
      const stats = getDbStats();
      return {
        contents: [{
          uri: 'project://graph',
          mimeType: 'application/json',
          text: JSON.stringify({ stats, edges }, null, 2),
        }],
      };
    }
  );

  mcpServer.registerResource(
    'codetrellis://plans',
    'codetrellis://plans',
    {
      description: 'List of all plans in CodeTrellis',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [{
        uri: 'codetrellis://plans',
        mimeType: 'application/json',
        text: JSON.stringify(planService.listPlans(), null, 2),
      }],
    })
  );

  mcpServer.registerResource(
    'codetrellis://sessions',
    'codetrellis://sessions',
    {
      description: 'Active agent sessions connected to CodeTrellis',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [{
        uri: 'codetrellis://sessions',
        mimeType: 'application/json',
        text: JSON.stringify(sessionService.getActiveSessions(), null, 2),
      }],
    })
  );

  mcpServer.registerResource(
    'project://stats',
    'project://stats',
    {
      description: 'Database statistics — file count, symbol count, import count',
      mimeType: 'application/json',
    },
    async () => {
      return {
        contents: [{
          uri: 'project://stats',
          mimeType: 'application/json',
          text: JSON.stringify(getDbStats(), null, 2),
        }],
      };
    }
  );

  // --- HTTP Server with SSE ---

  const app = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === '/sse' && req.method === 'GET') {
      const transport = new SSEServerTransport('/messages', res);
      const sessionId = transport.sessionId;
      connectedTransports.set(sessionId, transport);

      res.on('close', () => {
        connectedTransports.delete(sessionId);
        console.log(`[MCP] Client disconnected: ${sessionId}`);
        broadcast('agent-event', {
          id: `mcp-disconnect-${Date.now()}`,
          timestamp: Date.now(),
          source: 'mcp',
          type: 'session_end',
          payload: { sessionId },
        });
      });

      console.log(`[MCP] Client connected: ${sessionId}`);
      broadcast('agent-event', {
        id: `mcp-connect-${Date.now()}`,
        timestamp: Date.now(),
        source: 'mcp',
        type: 'session_start',
        payload: { sessionId, source: 'mcp' },
      });

      await mcpServer!.connect(transport);
      return;
    }

    if (req.url?.startsWith('/messages') && req.method === 'POST') {
      const sessionId = new URL(req.url, `http://localhost:${MCP_PORT}`).searchParams.get('sessionId');
      if (!sessionId || !connectedTransports.has(sessionId)) {
        res.writeHead(404);
        res.end('Session not found');
        return;
      }
      const transport = connectedTransports.get(sessionId)!;
      await transport.handlePostMessage(req, res);
      return;
    }

    // Health check
    if (req.url === '/' || req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        name: 'codetrellis-mcp',
        version: '0.1.0',
        connectedClients: connectedTransports.size,
      }));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  httpServer = app;

  return new Promise<void>((resolve) => {
    app.listen(MCP_PORT, '127.0.0.1', () => {
      console.log(`[MCP] Server running on http://127.0.0.1:${MCP_PORT}`);
      resolve();
    });
  });
}

export function getMcpStatus(): {
  running: boolean;
  port: number;
  connectedAgents: number;
} {
  return {
    running: httpServer !== null,
    port: MCP_PORT,
    connectedAgents: connectedTransports.size,
  };
}

/**
 * MCP config for agents to copy into their settings.
 */
export function getMcpConfig(): Record<string, unknown> {
  return {
    codetrellis: {
      type: 'sse',
      url: `http://127.0.0.1:${MCP_PORT}/sse`,
    },
  };
}

export async function stopMcpServer(): Promise<void> {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
  if (mcpServer) {
    await mcpServer.close();
    mcpServer = null;
  }
  connectedTransports.clear();
}
