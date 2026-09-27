/**
 * The app window's requests are told apart by identity (Phase 32 §0.4d).
 *
 * A criterion decision is a person's when it arrives over the app window's
 * IPC and `unverified` when it arrives over plain HTTP, because the token
 * alone cannot tell a person from a script that read it. This checks the
 * mark behaves: set by the authorised (app-window) dispatch, not by plain
 * dispatch, not by anything a caller can put in the request.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { dispatch, dispatchAuthorised, cameFromAppWindow } from './ipc-dispatcher';

// The authorised dispatch mints the token on first use; keep it out of the real data dir.
process.env.CODETRELLIS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ipc-'));

const app = express();
app.use(express.json());
app.all('/api/who', (req, res) => { res.json({ appWindow: cameFromAppWindow(req) }); });

const who = async (r: Promise<{ status: number; body: string }>) => {
  const res = await r;
  assert.equal(res.status, 200);
  return JSON.parse(res.body).appWindow as boolean;
};

test('a request from the app window is marked', async () => {
  assert.equal(await who(dispatchAuthorised(app, { method: 'GET', url: '/api/who' })), true);
  assert.equal(await who(dispatchAuthorised(app, { method: 'POST', url: '/api/who', body: '{"x":1}' })), true);
});

test('plain dispatch is not, and nothing in the request can make it so', async () => {
  assert.equal(await who(dispatch(app, { method: 'GET', url: '/api/who' })), false);
  assert.equal(await who(dispatch(app, {
    method: 'POST', url: '/api/who',
    headers: { 'x-codetrellis-app-window': '1', 'x-from-app-window': 'true' },
    body: JSON.stringify({ appWindow: true, fromAppWindow: true }),
  })), false);
});

test('an object that is not a dispatched request is not marked', () => {
  assert.equal(cameFromAppWindow({}), false);
  assert.equal(cameFromAppWindow({ appWindow: true }), false);
});
