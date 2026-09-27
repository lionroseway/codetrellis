import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { stripWorkstreams, chipLabel, shapeWords, sharedNote, shortFolder } from './workstream-strip';
import type { Workstream, WorkstreamAgent } from '../../shared/types';

const agent = (sessionId: string): WorkstreamAgent => ({ sessionId, agentType: 'claude-code', model: null, source: 'mcp', lastSeen: 0 });
function ws(root: string, main: boolean, agents: WorkstreamAgent[]): Workstream {
  return {
    root, branch: main ? 'main' : root.split('-').pop()!, head: 'abcdef1234', main,
    shape: agents.length >= 2 ? 'shared' : 'worktree', agents, idle: agents.length === 0,
  };
}

describe('stripWorkstreams', () => {
  test('nothing at all when no one is working', () => {
    assert.deepEqual(stripWorkstreams([ws('/r', true, []), ws('/r-auth', false, [])]), []);
  });

  test('one agent in the main checkout is left to ConnectedAgents', () => {
    assert.deepEqual(stripWorkstreams([ws('/r', true, [agent('a')]), ws('/r-auth', false, [])]), []);
  });

  test('one agent in a worktree gets a chip', () => {
    assert.deepEqual(stripWorkstreams([ws('/r', true, []), ws('/r-auth', false, [agent('a')])]).map((w) => w.root), ['/r-auth']);
  });

  test('two lines of work get two chips, idle ones none', () => {
    const shown = stripWorkstreams([ws('/r', true, [agent('a')]), ws('/r-auth', false, [agent('b')]), ws('/r-old', false, [])]);
    assert.deepEqual(shown.map((w) => w.root), ['/r', '/r-auth']);
  });

  test('agents sharing the main checkout get a chip, because that is worth knowing', () => {
    assert.deepEqual(stripWorkstreams([ws('/r', true, [agent('a'), agent('b')])]).map((w) => w.shape), ['shared']);
  });
});

describe('chip wording', () => {
  test('the branch, or the commit when detached', () => {
    assert.equal(chipLabel({ branch: 'auth-refresh', head: 'abc' }), 'auth-refresh');
    assert.equal(chipLabel({ branch: null, head: 'abcdef1234' }), 'detached abcdef1');
    assert.equal(chipLabel({ branch: null, head: null }), 'detached');
  });

  test('what kind of workstream, and the shared warning', () => {
    assert.equal(shapeWords(ws('/r', true, [agent('a')])), 'Main checkout');
    assert.equal(shapeWords(ws('/r-auth', false, [agent('a')])), 'Worktree');
    assert.equal(shapeWords(ws('/r', true, [agent('a'), agent('b')])), 'Main checkout, shared by 2 agents');
    assert.equal(sharedNote(ws('/r-auth', false, [agent('a')])), null);
    assert.match(sharedNote(ws('/r', true, [agent('a'), agent('b')]))!, /worktree of its own/);
  });
});

describe('shortFolder', () => {
  test('keeps the end, where worktrees differ', () => {
    assert.equal(shortFolder('/work/acme-auth'), '/work/acme-auth');
    const long = '/Users/someone/Workspaces/clients/acme/payments-platform-auth-refresh';
    const short = shortFolder(long, 30);
    assert.equal(short.length, 30);
    assert.ok(short.startsWith('…') && short.endsWith('payments-platform-auth-refresh'.slice(-29)));
  });
});
