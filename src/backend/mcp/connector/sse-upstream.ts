/**
 * One SSE connection to the app's MCP server, with the token read fresh.
 *
 * Written against `fetch` rather than the SDK's `SSEClientTransport` for one
 * reason: EventSource reconnects on its own. After an app restart that would
 * retry the old URL with the old token and the old session, and fail in a
 * way the connector cannot distinguish from a live stream. Here a stream that
 * ends is simply over, and the connector decides what happens next — with
 * the token and endpoint files re-read.
 *
 * The wire format is the SDK's: the server's first SSE event is `endpoint`,
 * naming the URL to POST client messages to; every later `message` event is
 * one JSON-RPC message.
 */

import type { JsonRpcMessage, Upstream } from './core';

export const TOKEN_HEADER = 'x-codetrellis-token';

export class UpstreamRefused extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'UpstreamRefused';
  }
}

export interface SseUpstreamOptions {
  url: string;
  token: string;
  /** How long to wait for the server's `endpoint` event. */
  handshakeTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export async function connectSseUpstream(opts: SseUpstreamOptions): Promise<Upstream> {
  const doFetch = opts.fetchImpl ?? fetch;
  const abort = new AbortController();
  const headers = { [TOKEN_HEADER]: opts.token };

  let res: Response;
  try {
    res = await doFetch(opts.url, {
      headers: { ...headers, Accept: 'text/event-stream' },
      signal: abort.signal,
    });
  } catch (err) {
    abort.abort();
    throw new Error(`not reachable at ${opts.url}${err instanceof Error && err.message ? ` (${err.message})` : ''}`);
  }
  if (!res.ok || !res.body) {
    abort.abort();
    throw new UpstreamRefused(
      res.status,
      res.status === 401
        ? 'the capability token was refused — the app may be mid-restart'
        : `the server answered HTTP ${res.status}`,
    );
  }

  let closed = false;
  let postUrl: string | null = null;
  let resolveEndpoint: (url: string) => void = () => {};
  const endpointSeen = new Promise<string>((resolve) => { resolveEndpoint = resolve; });

  const upstream: Upstream = {
    async send(msg: JsonRpcMessage) {
      if (closed || !postUrl) throw new Error('connection closed');
      const r = await doFetch(postUrl, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(msg),
      });
      // Drain so the socket is released; the SDK answers 202 with a short body.
      await r.text().catch(() => '');
      if (!r.ok) throw new UpstreamRefused(r.status, `message refused with HTTP ${r.status}`);
    },
    close() {
      if (closed) return;
      closed = true;
      abort.abort();
      upstream.onclose?.();
    },
  };

  const onEvent = (event: string, data: string) => {
    if (event === 'endpoint') {
      // Resolve against the stream URL, and refuse to follow it anywhere
      // else: the POST carries the token too.
      const target = new URL(data, opts.url);
      if (target.origin !== new URL(opts.url).origin) {
        upstream.close();
        return;
      }
      postUrl = target.toString();
      resolveEndpoint(postUrl);
      return;
    }
    if (event === 'message') {
      let parsed: JsonRpcMessage;
      try {
        parsed = JSON.parse(data) as JsonRpcMessage;
      } catch {
        return; // not ours to repair
      }
      upstream.onmessage?.(parsed);
    }
  };

  // Pump the stream in the background. Its end — clean or not — is the end
  // of this connection.
  void (async () => {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, '\n');
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          let event = 'message';
          const data: string[] = [];
          for (const line of block.split('\n')) {
            if (line.startsWith(':')) continue; // comment / keep-alive
            const colon = line.indexOf(':');
            const field = colon === -1 ? line : line.slice(0, colon);
            const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
            if (field === 'event') event = value;
            else if (field === 'data') data.push(value);
          }
          if (data.length > 0) onEvent(event, data.join('\n'));
        }
      }
    } catch {
      /* aborted or reset — either way, over */
    }
    upstream.close();
  })();

  const timeout = opts.handshakeTimeoutMs ?? 5000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const winner = await Promise.race([
    endpointSeen,
    new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeout); }),
  ]);
  clearTimeout(timer);
  if (!winner || closed) {
    upstream.close();
    throw new Error('the server did not complete the SSE handshake');
  }
  return upstream;
}
