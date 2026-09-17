/**
 * The packaged desktop talks to its backend over IPC, and that path must be
 * authorised.
 *
 * WHAT THIS EXISTS TO CATCH
 *
 * Gate 1.1 put a capability-token check in front of every route. The packaged
 * renderer reaches those routes through `ipc-dispatcher`, which runs the
 * request through EVERY middleware — and the renderer has no token to supply.
 * So every `/api/*` call returned 401, the renderer received `{error: …}`
 * where it expected data, and the first deep property read threw. The window
 * was blank.
 *
 * NOTHING CAUGHT IT:
 *
 *   - dev mode works, because the Vite proxy attaches the token;
 *   - the harness works, because it speaks HTTP and holds the token;
 *   - CI builds the WEB bundle and runs under Node, never Electron;
 *   - even a packaged boot looked healthy — the backend logs "Backend
 *     initialised" and the failure is entirely in the renderer.
 *
 * It was found by launching the packaged app and LOOKING at the window. This
 * test is the cheap version of that.
 */

import { test, expect } from '@playwright/test';
import express from 'express';
import { dispatch, dispatchAuthorised } from '../../src/backend/services/ipc-dispatcher';
import { localAuthMiddleware } from '../../src/backend/middleware/local-auth';
import { initCapabilityToken } from '../../src/backend/services/capability-token';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** A minimal app wearing the same auth middleware the real one does. */
function appWithAuth() {
  const app = express();
  app.use(localAuthMiddleware);
  app.get('/api/settings/first-run-check', (_req, res) => {
    // The shape the renderer actually dereferences. If this route is never
    // reached, the renderer gets an error object instead and throws on
    // `check.identity.displayName` — which is exactly what happened.
    res.json({ firstRunComplete: true, identity: { displayName: 'x', email: 'y' }, gitDefaults: {} });
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  return app;
}

test.describe('the packaged renderer can reach its own backend', () => {
  test.beforeAll(() => {
    // The token is minted into the data dir; give it a scratch one.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-dispatch-'));
    process.env.CODETRELLIS_DATA_DIR = dir;
    initCapabilityToken();
  });

  test('an UNAUTHORISED dispatch is refused — the bug, reproduced', async () => {
    // This is what `ipcMain.handle('codetrellis:api')` used to do.
    const res = await dispatch(appWithAuth(), {
      method: 'GET',
      url: '/api/settings/first-run-check',
    });

    expect(res.status, 'a bare IPC dispatch has no token, so the middleware refuses it').toBe(401);

    // And this is why it surfaced as a TypeError rather than an error message:
    // the body parses, but the shape the renderer expects is not there.
    const body = JSON.parse(res.body);
    expect(body.identity, 'the renderer then reads .identity.displayName off undefined').toBeUndefined();
  });

  test('dispatchAuthorised reaches the route', async () => {
    const res = await dispatchAuthorised(appWithAuth(), {
      method: 'GET',
      url: '/api/settings/first-run-check',
    });

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.identity.displayName, 'the exact read that threw in the packaged app').toBe('x');
  });

  test('a caller cannot override the token with a wrong one', async () => {
    // The header is attached LAST for this reason. A renderer that guessed the
    // header name must not be able to downgrade its own request.
    const res = await dispatchAuthorised(appWithAuth(), {
      method: 'GET',
      url: '/api/settings/first-run-check',
      headers: { 'x-codetrellis-token': 'not-the-token' },
    });
    expect(res.status).toBe(200);
  });

  test('the public path still needs no token', async () => {
    const res = await dispatch(appWithAuth(), { method: 'GET', url: '/api/health' });
    expect(res.status, 'liveness must not depend on the token').toBe(200);
  });
});
