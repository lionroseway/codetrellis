/**
 * Phase 33 follow-up — at most MAX_WATCHED_TREES working trees are watched.
 *
 * A checkout with fifty worktrees, each active against an old main, kept a
 * watcher on every one, and the backend served slowly for as long as they
 * ran. The trees worth watching come first: those with agents in them, then
 * the main checkout and the project opened; the rest are read again when
 * asked.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_WATCHED_TREES, treesToWatch } from './workstream-service';

const agent = { sessionId: 's', agentType: 'claude-code', model: null, source: 'mcp' as const, lastSeen: null };
const tree = (root: string, extra: { idle?: boolean; main?: boolean; agents?: number } = {}) => ({
  root, idle: extra.idle ?? false, main: extra.main ?? false, agents: Array.from({ length: extra.agents ?? 0 }, () => agent),
});

test('idle trees are never watched; the rest are, while they fit', () => {
  assert.deepEqual(treesToWatch([tree('/a'), tree('/b', { idle: true }), tree('/c')], '/a'), ['/a', '/c']);
});

test('past the cap, trees with agents come first (more agents first), then the main checkout and the project, then the rest as listed', () => {
  const all = [
    tree('/w1'), tree('/w2'), tree('/project'), tree('/w3', { agents: 1 }), tree('/main', { main: true }),
    tree('/w4', { agents: 2 }), tree('/w5'), tree('/idle', { idle: true, agents: 0 }),
  ];
  assert.deepEqual(treesToWatch(all, '/project', 4), ['/w4', '/w3', '/project', '/main']);
  assert.deepEqual(treesToWatch(all, '/project', 6), ['/w4', '/w3', '/project', '/main', '/w1', '/w2']);
});

test('fifty active worktrees: sixteen watched, every one with an agent among them', () => {
  const all = Array.from({ length: 50 }, (_, i) => tree(`/wt${i}`, { agents: i % 10 === 9 ? 1 : 0 }));
  const watched = treesToWatch(all, '/wt0');
  assert.equal(MAX_WATCHED_TREES, 16);
  assert.equal(watched.length, 16);
  for (const w of all.filter((x) => x.agents.length)) assert.ok(watched.includes(w.root), w.root);
  assert.ok(watched.includes('/wt0'), 'the project opened');
});
