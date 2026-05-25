/**
 * CDev Phase 7 — external contributors tests.
 *
 * Four scenarios:
 *
 *   1. Pantry resolution — create items with attachment references,
 *      verify resolve_pantry_references distinguishes local from
 *      missing files.
 *
 *   2. Promote to contribution — create a plan, add items, promote
 *      one to the contributions staging area, verify list_contributions.
 *
 *   3. Accept contributions — promote items, then accept them into
 *      a plan, verify they appear in the manifest.
 *
 *   4. Prepare contributor branch — create a plan with shared + local
 *      items, prepare a filtered branch, verify only shared items appear.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { setupHarness } from '../harness';

test.describe('CDev Phase 7 — external contributors', () => {
  test.setTimeout(120_000);

  test('pantry resolution resolves existing files and flags missing ones', async () => {
    const h = await setupHarness('cdev-phase7-pantry');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'claude-code', model: 'opus-4-7' });

      // Create a file that exists
      const attDir = path.join(h.fixture.projectPath, '.codetrellis', 'attachments', 'test-item');
      fs.mkdirSync(attDir, { recursive: true });
      fs.writeFileSync(path.join(attDir, 'screenshot.png'), 'fake-png-data');

      // Resolve references: one that exists, one that doesn't, one URL
      const res = await agent.callTool('resolve_pantry_references', {
        project_path: h.fixture.projectPath,
        references: [
          '.codetrellis/attachments/test-item/screenshot.png',
          '.codetrellis/attachments/missing-item/diagram.svg',
          'https://example.com/image.png',
          'userdata://attachments/private/transcript.md',
        ],
      });
      expect(res.isError).not.toBe(true);
      const result = JSON.parse(res.text);

      expect(result.total).toBe(4);
      expect(result.resolved).toBe(2); // existing file + URL
      expect(result.external).toBe(2); // missing file + userdata

      // Check individual results
      const existing = result.results.find((r: any) =>
        r.reference === '.codetrellis/attachments/test-item/screenshot.png',
      );
      expect(existing.status).toBe('resolved');

      const missing = result.results.find((r: any) =>
        r.reference === '.codetrellis/attachments/missing-item/diagram.svg',
      );
      expect(missing.status).toBe('external');

      const url = result.results.find((r: any) =>
        r.reference === 'https://example.com/image.png',
      );
      expect(url.status).toBe('resolved');

      const userdata = result.results.find((r: any) =>
        r.reference === 'userdata://attachments/private/transcript.md',
      );
      expect(userdata.status).toBe('external');

      // Also verify via REST endpoint
      const restRes = await h.client.raw('GET',
        `/api/pantry/resolve?project=${encodeURIComponent(h.fixture.projectPath)}&refs=${encodeURIComponent('.codetrellis/attachments/test-item/screenshot.png')}&refs=${encodeURIComponent('.codetrellis/attachments/missing-item/nope.png')}`,
      );
      expect(restRes.ok).toBe(true);
      const restData = await restRes.json() as { total: number; results: any[] };
      expect(restData.total).toBe(2);
    } finally {
      await h.teardown();
    }
  });

  test('promote and list contributions round-trip via MCP', async () => {
    const h = await setupHarness('cdev-phase7-promote');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'claude-code', model: 'opus-4-7' });

      // Promote an item
      const promoRes = await agent.callTool('promote_to_contribution', {
        project_path: h.fixture.projectPath,
        item_uid: 'contrib-item-001',
        title: 'Architecture diagram',
        kind: 'object',
        status: 'pending',
        body: 'High-level system diagram for the auth module.',
        description: 'Architecture contribution from contractor.',
      });
      expect(promoRes.isError).not.toBe(true);
      const promo = JSON.parse(promoRes.text);
      expect(promo.contribution.kind).toBe('item');
      expect(promo.contribution.title).toBe('Architecture diagram');

      // Promote a second item
      const promo2Res = await agent.callTool('promote_to_contribution', {
        project_path: h.fixture.projectPath,
        item_uid: 'contrib-item-002',
        title: 'API spec draft',
        kind: 'object',
        body: 'Draft OpenAPI spec for endpoints.',
      });
      expect(promo2Res.isError).not.toBe(true);

      // List contributions
      const listRes = await agent.callTool('list_contributions', {
        project_path: h.fixture.projectPath,
      });
      expect(listRes.isError).not.toBe(true);
      const list = JSON.parse(listRes.text);
      expect(list.total).toBe(2);
      expect(list.items[0].title).toBe('Architecture diagram');
      expect(list.items[1].title).toBe('API spec draft');

      // Verify the staging files exist on disk
      const contribDir = path.join(h.fixture.projectPath, '.codetrellis', 'contributions');
      expect(fs.existsSync(contribDir)).toBe(true);

      // Also verify via REST
      const restRes = await h.client.raw('GET',
        `/api/contributions?project=${encodeURIComponent(h.fixture.projectPath)}`,
      );
      expect(restRes.ok).toBe(true);
      const restData = await restRes.json() as { total: number };
      expect(restData.total).toBe(2);
    } finally {
      await h.teardown();
    }
  });

  test('accept contributions moves items into plan manifest', async () => {
    const h = await setupHarness('cdev-phase7-accept');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'claude-code', model: 'opus-4-7' });

      // Create a plan to accept contributions into
      const planRes = await agent.callTool('create_plan', {
        title: 'Accept test plan',
        description: 'Tests contribution acceptance.',
        project_path: h.fixture.projectPath,
      });
      const plan = JSON.parse(planRes.text);
      expect(plan.uid).toBeTruthy();

      // Export the plan to create the directory structure
      await agent.callTool('export_plan_to_files', {
        plan_uid: plan.uid,
        project_root: h.fixture.projectPath,
      });

      // Derive plan slug
      const slugTitle = 'accept-test-plan';
      const slugUid = plan.uid.split('-')[0];
      const planSlug = `${slugTitle}-${slugUid}`;

      // Promote items (simulate contributor work)
      await agent.callTool('promote_to_contribution', {
        project_path: h.fixture.projectPath,
        item_uid: 'contrib-accept-001',
        title: 'Contributed design doc',
        kind: 'object',
        body: 'Design document contributed by external contractor.',
      });

      await agent.callTool('promote_to_contribution', {
        project_path: h.fixture.projectPath,
        item_uid: 'contrib-accept-002',
        title: 'Contributed test plan',
        kind: 'action',
        status: 'pending',
      });

      // Get the current branch name for acceptance
      const listRes = await agent.callTool('list_contributions', {
        project_path: h.fixture.projectPath,
      });
      const list = JSON.parse(listRes.text);
      const branch = list.branch;
      expect(branch).toBeTruthy();

      // Accept contributions
      const acceptRes = await agent.callTool('accept_contributions', {
        project_path: h.fixture.projectPath,
        branch,
        plan_slug: planSlug,
      });
      expect(acceptRes.isError).not.toBe(true);
      const accept = JSON.parse(acceptRes.text);
      expect(accept.accepted).toBe(2);
      expect(accept.errors).toEqual([]);

      // Verify items now exist in the plan items directory
      const itemsDir = path.join(h.fixture.projectPath, '.codetrellis', 'plans', planSlug, 'items');
      const itemFiles = fs.readdirSync(itemsDir).filter((f) => f.endsWith('.yaml'));
      expect(itemFiles.length).toBeGreaterThanOrEqual(2);

      // Verify contributions staging was cleaned up
      const contribDir = path.join(h.fixture.projectPath, '.codetrellis', 'contributions', branch);
      expect(fs.existsSync(contribDir)).toBe(false);
    } finally {
      await h.teardown();
    }
  });

  test('prepare_contributor_branch creates filtered branch with shared items only', async () => {
    const h = await setupHarness('cdev-phase7-branch');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'claude-code', model: 'opus-4-7' });

      // Create a plan with items
      const planRes = await agent.callTool('create_plan', {
        title: 'Branch test plan',
        description: 'Tests contributor branch preparation.',
        project_path: h.fixture.projectPath,
      });
      const plan = JSON.parse(planRes.text);

      // Add a shared item
      const sharedRes = await agent.callTool('add_item', {
        plan_uid: plan.uid,
        kind: 'object',
        title: 'Public architecture doc',
        status: 'pending',
      });
      expect(sharedRes.isError).not.toBe(true);

      // Add a local item
      const localRes = await agent.callTool('add_item', {
        plan_uid: plan.uid,
        kind: 'action',
        title: 'Internal team notes',
        status: 'pending',
        visibility: 'local',
      });
      expect(localRes.isError).not.toBe(true);

      // Export plan to disk so the manifest exists
      const expRes = await agent.callTool('export_plan_to_files', {
        plan_uid: plan.uid,
        project_root: h.fixture.projectPath,
      });
      expect(expRes.isError).not.toBe(true);

      // Commit the current state first
      const commitRes = await agent.callTool('commit_manifest_changes', {
        project_root: h.fixture.projectPath,
        subject: 'initial plan with shared + local items',
        paths: ['.codetrellis/'],
      });
      expect(commitRes.isError).not.toBe(true);

      // Derive plan slug
      const slugTitle = 'branch-test-plan';
      const slugUid = plan.uid.split('-')[0];
      const planSlug = `${slugTitle}-${slugUid}`;

      // Prepare a contributor branch
      const branchRes = await agent.callTool('prepare_contributor_branch', {
        project_path: h.fixture.projectPath,
        plan_slug: planSlug,
        branch_name: 'contrib/contractor-alice',
      });
      expect(branchRes.isError).not.toBe(true);
      const branch = JSON.parse(branchRes.text);
      expect(branch.branch).toBe('contrib/contractor-alice');
      expect(branch.itemCount).toBe(1); // only the shared item
      expect(branch.commitHash).toBeTruthy();

      // Verify we're back on the original branch (not the contributor branch)
      const { execFileSync } = require('node:child_process');
      const currentBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: h.fixture.projectPath,
        encoding: 'utf-8',
      }).trim();
      expect(currentBranch).not.toBe('contrib/contractor-alice');
    } finally {
      await h.teardown();
    }
  });
});
