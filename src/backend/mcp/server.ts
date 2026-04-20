import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { searchSymbols, getDependencyEdges, getFileDependencies, getDbStats } from '../services/database';
import { broadcast } from '../server';
import { z } from 'zod';

const MCP_PORT = 19432;

let mcpServer: McpServer | null = null;
let httpServer: http.Server | null = null;
let connectedTransports = new Map<string, SSEServerTransport>();

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

  mcpServer.registerTool(
    'report_plan',
    {
      description: 'Report your intended plan to CodeTrellis so the user can see what you plan to do. The plan will be displayed in the CodeTrellis UI.',
      inputSchema: {
        title: z.string().describe('Brief title of the plan'),
        steps: z.array(z.object({
          description: z.string().describe('What this step does'),
          files: z.array(z.string()).optional().describe('Files this step will affect'),
        })).describe('Ordered list of steps'),
      },
    },
    async ({ title, steps }) => {
      const plan = {
        id: `mcp-${Date.now()}`,
        title,
        steps: steps.map((s: { description: string; files?: string[] }) => ({
          description: s.description,
          status: 'pending' as const,
          files: s.files || [],
        })),
        status: 'proposed' as const,
        affectedFiles: steps.flatMap((s: { files?: string[] }) => s.files || []),
        estimatedImpact: null,
      };

      broadcast('agent-event', {
        id: `mcp-plan-${Date.now()}`,
        timestamp: Date.now(),
        source: 'mcp',
        type: 'plan_reported',
        payload: { plan },
      });

      return {
        content: [{
          type: 'text' as const,
          text: `Plan "${title}" with ${steps.length} steps reported to CodeTrellis UI.`,
        }],
      };
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
