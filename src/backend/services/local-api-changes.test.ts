/**
 * Changes over the local API can be turned off (Phase 32, carried item 2b).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { refusesLocalApiChange, LOCAL_API_CHANGES_REFUSAL } from './local-api-changes';
import { grantChange } from './grant-guard';
import { DEFAULT_SETTINGS } from '../../shared/types';

const http = (method: string, path = '/api/plans') => ({ method, path, fromAppWindow: false });

describe('refusesLocalApiChange', () => {
  test('on by default: nothing is refused when the setting is absent or true', () => {
    for (const accept of [undefined, true]) assert.equal(refusesLocalApiChange(http('POST'), accept), false);
  });

  test('off: every change over plain HTTP is refused, whatever the method', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'post']) assert.equal(refusesLocalApiChange(http(m), false), true, m);
  });

  test('off: reading still works, and the app window still changes anything', () => {
    for (const m of ['GET', 'HEAD', 'OPTIONS']) assert.equal(refusesLocalApiChange(http(m), false), false, m);
    assert.equal(refusesLocalApiChange({ method: 'POST', path: '/api/plans', fromAppWindow: true }, false), false);
  });

  test('only the API: other paths are not this rule\'s', () => {
    assert.equal(refusesLocalApiChange(http('POST', '/health'), false), false);
  });

  test('a test backend keeps the settings route reachable so a harness can turn changes back on', () => {
    assert.equal(refusesLocalApiChange(http('PUT', '/api/settings'), false, true), false);
    assert.equal(refusesLocalApiChange(http('PUT', '/api/settings'), false, false), true, 'never on a real backend');
    assert.equal(refusesLocalApiChange(http('POST', '/api/plans'), false, true), true);
  });

  test('the refusal says where to turn changes back on', () => {
    assert.match(LOCAL_API_CHANGES_REFUSAL, /Settings → MCP Server → Local API/);
  });
});

describe('the setting is a grant', () => {
  test('flipping it either way is a change only the app window may make', () => {
    assert.deepEqual(grantChange({ mcp: { acceptLocalApiChanges: false } }, DEFAULT_SETTINGS),
      { field: 'mcp.acceptLocalApiChanges', where: 'Settings → MCP Server → Local API' });
    const off = { ...DEFAULT_SETTINGS, mcp: { ...DEFAULT_SETTINGS.mcp, acceptLocalApiChanges: false } };
    assert.equal(grantChange({ mcp: { acceptLocalApiChanges: true } }, off)?.field, 'mcp.acceptLocalApiChanges');
  });

  test('saving the section unchanged is not a grant', () => {
    const off = { ...DEFAULT_SETTINGS, mcp: { ...DEFAULT_SETTINGS.mcp, acceptLocalApiChanges: false } };
    assert.equal(grantChange({ mcp: { ...off.mcp } }, off), null);
  });
});
