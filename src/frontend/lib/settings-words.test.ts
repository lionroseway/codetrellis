/**
 * A refused setting, as the settings modal words it (Phase 32 §0.5).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainSaveError } from './settings-words';

test('a refused field is named as a person reads it, not by its key', () => {
  assert.equal(explainSaveError('mcp.port must be a port from 1024 to 65535'), 'The MCP port must be a number from 1024 to 65535');
  assert.equal(explainSaveError('device.mobileApiPort must be a port from 1024 to 65535'), 'The mobile API port must be a number from 1024 to 65535');
  assert.equal(explainSaveError('identity.email must be text'), 'The email must be text');
});

test('anything else is shown as the API said it', () => {
  // The grant guard already speaks to a person.
  const grant = 'Only you can change which projects agents can reach — in the CodeTrellis app, Settings → MCP Server.';
  assert.equal(explainSaveError(grant), grant);
  assert.equal(explainSaveError('power.triggers.always must be true or false'), 'power.triggers.always must be true or false');
});
