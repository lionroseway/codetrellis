import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorKind, authorWithSource, versionAuthorType } from './author-words';

test('the person, the unverified local API and an agent are three different things', () => {
  assert.equal(authorKind('human'), 'person');
  assert.equal(authorKind(undefined), 'person');
  assert.equal(authorKind('unverified'), 'unverified');
  assert.equal(authorKind('claude-code'), 'agent');
  assert.equal(authorKind('mcp'), 'agent');
});

test('an unverified write says so beside the name; a person or agent shows just the name', () => {
  assert.equal(authorWithSource('dana@example.com', 'unverified'), 'dana@example.com (local API, unverified)');
  assert.equal(authorWithSource('dana@example.com', 'human'), 'dana@example.com');
  assert.equal(authorWithSource('claude-code', 'mcp'), 'claude-code');
});

test('a version is by the type it recorded; an older one without a type is an agent only if it says "agent" (carried 2b)', () => {
  assert.equal(versionAuthorType({ author: 'saif@example.com', authorType: 'unverified' }), 'unverified');
  assert.equal(versionAuthorType({ author: 'claude-code', authorType: 'mcp' }), 'mcp');
  assert.equal(versionAuthorType({ author: 'agent', authorType: null }), 'mcp');
  assert.equal(versionAuthorType({ author: 'saif@example.com', authorType: null }), 'human');
  // Before, the history compared the name to "human", so every person's edit showed a robot.
  assert.equal(authorKind(versionAuthorType({ author: 'saif@example.com' })), 'person');
});
