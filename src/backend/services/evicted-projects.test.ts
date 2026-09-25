/**
 * Eviction from Recent Projects withdraws trust — and now says so.
 *
 * Trust is the active project plus `recent_projects`, which keeps only the
 * most recent unpinned entries. Opening enough other projects dropped one
 * off, and the next MCP call naming it was refused with "Open it first" —
 * wrong advice for someone who had. The browser suite hit exactly this
 * part-way through a run.
 *
 * What must NOT change is the refusal itself: the eviction record explains,
 * it never grants.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-evicted-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });

let db: typeof import('./database');
let recent: typeof import('./recent-projects-service');
let roots: typeof import('./trusted-roots');
let caps: typeof import('./mcp-capabilities');

function project(name: string): string {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

before(async () => {
  db = await import('./database');
  await db.initDatabase();
  recent = await import('./recent-projects-service');
  roots = await import('./trusted-roots');
  caps = await import('./mcp-capabilities');
  roots.setActiveProjectRoot(null);
});

describe('a project pushed off Recent Projects', () => {
  let first: string;

  before(() => {
    first = project('first');
    recent.recordProjectOpen(first);
    // Opens in one test land in the same millisecond, and a tie leaves the
    // eviction order to SQLite. Make `first` unambiguously the oldest.
    db.getDb().run(`UPDATE recent_projects SET last_opened_at = last_opened_at - 60000 WHERE path = ?`, [first]);
    for (let i = 0; i < recent.MAX_RECENT_UNPINNED; i++) recent.recordProjectOpen(project(`later-${i}`));
  });

  test('is no longer trusted — the record explains, it never grants', () => {
    assert.ok(!recent.listRecentProjects().some((p) => p.path === first), 'precondition: evicted');
    assert.equal(roots.isTrustedProjectRoot(first), false);
    assert.throws(() => roots.resolveTrustedProjectRoot(first), /dropped off Recent Projects/);
  });

  test('the MCP refusal says what happened instead of "Open it first"', () => {
    assert.throws(
      () => caps.assertMcpProjectInScope('create_plan', { project_path: first }, 'opened'),
      (err: Error) =>
        /not open/.test(err.message) &&
        /dropped off Recent Projects/.test(err.message) &&
        /pin it/.test(err.message) &&
        !/Open it first/.test(err.message),
    );
  });

  test('a project that was never opened keeps the original wording', () => {
    const stranger = project('never-opened');
    assert.throws(
      () => caps.assertMcpProjectInScope('create_plan', { project_path: stranger }, 'opened'),
      (err: Error) => /Open it first/.test(err.message) && !/dropped off/.test(err.message),
    );
  });

  test('opening it again restores trust and clears the record', () => {
    recent.recordProjectOpen(first);
    assert.equal(roots.isTrustedProjectRoot(first), true);
    assert.ok(!recent.listEvictedProjects().some((e) => e.path === first));
  });
});
