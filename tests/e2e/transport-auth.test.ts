/**
 * Phase 19 Gate 4 §1 — transport authentication acceptance tests.
 *
 * These are the tests findings 1, 4 and 5 close on. They are deliberately
 * NEGATIVE tests: each asserts that a specific way in is refused. A positive
 * test ("the app still works") is already covered by the other 140-odd tests
 * in this suite — those would all have gone red if authentication broke the
 * legitimate path.
 *
 * The threat being tested is not another user on the machine. It is a WEB
 * PAGE the developer visits, which can reach 127.0.0.1 from their browser.
 * Before Gate 1.1 the CORS middleware reflected that page's origin back with
 * `Access-Control-Allow-Credentials: true`, so it could read the responses:
 * arbitrary file reads, directory enumeration, terminal control.
 *
 * Each test below corresponds to a line in the reviewer's acceptance list:
 *
 *   foreign Origin · Origin: null · mismatched Host · missing token ·
 *   incorrect token · WebSocket upgrade without a token
 *
 * MCP transport authentication has its own test in mcp-auth.test.ts.
 */

import { test, expect } from '@playwright/test';
import * as net from 'node:net';
import { setupHarness } from '../harness';

/**
 * Send a raw HTTP/1.1 request and return the status line + headers.
 *
 * WHY NOT `fetch`
 *
 * undici treats `Host` and `Upgrade` as forbidden headers and silently
 * rewrites or rejects them. Both are exactly what these tests need to
 * control: DNS rebinding is defined by a mismatched Host, and a WebSocket
 * handshake is defined by the Upgrade header. Testing them through fetch
 * produces a false PASS on Host (fetch substitutes the real one) and a hard
 * error on Upgrade.
 *
 * A browser sets both of these itself, faithfully — a rebinding attack gets
 * `Host: evil.example.com` for free because that genuinely is the name it
 * resolved. So raw sockets are the accurate simulation, not a workaround.
 */
function rawRequest(
  port: number,
  lines: string[],
  timeoutMs = 5000,
): Promise<{ status: number; headers: string; raw: string }> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let buf = '';
    const done = (err?: Error) => {
      socket.destroy();
      if (err) reject(err);
    };
    socket.setTimeout(timeoutMs, () => done(new Error('raw request timed out')));
    socket.on('error', done);
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf-8');
      // Resolve as soon as the head is complete — we never need the body.
      if (buf.includes('\r\n\r\n')) {
        const head = buf.slice(0, buf.indexOf('\r\n\r\n'));
        const m = /^HTTP\/1\.[01] (\d{3})/.exec(head);
        socket.destroy();
        resolve({ status: m ? Number(m[1]) : 0, headers: head.toLowerCase(), raw: buf });
      }
    });
    socket.on('connect', () => {
      socket.write(lines.join('\r\n') + '\r\n\r\n');
    });
  });
}


