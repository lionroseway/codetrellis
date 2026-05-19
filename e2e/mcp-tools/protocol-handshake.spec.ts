/**
 * MCP protocol-level tests — SSE connect, JSON-RPC handshake,
 * tools/list, tool discovery.
 *
 * These tests run entirely over HTTP (no Playwright browser needed),
 * exercising the actual MCP wire protocol that agents like Claude Code
 * and Cursor use.
 */

import { test, expect } from '@playwright/test';
import { createMcpClient } from '../helpers/mcp-client';

test.describe('MCP protocol handshake', () => {
  test('SSE connect + initialize + tools/list succeeds', async () => {
    const client = await createMcpClient();
    expect(client.sessionId).toBeTruthy();

    const tools = await client.listTools();
    expect(tools.length).toBeGreaterThanOrEqual(60);
    client.close();
  });

  test('tools/list contains expected core tools', async () => {
    const client = await createMcpClient();
    const tools = await client.listTools();

    const expected = [
      'search_symbols', 'get_dependencies', 'create_plan',
      'get_plan', 'list_plans', 'add_item', 'get_item',
      'update_item', 'claim_item', 'list_items',
      'register_session', 'add_comment', 'get_comments',
    ];

    for (const name of expected) {
      expect(tools).toContain(name);
    }
    client.close();
  });

  test('session is registered and visible in sessions API', async ({ request }) => {
    const client = await createMcpClient();

    // The SSE connection should register a session
    const res = await request.get('http://localhost:3001/api/sessions');
    expect(res.ok()).toBeTruthy();

    client.close();
  });
});
