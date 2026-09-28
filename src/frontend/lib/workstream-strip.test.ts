import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { stripWorkstreams, chipLabel, shapeWords, sharedNote, shortFolder, changeWords, statusLetter, symbolSummary } from './workstream-strip';
import type { Workstream, WorkstreamAgent } from '../../shared/types';

const agent = (sessionId: string): WorkstreamAgent => ({ sessionId, agentType: 'claude-code', model: null, source: 'mcp', lastSeen: 0 });
function ws(root: string, main: boolean, agents: WorkstreamAgent[], changed = 0): Workstream {
  const files = Array.from({ length: changed }, (_, i) => ({ path: `src/f${i}.ts`, status: 'modified' as const }));
  return {
    root, branch: main ? 'main' : root.split('-').pop()!, head: 'abcdef1234', main,
    shape: agents.length >= 2 ? 'shared' : 'worktree', agents, changes: { base: 'abc', files, truncated: false },
    idle: agents.length === 0 && changed === 0,
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

describe('changes on the strip (A1.4)', () => {
  test('a worktree left with changes and no agent gets a chip', () => {
    assert.deepEqual(stripWorkstreams([ws('/r', true, [agent('a')]), ws('/r-old', false, [], 3)]).map((w) => w.root), ['/r', '/r-old']);
  });

  test("the main checkout's own uncommitted work, with no agent, gets none", () => {
    assert.deepEqual(stripWorkstreams([ws('/r', true, [], 4)]), []);
    assert.deepEqual(stripWorkstreams([ws('/r', true, [], 4), ws('/r-auth', false, [agent('a')])]).map((w) => w.root), ['/r-auth']);
  });

  test('how the count reads', () => {
    assert.equal(changeWords(ws('/r-a', false, [agent('a')])), null);
    assert.equal(changeWords(ws('/r-a', false, [agent('a')], 1)), '1 file changed');
    assert.equal(changeWords(ws('/r-a', false, [agent('a')], 3)), '3 files changed');
    assert.equal(changeWords({ changes: { base: 'x', files: [{ path: 'a', status: 'added' }], truncated: true } }), '1+ files changed');
    assert.deepEqual((['added', 'modified', 'deleted', 'renamed'] as const).map(statusLetter), ['A', 'M', 'D', 'R']);
  });
});

describe('symbolSummary (A1.5)', () => {
  const sym = (name: string, change: 'added' | 'removed' | 'modified', line: number) => ({ name, kind: 'function' as const, change, line });

  test('modified first, where collisions are; then added, then removed', () => {
    assert.equal(
      symbolSummary([sym('gone', 'removed', 1), sym('refresh', 'added', 9), sym('Session.renew', 'modified', 4)]),
      '~Session.renew  +refresh  −gone',
    );
  });

  test('capped, with the rest counted', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((n, i) => sym(n, 'modified', i));
    assert.equal(symbolSummary(many), '~a  ~b  ~c  +2 more');
  });

  test('nothing to say when unparsed or no symbol moved', () => {
    assert.equal(symbolSummary(undefined), null);
    assert.equal(symbolSummary([]), null);
  });
});