test.describe('Gate 1.1 — transport authentication', () => {
  test('rejects every unauthenticated route in, and allows the legitimate one', async () => {
    const h = await setupHarness('gate-1-1-transport-auth');
    try {
      const base = h.backend.baseUrl;
      const token = h.backend.capabilityToken;

      // A path that returns real data and would be valuable to an attacker.
      // /api/fs/browse enumerates the filesystem; /api/file/content reads it.
      const target = `${base}/api/build-info`;

      // ── missing capability token ────────────────────────────────────
      {
        const res = await fetch(target);
        expect(res.status, 'a request with no token must be rejected').toBe(401);
        const body = await res.json();
        expect(body.error).toMatch(/capability token/i);
      }

      // ── incorrect capability token ──────────────────────────────────
      {
        const res = await fetch(target, {
          headers: { 'x-codetrellis-token': 'not-the-real-token-0000000000000' },
        });
        expect(res.status, 'a wrong token must be rejected').toBe(401);
      }

      // A token of the RIGHT LENGTH but wrong content — guards against a
      // comparison that only checks length, which timingSafeEqual requires
      // us to pre-check and is therefore easy to get wrong.
      {
        const wrongSameLength = 'f'.repeat(token.length);
        const res = await fetch(target, {
          headers: { 'x-codetrellis-token': wrongSameLength },
        });
        expect(res.status, 'a same-length wrong token must be rejected').toBe(401);
      }

      // ── the legitimate path still works ─────────────────────────────
      {
        const res = await fetch(target, { headers: { 'x-codetrellis-token': token } });
        expect(res.status, 'the correct token must be accepted').toBe(200);
      }

      // Authorization: Bearer is an equally valid way to present it — MCP
      // clients and CLIs reach for that shape first.
      {
        const res = await fetch(target, { headers: { Authorization: `Bearer ${token}` } });
        expect(res.status, 'Bearer form must be accepted').toBe(200);
      }

      // ── mismatched Host (DNS rebinding) ─────────────────────────────
      //
      // An attacker-controlled name that resolves to 127.0.0.1 makes the
      // request look same-origin to the browser. The socket really is
      // loopback, so only the Host header distinguishes it.
      {
        const res = await rawRequest(h.backend.backendPort, [
          'GET /api/build-info HTTP/1.1',
          'Host: evil.example.com',
          `x-codetrellis-token: ${token}`,
          'Connection: close',
        ]);
        expect(res.status, 'an unknown Host must be rejected even WITH a valid token').toBe(403);
      }

      // And the legitimate Host still works, so the check is not just
      // rejecting everything.
      {
        const res = await rawRequest(h.backend.backendPort, [
          'GET /api/build-info HTTP/1.1',
          `Host: 127.0.0.1:${h.backend.backendPort}`,
          `x-codetrellis-token: ${token}`,
          'Connection: close',
        ]);
        expect(res.status, 'the real Host must still be accepted').toBe(200);
      }

      // ── foreign Origin ──────────────────────────────────────────────
      //
      // Even holding a token, a foreign origin must not be granted read
      // access. The request may execute; what must not happen is the browser
      // being told it may expose the response.
      {
        const res = await fetch(target, {
          headers: { 'x-codetrellis-token': token, Origin: 'https://evil.example.com' },
        });
        expect(
          res.headers.get('access-control-allow-origin'),
          'a foreign origin must never be reflected in Access-Control-Allow-Origin',
        ).toBeNull();
      }

      // ── Origin: null ────────────────────────────────────────────────
      //
      // Sandboxed iframes and data: URLs send `Origin: null`. The old
      // middleware treated a missing origin as permission to send `*`.
      {
        const res = await fetch(target, {
          headers: { 'x-codetrellis-token': token, Origin: 'null' },
        });
        const acao = res.headers.get('access-control-allow-origin');
        expect(acao, 'Origin: null must not be reflected or wildcarded').toBeNull();
      }

      // ── no wildcard, ever ───────────────────────────────────────────
      {
        const res = await fetch(target, { headers: { 'x-codetrellis-token': token } });
        expect(
          res.headers.get('access-control-allow-origin'),
          'the API must never answer with a wildcard ACAO',
        ).not.toBe('*');
      }

      // ── preflight from a foreign origin ─────────────────────────────
      {
        const res = await fetch(target, {
          method: 'OPTIONS',
          headers: {
            Origin: 'https://evil.example.com',
            'Access-Control-Request-Method': 'GET',
          },
        });
        expect(res.status, 'preflight from a foreign origin must be refused').toBe(403);
      }

      // ── /api/health stays public ────────────────────────────────────
      //
      // Deliberately unauthenticated so supervisors and the harness can
      // detect readiness. It must not leak anything: assert it does not
      // start handing out paths or project data.
      {
        const res = await fetch(`${base}/api/health`);
        expect(res.status, '/api/health must remain reachable without a token').toBe(200);
        const text = await res.text();
        expect(text, '/api/health must not disclose filesystem paths').not.toMatch(/\/Users\/|\/home\/|C:\\\\/);
      }
    } finally {
      await h.teardown();
    }
  });

  test('WebSocket upgrades require the token', async () => {
    const h = await setupHarness('gate-1-1-websocket-auth');
    try {
      const port = h.backend.backendPort;
      const token = h.backend.capabilityToken;

      const upgradeHeaders = (path: string, extra: string[] = []) => [
        `GET ${path} HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        // The literal example key from RFC 6455 §1.3 — base64 of "the sample
        // nonce". A WebSocket handshake requires this header, and its value
        // is not a credential: the server echoes a hash of it back and never
        // uses it for authorisation. gitleaks' entropy heuristic reads any
        // base64 blob as a possible key, hence the inline allow.
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', // gitleaks:allow
        'Sec-WebSocket-Version: 13',
        ...extra,
      ];

      // ── the event socket, no token ──────────────────────────────────
      {
        const res = await rawRequest(port, upgradeHeaders('/ws'));
        expect(
          res.status,
          'an upgrade with no token must be refused, not silently dropped',
        ).toBe(401);
      }

      // ── the terminal socket, no token ───────────────────────────────
      //
      // This one carries live PTY I/O in both directions. It is the most
      // valuable socket in the app and was reachable without any credential.
      {
        const res = await rawRequest(port, upgradeHeaders('/terminal-ws?id=whatever'));
        expect(
          res.status,
          'the terminal socket must refuse an unauthenticated upgrade',
        ).toBe(401);
      }

      // ── wrong token ─────────────────────────────────────────────────
      {
        const res = await rawRequest(
          port,
          upgradeHeaders(`/ws?ct_token=${'f'.repeat(token.length)}`),
        );
        expect(res.status, 'a wrong token must not authenticate an upgrade').toBe(401);
      }

      // ── foreign origin, valid token ─────────────────────────────────
      //
      // WebSockets are NOT subject to the same-origin policy — a page can
      // open one to any host. So the Origin check is the only thing standing
      // between a malicious tab and this socket, and it has to hold even
      // when a token is somehow present.
      {
        const res = await rawRequest(
          port,
          upgradeHeaders(`/ws?ct_token=${encodeURIComponent(token)}`, [
            'Origin: https://evil.example.com',
          ]),
        );
        expect(res.status, 'a foreign Origin must be refused on upgrade').toBe(401);
      }

      // ── correct token, no origin (a CLI or the harness) ─────────────
      {
        const res = await rawRequest(
          port,
          upgradeHeaders(`/ws?ct_token=${encodeURIComponent(token)}`),
        );
        expect(
          res.status,
          'a valid token in the query string must complete the handshake',
        ).toBe(101);
      }
    } finally {
      await h.teardown();
    }
  });

  test('the MCP transport requires the token', async () => {
    const h = await setupHarness('gate-1-1-mcp-auth');
    try {
      const mcpPort = h.backend.mcpPort;
      const token = h.backend.capabilityToken;

      // The MCP surface includes TERMINAL EXECUTION. Before Gate 1.1 this
      // server answered with `Access-Control-Allow-Origin: *`, so a web page
      // could both drive those tools and read the results.

      // ── SSE stream, no token ────────────────────────────────────────
      {
        const res = await rawRequest(mcpPort, [
          'GET /sse HTTP/1.1',
          `Host: 127.0.0.1:${mcpPort}`,
          'Accept: text/event-stream',
          'Connection: close',
        ]);
        expect(res.status, 'an MCP connection with no token must be refused').toBe(401);
      }

      // ── message POST, no token ──────────────────────────────────────
      {
        const res = await rawRequest(mcpPort, [
          'POST /messages?sessionId=anything HTTP/1.1',
          `Host: 127.0.0.1:${mcpPort}`,
          'Content-Type: application/json',
          'Content-Length: 2',
          'Connection: close',
          '',
          '{}',
        ]);
        expect(res.status, 'an unauthenticated MCP message POST must be refused').toBe(401);
      }

      // ── wrong token ─────────────────────────────────────────────────
      {
        const res = await rawRequest(mcpPort, [
          `GET /sse?ct_token=${'f'.repeat(token.length)} HTTP/1.1`,
          `Host: 127.0.0.1:${mcpPort}`,
          'Accept: text/event-stream',
          'Connection: close',
        ]);
        expect(res.status, 'a wrong token must not open an MCP stream').toBe(401);
      }

      // ── mismatched Host ─────────────────────────────────────────────
      {
        const res = await rawRequest(mcpPort, [
          `GET /sse?ct_token=${encodeURIComponent(token)} HTTP/1.1`,
          'Host: evil.example.com',
          'Accept: text/event-stream',
          'Connection: close',
        ]);
        expect(res.status, 'MCP must reject an unknown Host even with a valid token').toBe(403);
      }

      // ── no wildcard CORS ────────────────────────────────────────────
      //
      // The regression that matters most: nothing here should ever answer
      // `Access-Control-Allow-Origin: *` again.
      {
        const res = await rawRequest(mcpPort, [
          'GET /health HTTP/1.1',
          `Host: 127.0.0.1:${mcpPort}`,
          'Connection: close',
        ]);
        expect(
          res.headers.includes('access-control-allow-origin: *'),
          'the MCP server must never answer with a wildcard ACAO',
        ).toBe(false);
      }

      // ── preflight is refused outright ───────────────────────────────
      //
      // Only a browser sends one, and no browser has business here.
      {
        const res = await rawRequest(mcpPort, [
          'OPTIONS /sse HTTP/1.1',
          `Host: 127.0.0.1:${mcpPort}`,
          'Origin: https://evil.example.com',
          'Access-Control-Request-Method: GET',
          'Connection: close',
        ]);
        expect(res.status, 'MCP preflight must be refused').toBe(403);
      }

      // ── and a real agent still works end to end ─────────────────────
      //
      // Proves the lock has a key: this spawns a scripted MCP client through
      // the harness, which authenticates exactly as a configured agent would.
      {
        const agent = await h.spawnAgent({ agentType: 'auth-probe' });
        const result = await agent.callTool('list_plans', {});
        expect(result.isError, 'an authenticated agent must still be able to call tools').not.toBe(true);
      }
    } finally {
      await h.teardown();
    }
  });
});
