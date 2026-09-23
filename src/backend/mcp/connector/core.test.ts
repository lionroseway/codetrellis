/**
 * The connector's routing, over fake transports.
 *
 * Each test is one thing a user would otherwise have to fix by hand: an app
 * that restarted under a connected agent, an app that was not running when
 * the agent started, a request that was in flight when the app went away.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ConnectorCore, NOT_RUNNING_MESSAGE, LOST_MESSAGE, type JsonRpcMessage, type Upstream } from './core';

/** A fake app. `respond` decides what it answers; it records what it was sent. */
class FakeUpstream implements Upstream {
  sent: JsonRpcMessage[] = [];
  closed = false;
  onmessage?: (msg: JsonRpcMessage) => void;
  onclose?: () => void;

  constructor(private respond: (msg: JsonRpcMessage) => JsonRpcMessage | null = defaultRespond) {}

  async send(msg: JsonRpcMessage) {
    if (this.closed) throw new Error('closed');
    this.sent.push(msg);
    const reply = this.respond(msg);
    if (reply) queueMicrotask(() => this.onmessage?.(reply));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }

  methods() {
    return this.sent.map((m) => m.method ?? `response:${String(m.id)}`);
  }
}

function defaultRespond(msg: JsonRpcMessage): JsonRpcMessage | null {
  if (msg.id === undefined || msg.id === null) return null;
  if (msg.method === 'initialize') {
    return { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'codetrellis-mcp', version: '0.1.0' } } };
  }
  if (msg.method === 'tools/list') return { jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'list_plans' }] } };
  return { jsonrpc: '2.0', id: msg.id, result: { ok: true } };
}

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

/** A connector whose `connect` hands out the upstreams you queue, or fails when none are queued. */
function harness(opts: { initialWaitMs?: number } = {}) {
  const toClient: JsonRpcMessage[] = [];
  const queue: FakeUpstream[] = [];
  let connects = 0;
  const core = new ConnectorCore({
    version: 'test',
    send: (m) => toClient.push(m),
    connect: async () => {
      connects++;
      const next = queue.shift();
      if (!next) throw new Error('app not running');
      return next;
    },
    initialWaitMs: opts.initialWaitMs ?? 50,
    retryMinMs: 5,
    retryMaxMs: 20,
    replayTimeoutMs: 200,
  });
  return {
    core,
    toClient,
    queue,
    get connects() { return connects; },
    reply(id: number) { return toClient.find((m) => m.id === id && m.method === undefined); },
  };
}

const init = (id = 1): JsonRpcMessage => ({
  jsonrpc: '2.0', id, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '9' } },
});
const initialized: JsonRpcMessage = { jsonrpc: '2.0', method: 'notifications/initialized' };

describe('ConnectorCore — app running', () => {
  test('passes the handshake and calls straight through, clientInfo untouched', async () => {
    const h = harness();
    const up = new FakeUpstream();
    h.queue.push(up);
    h.core.start();
    await tick();

    await h.core.handleClientMessage(init());
    await tick();
    await h.core.handleClientMessage(initialized);
    await h.core.handleClientMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    await tick();

    assert.deepEqual(up.methods(), ['initialize', 'notifications/initialized', 'tools/list']);
    // The server identifies the agent from this; the connector must not replace it.
    assert.deepEqual((up.sent[0].params as { clientInfo: unknown }).clientInfo, { name: 'claude-code', version: '9' });
    assert.equal((h.reply(1)?.result as { serverInfo: { name: string } }).serverInfo.name, 'codetrellis-mcp');
    assert.deepEqual(h.reply(2)?.result, { tools: [{ name: 'list_plans' }] });
    h.core.stop();
  });

  test('a connection that lands while initialize is waiting does not initialize the server twice', async () => {
    // The app is slow to accept: the connect is still in progress when the
    // client's initialize arrives, and completes while it waits.
    const up = new FakeUpstream();
    const toClient: JsonRpcMessage[] = [];
    const core = new ConnectorCore({
      version: 'test',
      send: (m) => toClient.push(m),
      connect: () => new Promise((r) => setTimeout(() => r(up), 30)),
      initialWaitMs: 500,
    });
    core.start();
    await core.handleClientMessage(init());
    await tick(20);

    assert.equal(up.sent.filter((m) => m.method === 'initialize').length, 1);
    assert.equal(up.sent[0].id, 1, 'the client\'s own initialize, not a replay');
    assert.ok(toClient.some((m) => m.id === 1), 'and the client got the real reply');
    core.stop();
  });
});

