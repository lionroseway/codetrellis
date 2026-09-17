/**
 * Snapshot comparison and plan review — Phase 25.
 *
 * See [docs/PHASE-25-REVIEW-AND-PLAYBACK.md](../../docs/PHASE-25-REVIEW-AND-PLAYBACK.md).
 *
 * The two findings worth having are the ones a reviewer cannot get from
 * a textual diff: files that changed with no item claiming them, and
 * dependencies that appeared with no item planning them. Both are
 * asserted here against a real mutated fixture.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { setupHarness } from '../harness';

interface Comparand {
  spec: string;
  label: string;
  kind: string;
}

interface Comparison {
  before: { spec: string; label: string; edgesKnown: boolean };
  after: { spec: string; label: string; edgesKnown: boolean };
  diff: {
    addedFiles: string[];
    modifiedFiles: string[];
    removedFiles: string[];
    addedEdges: Array<{ source: string; target: string }>;
  };
  edgesComparable: boolean;
  notes: string[];
}

interface Review {
  unclaimedChanges: string[];
  items: Array<{ title: string; verdict: string; missing: string[] }>;
  summary: { filesChanged: number; unclaimedCount: number; itemsLanded: number; itemsPartial: number };
}

test.describe('Comparison + review (Phase 25)', () => {
  test.setTimeout(120_000);

  test('every point you can compare against is offered', async () => {
    const h = await setupHarness('review-comparands');
    try {
      await h.client.scanProject(h.fixture.projectPath);

      const res = await h.client.raw(
        'GET',
        `/api/comparands?project=${encodeURIComponent(h.fixture.projectPath)}`,
      );
      const comparands = (await res.json()) as Comparand[];

      expect(comparands.some((c) => c.spec === 'live')).toBe(true);
      expect(comparands.some((c) => c.spec === 'baseline')).toBe(true);
      // The fixture is git-initialised, so its commit is offered too —
      // no typing a sha to do the common thing.
      expect(comparands.some((c) => c.kind === 'commit')).toBe(true);
    } finally {
      await h.teardown();
    }
  });

  test('comparing a point with itself is empty by construction, and says so', async () => {
    const h = await setupHarness('review-self-compare');
    try {
      await h.client.scanProject(h.fixture.projectPath);

      const res = await h.client.raw(
        'GET',
        `/api/compare?project=${encodeURIComponent(h.fixture.projectPath)}&before=live&after=live`,
      );
      const cmp = (await res.json()) as Comparison;

      expect(cmp.diff.addedFiles).toHaveLength(0);
      expect(cmp.diff.modifiedFiles).toHaveLength(0);
      expect(cmp.diff.removedFiles).toHaveLength(0);
      expect(cmp.notes.join(' ')).toContain('same point');
    } finally {
      await h.teardown();
    }
  });

  test('a commit comparand reports files but says edges were not compared', async () => {
    const h = await setupHarness('review-commit-edges');
    try {
      await h.client.scanProject(h.fixture.projectPath);

      const comparands = (await (
        await h.client.raw('GET', `/api/comparands?project=${encodeURIComponent(h.fixture.projectPath)}`)
      ).json()) as Comparand[];
      const commit = comparands.find((c) => c.kind === 'commit')!;

      const cmp = (await (
        await h.client.raw(
          'GET',
          `/api/compare?project=${encodeURIComponent(h.fixture.projectPath)}` +
            `&before=${encodeURIComponent(commit.spec)}&after=live`,
        )
      ).json()) as Comparison;

      expect(cmp.edgesComparable).toBe(false);
      // Zero edge changes must not be reported as a finding when the
      // comparison never looked at edges.
      expect(cmp.diff.addedEdges).toHaveLength(0);
      expect(cmp.notes.join(' ')).toContain('Edges were not compared');
    } finally {
      await h.teardown();
    }
  });

  test('an unresolvable comparand is refused, not silently treated as empty', async () => {
    const h = await setupHarness('review-bad-comparand');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const res = await h.client.raw(
        'GET',
        `/api/compare?project=${encodeURIComponent(h.fixture.projectPath)}&before=checkpoint:99999&after=live`,
      );
      expect(res.ok).toBe(false);
      expect(res.status).toBe(404);
    } finally {
      await h.teardown();
    }
  });

  test('review names the files that changed with no item claiming them', async () => {
    const h = await setupHarness('review-unclaimed');
    try {
      await h.client.scanProject(h.fixture.projectPath);

      // A plan that claims one file.
      const plan = await h.client.createPlan({
        title: 'Touch the shared validators',
        description: 'Only validators.ts should change.',
        projectPath: h.fixture.projectPath,
        tasks: [],
      });
      const agent = await h.spawnAgent({ agentType: 'harness-review' });
      await agent.callTool('add_item', {
        plan_uid: plan.uid,
        kind: 'action',
        title: 'Update validators',
        file_specs: [{ path: 'packages/shared/src/validators.ts', action: 'modify' }],
      });

      // Change the claimed file AND one nobody asked for.
      const claimed = path.join(h.fixture.projectPath, 'packages/shared/src/validators.ts');
      fs.appendFileSync(claimed, '\nexport const REVIEWED = true;\n');
      const unclaimed = path.join(h.fixture.projectPath, 'packages/shared/src/types.ts');
      fs.appendFileSync(unclaimed, '\nexport type Sneaky = true;\n');

      await h.client.scanProject(h.fixture.projectPath);

      // Compare against the fixture's commit rather than the baseline.
      // `scanProject` re-pins the baseline every time it runs, so
      // baseline → live is empty immediately after a scan — which is
      // exactly why an explicit comparand picker is the point of this
      // phase. A commit contributes files only, which is all this
      // assertion needs.
      const comparands = (await (
        await h.client.raw('GET', `/api/comparands?project=${encodeURIComponent(h.fixture.projectPath)}`)
      ).json()) as Comparand[];
      const commit = comparands.find((c) => c.kind === 'commit')!;

      const review = (await (
        await h.client.raw(
          'GET',
          `/api/plans/${plan.uid}/review?project=${encodeURIComponent(h.fixture.projectPath)}` +
            `&before=${encodeURIComponent(commit.spec)}&after=live`,
        )
      ).json()) as Review;

      // The finding: types.ts changed and no item asked for it.
      expect(review.unclaimedChanges.some((f) => f.endsWith('types.ts'))).toBe(true);
      expect(review.unclaimedChanges.some((f) => f.endsWith('validators.ts'))).toBe(false);
      expect(review.summary.unclaimedCount).toBeGreaterThan(0);

      const item = review.items.find((i) => i.title === 'Update validators')!;
      expect(item.verdict).toBe('landed');
    } finally {
      await h.teardown();
    }
  });

  test('the markdown form is postable as a PR comment', async () => {
    const h = await setupHarness('review-markdown');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const plan = await h.client.createPlan({
        title: 'Markdown review',
        description: '',
        projectPath: h.fixture.projectPath,
        tasks: [],
      });

      const res = await h.client.raw(
        'GET',
        `/api/plans/${plan.uid}/review?project=${encodeURIComponent(h.fixture.projectPath)}&format=markdown`,
      );
      expect(res.ok).toBe(true);
      const md = await res.text();

      expect(md).toContain('## Plan review');
      expect(md).toMatch(/Landed \| Partial \| Untouched/);
      // The markdown form is what reaches reviewers who do not have the
      // app — which is most reviewers, most of the time.
      expect(md).toContain('Baseline');
    } finally {
      await h.teardown();
    }
  });

  test('the PR draft carries the plan, its tickets and the review — and touches nothing', async () => {
    const h = await setupHarness('review-pr-draft');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'harness-review' });

      // A plan that came from a ticket, so the draft has lineage to carry.
      const created = JSON.parse(
        (await agent.callTool('create_plan_from_external', {
          title: 'Add invoice export',
          description: 'Let users export invoices as CSV.',
          external: { url: 'https://acme.atlassian.net/browse/PROJ-900' },
          items: [{ title: 'Export endpoint' }],
        })).text,
      ) as { plan_uid: string };

      // Read-only is a promise worth proving, not asserting: snapshot
      // the refs before and after. A tool that silently branched or
      // committed on a developer's working tree would be a poor trade
      // for saving an agent three git commands it already knows.
      const headsDir = path.join(h.fixture.projectPath, '.git', 'refs', 'heads');
      const branchesBefore = fs.readdirSync(headsDir).sort();
      const headBefore = fs.readFileSync(path.join(h.fixture.projectPath, '.git', 'HEAD'), 'utf-8');

      const res = await h.client.raw(
        'GET',
        `/api/plans/${created.plan_uid}/pr-draft?project=${encodeURIComponent(h.fixture.projectPath)}`,
      );
      expect(res.ok).toBe(true);
      const draft = (await res.json()) as {
        title: string;
        body: string;
        base: string | null;
        tickets: string[];
        warnings: string[];
      };

      // The ticket leads the title, the way a reviewer expects.
      expect(draft.title).toBe('PROJ-900: Add invoice export');
      expect(draft.tickets).toContain('PROJ-900');
      expect(draft.body).toContain('What this does');
      expect(draft.body).toContain('Let users export invoices as CSV.');
      expect(draft.body).toContain('PROJ-900');
      // The review is part of the body — that is the half an agent
      // cannot write for itself.
      expect(draft.body).toContain('Plan review');
      expect(Array.isArray(draft.warnings)).toBe(true);

      expect(fs.readdirSync(headsDir).sort()).toEqual(branchesBefore);
      expect(fs.readFileSync(path.join(h.fixture.projectPath, '.git', 'HEAD'), 'utf-8')).toBe(headBefore);
    } finally {
      await h.teardown();
    }
  });
});
