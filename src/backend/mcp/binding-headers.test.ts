/**
 * The connector tells the server where the agent works (Phase 32 A1.1).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindingHeaders, readBindingHeaders, CWD_HEADER, HOST_TERMINAL_HEADER } from './binding-headers';
import { connectSseUpstream } from './connector/sse-upstream';

test('a folder with spaces and non-Latin characters survives the header round trip', () => {
  const cwd = '/Users/sam/Code/café app/worktrees/auth';
  const headers = bindingHeaders({ cwd, hostTerminal: 'term-7' });
  assert.ok(/^[\x20-\x7e]+$/.test(headers[CWD_HEADER]), 'header values stay printable ASCII');
  assert.deepEqual(readBindingHeaders(headers), { cwd, hostTerminal: 'term-7' });
});

test('nothing sent, malformed, or carrying a NUL reads as absent', () => {
  assert.deepEqual(bindingHeaders({}), {});
  assert.deepEqual(readBindingHeaders({}), { cwd: null, hostTerminal: null });
  assert.deepEqual(readBindingHeaders({ [CWD_HEADER]: '%E0%A4%A' }), { cwd: null, hostTerminal: null });
  assert.deepEqual(readBindingHeaders({ [CWD_HEADER]: encodeURIComponent('/a\0/b') }), { cwd: null, hostTerminal: null });
  assert.equal(readBindingHeaders({ [HOST_TERMINAL_HEADER]: ['t-1', 't-2'] }).hostTerminal, 't-1');
});

test('the connector sends the binding on connect, and only on connect', async () => {
  const seen: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    seen.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    if (init?.method === 'POST') return new Response('', { status: 202 });
    const body = new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode('event: endpoint\ndata: /messages?x=1\n\n')); },
    });
    return new Response(body, { status: 200 });
  }) as typeof fetch;

  const upstream = await connectSseUpstream({
    url: 'http://127.0.0.1:1/sse', token: 't', fetchImpl,
    binding: { cwd: '/repo/app-auth', hostTerminal: 'term-7' },
  });
  await upstream.send({ jsonrpc: '2.0', id: 1, method: 'ping' });
  upstream.close();

  assert.equal(readBindingHeaders(seen[0].headers).cwd, '/repo/app-auth');
  assert.equal(readBindingHeaders(seen[0].headers).hostTerminal, 'term-7');
  assert.equal(seen[1].headers[CWD_HEADER], undefined, 'messages carry the token, not the binding');
});