describe('ConnectorCore — app not running', () => {
  test('completes the handshake itself, lists no tools, and says what to do', async () => {
    const h = harness();
    h.core.start();
    await tick();

    await h.core.handleClientMessage(init());
    await h.core.handleClientMessage(initialized);
    await h.core.handleClientMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    await h.core.handleClientMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_plans' } });
    await h.core.handleClientMessage({ jsonrpc: '2.0', id: 4, method: 'something/else' });

    const hello = h.reply(1)?.result as { protocolVersion: string; capabilities: { tools: { listChanged: boolean } }; instructions: string };
    assert.equal(hello.protocolVersion, '2025-06-18', 'echoes the version the client asked for');
    assert.equal(hello.capabilities.tools.listChanged, true, 'so the tools can appear later');
    assert.equal(hello.instructions, NOT_RUNNING_MESSAGE);
    assert.deepEqual(h.reply(2)?.result, { tools: [] });
    const call = h.reply(3)?.result as { isError: boolean; content: Array<{ text: string }> };
    assert.equal(call.isError, true);
    assert.equal(call.content[0].text, NOT_RUNNING_MESSAGE, 'a tool result the model can read, not an opaque error');
    assert.equal(h.reply(4)?.error?.message, NOT_RUNNING_MESSAGE);
    h.core.stop();
  });

  test('when the app appears, the server is brought up and the client is told to re-list', async () => {
    const h = harness();
    h.core.start();
    await tick();
    await h.core.handleClientMessage(init());
    await h.core.handleClientMessage(initialized);

    const up = new FakeUpstream();
    h.queue.push(up);
    await tick(60); // a few retries

    // Replayed with the client's own params, then `initialized` — once.
    assert.deepEqual(up.methods(), ['initialize', 'notifications/initialized']);
    assert.deepEqual((up.sent[0].params as { clientInfo: unknown }).clientInfo, { name: 'claude-code', version: '9' });
    // The replay's reply is ours, not the client's: it already had one.
    assert.equal(h.toClient.filter((m) => m.id === up.sent[0].id).length, 0);
    assert.ok(h.toClient.some((m) => m.method === 'notifications/tools/list_changed'));

    await h.core.handleClientMessage({ jsonrpc: '2.0', id: 5, method: 'tools/list' });
    await tick();
    assert.deepEqual(h.reply(5)?.result, { tools: [{ name: 'list_plans' }] });
    h.core.stop();
  });
});

describe('ConnectorCore — app restarts', () => {
  test('a request in flight is answered, not left hanging, and the next one reaches the new server', async () => {
    const h = harness();
    // The first app never answers tools/call — it dies first.
    const first = new FakeUpstream((m) => (m.method === 'tools/call' ? null : defaultRespond(m)));
    h.queue.push(first);
    h.core.start();
    await tick();
    await h.core.handleClientMessage(init());
    await tick();
    await h.core.handleClientMessage(initialized);

    await h.core.handleClientMessage({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'slow' } });
    const second = new FakeUpstream();
    h.queue.push(second);
    first.close(); // the app quits
    assert.equal(h.reply(7)?.error?.message, LOST_MESSAGE);

    await tick(60);
    assert.deepEqual(second.methods(), ['initialize', 'notifications/initialized'], 'the new server is initialised by replay');

    await h.core.handleClientMessage({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'list_plans' } });
    await tick();
    assert.deepEqual(h.reply(8)?.result, { ok: true });
    assert.equal(h.toClient.filter((m) => m.method === 'initialize').length, 0, 'the client never sees a server-side handshake');
    h.core.stop();
  });

  test('a new server that refuses the replayed handshake is dropped and retried', async () => {
    const h = harness();
    h.core.start();
    await tick();
    await h.core.handleClientMessage(init());

    const refusing = new FakeUpstream((m) => (m.method === 'initialize' ? { jsonrpc: '2.0', id: m.id, error: { code: -32600, message: 'nope' } } : null));
    const good = new FakeUpstream();
    h.queue.push(refusing, good);
    await tick(80);

    assert.equal(refusing.closed, true);
    assert.deepEqual(good.methods(), ['initialize', 'notifications/initialized']);
    assert.equal(h.core.connected, true);
    h.core.stop();
  });

  test('server-initiated requests reach the client, and its answers go back', async () => {
    const h = harness();
    const up = new FakeUpstream();
    h.queue.push(up);
    h.core.start();
    await tick();
    await h.core.handleClientMessage(init());
    await tick();
    await h.core.handleClientMessage(initialized);

    up.onmessage?.({ jsonrpc: '2.0', id: 'srv-1', method: 'roots/list' });
    assert.ok(h.toClient.some((m) => m.id === 'srv-1' && m.method === 'roots/list'));
    await h.core.handleClientMessage({ jsonrpc: '2.0', id: 'srv-1', result: { roots: [] } });
    assert.deepEqual(up.sent.at(-1), { jsonrpc: '2.0', id: 'srv-1', result: { roots: [] } });
    h.core.stop();
  });
});
