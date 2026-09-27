/**
 * What counts as granting (owner's decision, Phase 32). Only a CHANGE to a
 * grant does: the Settings window saves whole sections, so an unchanged grant
 * riding along must not be refused, and a changed one must be.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grantChange, httpGrantsAllowed, grantRefusal } from './grant-guard';
import { DEFAULT_SETTINGS } from '../../shared/types';

const current = { ...DEFAULT_SETTINGS, mcp: { ...DEFAULT_SETTINGS.mcp, capabilities: ['read', 'write'] as any } };

test('a changed grant is named, with where the person changes it', () => {
  assert.deepEqual(grantChange({ mcp: { capabilities: ['read', 'write', 'terminal'] } }, current), { field: 'mcp.capabilities', where: 'Settings → MCP Server' });
  assert.deepEqual(grantChange({ device: { exposeMobileApi: true } }, current), { field: 'device.exposeMobileApi', where: 'Settings → Devices' });
  assert.deepEqual(grantChange({ webhooks: { allowedHosts: ['hooks.example.com'] } }, current)?.field, 'webhooks.allowedHosts');
  assert.deepEqual(grantChange({ mcp: { projectScope: 'anywhere' } }, current)?.field, 'mcp.projectScope');
});

test('an unchanged grant riding along with another field is not a grant', () => {
  assert.equal(grantChange({ mcp: { ...current.mcp, autodetectOnCollision: false } }, current), null);
  assert.equal(grantChange({ device: { ...current.device, deviceName: 'Dana laptop' } }, current), null);
  assert.equal(grantChange({ webhooks: { allowedHosts: [] } }, current), null);
  assert.equal(grantChange({ identity: { displayName: 'Dana' } }, current), null);
  assert.equal(grantChange(null, current), null);
});

test('over HTTP only on a test backend that asks for it', () => {
  const saved = { env: process.env.NODE_ENV, allow: process.env.CODETRELLIS_ALLOW_HTTP_GRANTS };
  try {
    process.env.NODE_ENV = 'production'; process.env.CODETRELLIS_ALLOW_HTTP_GRANTS = '1';
    assert.equal(httpGrantsAllowed(), false, 'never in production, whatever the flag');
    process.env.NODE_ENV = 'test'; delete process.env.CODETRELLIS_ALLOW_HTTP_GRANTS;
    assert.equal(httpGrantsAllowed(), false);
    process.env.CODETRELLIS_ALLOW_HTTP_GRANTS = '1';
    assert.equal(httpGrantsAllowed(), true);
  } finally {
    process.env.NODE_ENV = saved.env;
    if (saved.allow === undefined) delete process.env.CODETRELLIS_ALLOW_HTTP_GRANTS; else process.env.CODETRELLIS_ALLOW_HTTP_GRANTS = saved.allow;
  }
});

test('the refusal says where', () => {
  assert.equal(grantRefusal('mcp.capabilities', 'Settings → MCP Server'), 'Only you can change mcp.capabilities — in the CodeTrellis app, Settings → MCP Server.');
});
