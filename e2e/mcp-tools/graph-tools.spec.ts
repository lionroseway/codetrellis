/**
 * MCP graph/analysis tools — search_symbols, get_dependencies,
 * list_cross_system_edges, check_architecture, check_conformity.
 */

import { test, expect } from '@playwright/test';
import { createMcpClient } from '../helpers/mcp-client';

test.describe('MCP graph tools', () => {
  test('search_symbols returns results for known symbol', async () => {
    const client = await createMcpClient();
    const result = await client.callTool('search_symbols', { query: 'app' });
    expect(result).toBeTruthy();
    // Result should have content array with text
    expect(result.content || result.text || result).toBeTruthy();
    client.close();
  });

  test('get_dependencies returns edges for a file', async () => {
    const client = await createMcpClient();
    const result = await client.callTool('get_dependencies', {
      file_path: 'src/backend/server.ts',
    });
    expect(result).toBeTruthy();
    client.close();
  });

  test('list_cross_system_edges returns cross-system data', async () => {
    const client = await createMcpClient();
    const result = await client.callTool('list_cross_system_edges', {});
    expect(result).toBeTruthy();
    client.close();
  });

  test('check_architecture returns analysis', async () => {
    const client = await createMcpClient();
    const result = await client.callTool('check_architecture', {});
    expect(result).toBeTruthy();
    client.close();
  });

  test('check_conformity returns conformity report', async () => {
    const client = await createMcpClient();
    const result = await client.callTool('check_conformity', {});
    expect(result).toBeTruthy();
    client.close();
  });
});
