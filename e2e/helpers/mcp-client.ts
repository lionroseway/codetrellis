/**
 * Lightweight MCP JSON-RPC client over SSE for E2E tests.
 *
 * The MCP SDK's SSE transport works as follows:
 * 1. Client connects to GET /sse — receives an `endpoint` event with the POST URL
 * 2. Client sends JSON-RPC requests via POST to that endpoint
 * 3. Server responds via SSE `message` events on the original stream
 *
 * This client maintains the SSE connection and routes responses by JSON-RPC id.
 */

import http from 'node:http';
import { authHeaders } from './setup';

const MCP_PORT = 19432;

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export async function createMcpClient(): Promise<{
  sessionId: string;
  callTool: (name: string, args: Record<string, any>) => Promise<any>;
  listTools: () => Promise<string[]>;
  close: () => void;
}> {
  const pending = new Map<number, PendingRequest>();
  let endpoint = '';
  let sessionId = '';
  let callId = 10;
  let sseRequest: http.ClientRequest | null = null;

  // Step 1: Connect to SSE and wait for the endpoint event
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('SSE connect timeout')), 10000);

    // The MCP server authenticates like every other local transport
    // (Phase 19). The advertised POST endpoint carries the token back, but
    // the stream request itself has to present it.
    sseRequest = http.get(`http://127.0.0.1:${MCP_PORT}/sse`, { headers: authHeaders() }, (res) => {
      if (res.statusCode !== 200) {
        clearTimeout(timeout);
        reject(new Error(`MCP SSE refused with HTTP ${res.statusCode}`));
        return;
      }
      let buffer = '';
      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        processSSEBuffer(buffer);
      });
      res.on('error', (err) => reject(err));
    });

    sseRequest.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    function processSSEBuffer(buf: string) {
      const events = parseSSEEvents(buf);
      for (const evt of events) {
        if (evt.event === 'endpoint' && evt.data) {
          clearTimeout(timeout);
          const url = new URL(evt.data, `http://127.0.0.1:${MCP_PORT}`);
          sessionId = url.searchParams.get('sessionId') || '';
          endpoint = url.href;
          resolve();
        }
        if (evt.event === 'message' && evt.data) {
          try {
            const msg = JSON.parse(evt.data);
            if (msg.id !== undefined && pending.has(msg.id)) {
              const p = pending.get(msg.id)!;
              clearTimeout(p.timeout);
              pending.delete(msg.id);
              if (msg.error) {
                p.reject(new Error(`JSON-RPC error: ${JSON.stringify(msg.error)}`));
              } else {
                p.resolve(msg.result ?? msg);
              }
            }
          } catch {
            // Not JSON or not for us
          }
        }
      }
    }
  });

  // Step 2: Initialize handshake
  const initResult = await rpcCall({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'e2e-test', version: '1.0.0' },
    },
  });

  // Step 3: Send initialized notification (fire and forget)
  await postMessage({
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  });

  function rpcCall(body: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = body.id;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`JSON-RPC timeout for ${body.method} (id=${id})`));
      }, 15000);

      pending.set(id, { resolve, reject, timeout });
      postMessage(body).catch((err) => {
        clearTimeout(timeout);
        pending.delete(id);
        reject(err);
      });
    });
  }

  function postMessage(body: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = new URL(endpoint);
      const postData = JSON.stringify(body);
      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (c: Buffer) => { data += c.toString(); });
        res.on('end', () => resolve());
      });
      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }

  return {
    sessionId,

    async callTool(name: string, args: Record<string, any>) {
      const id = ++callId;
      return rpcCall({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name, arguments: args },
      });
    },

    async listTools() {
      const id = ++callId;
      const response = await rpcCall({
        jsonrpc: '2.0',
        id,
        method: 'tools/list',
        params: {},
      });
      return (response?.tools || []).map((t: any) => t.name);
    },

    close() {
      // Abort the SSE connection
      if (sseRequest) {
        sseRequest.destroy();
      }
      // Clean up pending
      for (const [, p] of pending) {
        clearTimeout(p.timeout);
      }
      pending.clear();
    },
  };
}

/**
 * Parse SSE events from a buffer.
 * Returns all complete events found (event + data pairs).
 */
function parseSSEEvents(buffer: string): Array<{ event?: string; data?: string }> {
  const events: Array<{ event?: string; data?: string }> = [];
  const lines = buffer.split('\n');
  let currentEvent: string | undefined;
  let currentData: string | undefined;

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      currentData = line.slice(6).trim();
    } else if (line.trim() === '' && (currentEvent || currentData)) {
      events.push({ event: currentEvent, data: currentData });
      currentEvent = undefined;
      currentData = undefined;
    }
  }
  // Also capture partial (event+data without trailing blank line)
  if (currentEvent && currentData) {
    events.push({ event: currentEvent, data: currentData });
  }

  return events;
}
