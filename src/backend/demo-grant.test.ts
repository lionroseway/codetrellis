/**
 * The demo's `--grant` (scripts/demo/grant.ts): it adds to what MCP clients
 * already hold, never takes anything away, and refuses a name that is not a
 * capability rather than sending it for the backend to reject.
 *
 * Whether a grant is accepted at all is the backend's decision
 * (services/grant-guard.ts, tests/e2e/grant-guard.test.ts), not this helper's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withGrants } from '../../scripts/demo/grant';
import { parseOptions } from '../../scripts/demo/options';
import { DEFAULT_GRANTS } from './services/peer-capabilities';

test('a grant starts from the defaults when nothing is set', () => {
  assert.deepEqual(withGrants(undefined, ['terminal']), [...DEFAULT_GRANTS, 'terminal']);
});

test('a grant adds to what is held and keeps it', () => {
  assert.deepEqual(withGrants(['read', 'capture'], ['terminal', 'read']), ['read', 'capture', 'terminal']);
});

test('nothing to add leaves the grants as they were', () => {
  assert.deepEqual(withGrants(['read', 'write'], []), ['read', 'write']);
});

test('a name that is not a capability is refused, naming the ones that are', () => {
  assert.throws(() => withGrants(undefined, ['shell']), /Not a capability: shell\. Known: read, write/);
});

test('--grant parses to a list, and is absent when not given', () => {
  assert.deepEqual(parseOptions(['--grant=terminal, capture'], '/repo').grant, ['terminal', 'capture']);
  assert.equal(parseOptions([], '/repo').grant, undefined);
});
