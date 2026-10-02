/**
 * A branch review finds the dependencies nobody planned (Phase 32 A5.1).
 *
 * billing-v2 is a line of work with no checkout of its own open here: its
 * agent committed a new file that imports the web app's API client. The plan
 * asked for the file and did not plan that dependency. Reviewing the branch
 * against main used to report the file and nothing else, because a `commit:`
 * side carried files but no edges. Now each side's edges are built (the
 * graph's own for what is unchanged, a parse at the commit for the rest), so
 * the review names the dependency, and the picker offers the branch by name.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, type Harness } from '../harness';

const EXTRA = 'packages/web/src/Extra.ts';
const API = 'packages/web/src/api.ts';
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

interface Comparand { spec: string; label: string; kind: string }
interface Review {
  unclaimedChanges: string[];
  unplannedEdges: Array<{ source: string; target: string }>;
  summary: { unplannedEdgeCount: number };
}

test.describe.serial('A branch review finds the dependencies nobody planned', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let billing: string;
  let main: string;
  let planUid: string;

  test.beforeAll(async () => {
    h = await setupHarness('review-commit-edges-branch');
    root = h.fixture.projectPath;
    billing = `${root}-billing`;
    main = execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf-8' }).trim();
    execFileSync('git', ['-C', root, 'worktree', 'add', '-q', billing, '-b', 'billing-v2'], { env: ENV });
    fs.writeFileSync(path.join(billing, EXTRA), "import { listUsers } from './api';\nexport const extra = listUsers;\n");
    execFileSync('git', ['-C', billing, 'add', '-A'], { env: ENV });
    execFileSync('git', ['-C', billing, 'commit', '-q', '-m', 'billing: an extra view'], { env: ENV });
    await h.client.scanProject(root);

    const plan = await h.client.createPlan({ title: 'Billing extras', projectPath: root, tasks: [] });
    planUid = plan.uid;
    const agent = await h.spawnAgent({ agentType: 'harness-review' });
    const added = await agent.callTool('add_item', {
      plan_uid: planUid, kind: 'action', title: 'Add the extra view',
      file_specs: [{ path: EXTRA, action: 'create' }],
    });
    expect(added.isError, added.text).toBeFalsy();
  });

  test.afterAll(async () => {
    try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', billing]); } catch { /* */ }
    await h?.teardown();
  });

  test('the picker offers the line of work by its branch', async () => {
    const comparands = (await (await h.client.raw('GET', `/api/comparands?project=${encodeURIComponent(root)}`)).json()) as Comparand[];
    expect(comparands).toContainEqual({ spec: 'commit:billing-v2', label: 'billing-v2 (line of work)', kind: 'branch' });
  });

  test('reviewing the branch against main names the file and the dependency nobody planned', async () => {
    const review = (await (await h.client.raw(
      'GET',
      `/api/plans/${planUid}/review?project=${encodeURIComponent(root)}&before=${encodeURIComponent(`commit:${main}`)}&after=${encodeURIComponent('commit:billing-v2')}`,
    )).json()) as Review;
    expect(review.unclaimedChanges).toEqual([]);
    expect(review.unplannedEdges).toEqual([{ source: EXTRA, target: API }]);
    expect(review.summary.unplannedEdgeCount).toBe(1);
  });

  test('the markdown an agent posts says so too', async () => {
    const agent = await h.spawnAgent({ agentType: 'harness-review' });
    const md = await agent.callTool('review_plan', { plan_uid: planUid, project_path: root, before: `commit:${main}`, after: 'commit:billing-v2', format: 'markdown' });
    expect(md.isError, md.text).toBeFalsy();
    expect(md.text).toContain('New dependencies nobody planned');
    expect(md.text).toContain(`${EXTRA}`);
    expect(md.text).not.toContain('Edges were not compared');
  });
});
