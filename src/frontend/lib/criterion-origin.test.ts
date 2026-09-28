/**
 * A criterion says who added it (§0.4d): an agent's line is tagged with
 * the agent's name; a person's and the system's are not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criterionOrigin } from './criterion-origin';

test('an agent\'s criterion is tagged with its name', () => {
  assert.equal(criterionOrigin({ author: 'codex-cli', authorType: 'mcp' }), 'added by codex-cli (agent)');
  assert.equal(criterionOrigin({ author: 'claude-code', authorType: 'claude-code' }), 'added by claude-code (agent)');
});

test('a person\'s and the system\'s are not; the rest say where they came from', () => {
  assert.equal(criterionOrigin({ author: 'saif@example.com', authorType: 'human' }), null);
  assert.equal(criterionOrigin({ author: 'migration', authorType: 'system' }), null);
  assert.equal(criterionOrigin({ author: 'gate', authorType: 'system', source: 'gate' }), null);
  assert.equal(criterionOrigin({ author: 'saif@example.com', authorType: 'unverified' }), 'added by saif@example.com');
  assert.equal(criterionOrigin({ author: 'template:board-pack', authorType: 'template' }), 'from a template');
  assert.equal(criterionOrigin({ author: 'x', authorType: 'file-import' }), 'from the plan file');
});
