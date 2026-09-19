/**
 * Phase 29 §4.15 — the REST routes the newly-wired components call.
 *
 * `cdev-phase7.test.ts` already exercises promote / accept / pantry
 * through their **MCP tools**, so the services are covered. The REST
 * handlers are a separate layer with their own validation and their own
 * Phase 19 confinement, and until §4.15 nothing in either client called
 * them — `ContributionPanel`, `PantryPlaceholder`, `TeamActivityPanel`
 * and `AudioCaptureBar` all existed and none was imported by anything,
 * which is why the §2 endpoint grep reported them as surfaced.
 *
 * So these test the half the MCP tests cannot reach: the routes, as the
 * UI calls them.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { setupHarness, type Harness } from '../harness';

async function promote(h: Harness, title: string, uid: string) {
  return h.client.raw('POST', '/api/contributions/promote', {
    projectPath: h.fixture.projectPath,
    itemUid: uid,
    title,
    kind: 'object',
    body: `Body for ${title}`,
  });
}

test.describe('Surfaced REST routes (Phase 29 §4.15)', () => {
  test.setTimeout(120_000);

  test('promote → list → accept, the loop the panel now drives', async () => {
    const h = await setupHarness('surfaced-contributions');
    try {
      await h.client.scanProject(h.fixture.projectPath);

      // Nothing staged yet — the panel renders nothing on this answer,
      // so it has to be the answer for an ordinary project.
      const empty = await (await h.client.raw(
        'GET', `/api/contributions?project=${encodeURIComponent(h.fixture.projectPath)}`,
      )).json() as { total: number; branch: string };
      expect(empty.total).toBe(0);

      const res = await promote(h, 'Architecture notes', 'contrib-rest-001');
      expect(res.ok).toBe(true);

      const listed = await (await h.client.raw(
        'GET', `/api/contributions?project=${encodeURIComponent(h.fixture.projectPath)}`,
      )).json() as { total: number; branch: string; items: Array<{ title: string }> };
      expect(listed.total).toBe(1);
      expect(listed.items[0].title).toBe('Architecture notes');

      // The panel accepts into the plan's ON-DISK directory, and it
      // finds that directory from file-status rather than re-deriving
      // the slug. Mirror that here — a test that computed the slug
      // itself would pass even if the two disagreed.
      const plan = await h.client.createPlan({
        title: 'Receiving plan', projectPath: h.fixture.projectPath,
      });
      const exportRes = await h.client.raw(
        'POST', `/api/plans/${plan.uid}/export?path=${encodeURIComponent(h.fixture.projectPath)}`,
      );
      expect(exportRes.ok).toBe(true);

      const status = await h.client.getPlanFileStatus(plan.uid, h.fixture.projectPath);
      expect(status.linked).toBe(true);
      const planSlug = status.planDir!.split(path.sep).filter(Boolean).pop()!;

      const acceptRes = await h.client.raw('POST', '/api/contributions/accept', {
        projectPath: h.fixture.projectPath,
        branch: listed.branch,
        planSlug,
      });
      expect(acceptRes.ok).toBe(true);
      const accepted = await acceptRes.json() as { accepted: number; errors: string[] };
      expect(accepted.accepted).toBe(1);
      expect(accepted.errors).toEqual([]);

      // Accept writes FILES — it does not touch the database, which is
      // exactly what the panel's wording promises. Assert the file, not
      // a plan item.
      const itemsDir = path.join(status.planDir!, 'items');
      const written = fs.readdirSync(itemsDir).filter((f) => f.endsWith('.yaml'));
      expect(written.length).toBeGreaterThan(0);
      const body = written.map((f) => fs.readFileSync(path.join(itemsDir, f), 'utf-8')).join('\n');
      expect(body).toContain('Architecture notes');
      // `promotedAt` is staging metadata and is stripped on accept.
      expect(body).not.toContain('promotedAt');
    } finally {
      await h.teardown();
    }
  });

  test('a projectPath outside every opened project is refused on both writes', async () => {
    const h = await setupHarness('surfaced-contributions-confinement');
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-contrib-outside-'));
    try {
      await h.client.scanProject(h.fixture.projectPath);

      for (const [route, extra] of [
        ['/api/contributions/promote', { itemUid: 'x', title: 'x', kind: 'object' }],
        ['/api/contributions/accept', { branch: 'main', planSlug: 'x' }],
        ['/api/contributor-branch', { planSlug: 'x', branchName: 'x' }],
      ] as const) {
        const res = await h.client.raw('POST', route, { projectPath: outside, ...extra });
        expect(res.status, `${route} should refuse an unopened root`).toBe(403);
      }

      // Nothing was created out there.
      expect(fs.existsSync(path.join(outside, '.codetrellis'))).toBe(false);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
      await h.teardown();
    }
  });

  test('pantry resolve tells a missing reference apart from an external one', async () => {
    const h = await setupHarness('surfaced-pantry');
    try {
      await h.client.scanProject(h.fixture.projectPath);

      // The placeholder shows `reason` to explain why something cannot
      // be displayed, so a reason is what this has to return — the
      // difference between "not allowed" and "broken" is the whole
      // point of rendering a placeholder instead of a broken image.
      const res = await h.client.raw(
        'GET',
        `/api/pantry/resolve?project=${encodeURIComponent(h.fixture.projectPath)}`
        + `&refs=${encodeURIComponent('userdata://nope/missing.png')}`
        + `&refs=${encodeURIComponent('https://example.com/ok.png')}`,
      );
      expect(res.ok).toBe(true);
      const data = await res.json() as {
        total: number;
        results: Array<{ reference: string; status: string; reason?: string }>;
      };
      expect(data.total).toBe(2);

      const missing = data.results.find((r) => r.reference.startsWith('userdata://'))!;
      expect(missing.status).not.toBe('resolved');
      expect(missing.reason).toBeTruthy();

      // A URL needs no local file, so it must not be reported as a gap.
      const url = data.results.find((r) => r.reference.startsWith('https://'))!;
      expect(url.status).toBe('resolved');
    } finally {
      await h.teardown();
    }
  });

  test('team activity answers for a git project', async () => {
    const h = await setupHarness('surfaced-team-activity');
    try {
      await h.client.scanProject(h.fixture.projectPath);

      // The Team tab renders this. An error here would show as an empty
      // feed, which reads as "nobody did anything" rather than "this
      // did not work" — so the shape matters even when it is empty.
      const res = await h.client.raw(
        'GET',
        `/api/team-activity?project=${encodeURIComponent(h.fixture.projectPath)}&limit=10`,
      );
      expect(res.ok).toBe(true);
      const data = await res.json() as { total: number; entries: unknown[] };
      expect(Array.isArray(data.entries)).toBe(true);
      expect(data.total).toBe(data.entries.length);
    } finally {
      await h.teardown();
    }
  });
});

/**
 * Phase 29 §4.16 — the endpoints wired in the second pass.
 *
 * `/api/contributor-branch` is the one with teeth. It checks out a new
 * branch, rewrites `.codetrellis/`, commits, and returns you to where
 * you were — so uncommitted manifest work was swept onto the
 * contributor branch and vanished from the original. Survivable while
 * an agent called it deliberately over MCP; not something to put behind
 * a button. §4.16 added a precondition, and this is what proves it.
 */
test.describe('Phase 29 §4.16 routes', () => {
  test.setTimeout(120_000);

  test('contributor-branch refuses a dirty .codetrellis/, and says which files', async () => {
    const h = await setupHarness('contrib-branch-dirty');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const plan = await h.client.createPlan({
        title: 'Shareable plan', projectPath: h.fixture.projectPath,
      });
      const exported = await h.client.raw(
        'POST',
        `/api/plans/${plan.uid}/export?path=${encodeURIComponent(h.fixture.projectPath)}`,
      );
      expect(exported.ok).toBe(true);
      const { planDir } = await exported.json() as { planDir: string };
      const planSlug = planDir.split(path.sep).filter(Boolean).pop()!;

      // Exporting wrote files and nothing committed them, so the
      // manifest is dirty right now — which is exactly the state a user
      // would be in after making a plan and reaching for this.
      const refused = await h.client.raw('POST', '/api/contributor-branch', {
        projectPath: h.fixture.projectPath,
        planSlug,
        branchName: 'contrib/should-not-exist',
      });
      expect(refused.ok).toBe(false);
      const err = await refused.json() as { error: string };
      expect(err.error).toMatch(/uncommitted/i);
      // Naming the files is the difference between a refusal a user can
      // act on and one they can only be annoyed by.
      expect(err.error).toMatch(/\.codetrellis/);

      // And it refused BEFORE touching git — no half-made branch.
      const branches = await (await h.client.raw(
        'GET', `/api/git/info?path=${encodeURIComponent(h.fixture.projectPath)}`,
      )).json() as { branches: string[] };
      expect(branches.branches).not.toContain('contrib/should-not-exist');

      // Commit the manifest and the same call now succeeds — proving
      // the guard is a precondition, not a blanket refusal. There is no
      // REST route for this; committing the manifest is an MCP tool, so
      // do it with git directly rather than invent an endpoint.
      const { execFileSync } = await import('node:child_process');
      const gitEnv = {
        ...process.env,
        GIT_AUTHOR_NAME: 'Harness', GIT_AUTHOR_EMAIL: 'h@codetrellis.local',
        GIT_COMMITTER_NAME: 'Harness', GIT_COMMITTER_EMAIL: 'h@codetrellis.local',
      };
      execFileSync('git', ['add', '.codetrellis/'], { cwd: h.fixture.projectPath, env: gitEnv });
      execFileSync('git', ['commit', '-m', 'plan manifest'], { cwd: h.fixture.projectPath, env: gitEnv });

      const accepted = await h.client.raw('POST', '/api/contributor-branch', {
        projectPath: h.fixture.projectPath,
        planSlug,
        branchName: 'contrib/ok',
      });
      expect(accepted.ok).toBe(true);
      const result = await accepted.json() as { branch: string; commitHash: string };
      expect(result.branch).toBe('contrib/ok');
      expect(result.commitHash).toMatch(/^[a-f0-9]{40}$/);
    } finally {
      await h.teardown();
    }
  });

  test('sync peek describes the bundle without importing it', async () => {
    const h = await setupHarness('sync-peek');
    try {
      // The Settings panel reads this to say what Import would replace,
      // so it has to answer on an unconfigured machine too — that is
      // the common case, and an error there would render as a broken
      // panel rather than "nothing to import".
      const res = await h.client.raw('GET', '/api/sync/peek');
      expect(res.ok).toBe(true);
      const peek = await res.json() as {
        available: boolean; hasSettings: boolean; recentProjectCount: number;
      };
      expect(peek.available).toBe(false);
      expect(peek.hasSettings).toBe(false);
      expect(peek.recentProjectCount).toBe(0);
    } finally {
      await h.teardown();
    }
  });

  test('presence cards outlive the client that was shown them', async () => {
    const h = await setupHarness('presence-cards');
    try {
      // A card with requireAck is an agent blocked on await_ack. The
      // store was filled by WebSocket pushes alone, so a reload lost the
      // card while the agent went on waiting for an answer the user
      // could no longer give. `/api/presence/cards` is what the store
      // now hydrates from — and it had no caller at all before §4.16.
      //
      // Posting goes through the real path: the `present` MCP tool,
      // which is how a card is ever created.
      const agent = await h.spawnAgent({ agentType: 'claude-code', model: 'opus-4-7' });
      const posted = await agent.callTool('present', {
        text: 'Ready to apply the migration?',
        require_ack: true,
      });
      expect(posted.isError).not.toBe(true);

      // A fresh GET is exactly what a reloaded client does.
      const res = await h.client.raw('GET', '/api/presence/cards');
      expect(res.ok).toBe(true);
      const cards = await res.json() as Array<{ id: string; text: string; requireAck: boolean; acked: boolean }>;

      expect(cards.length).toBeGreaterThan(0);
      const card = cards.find((c) => c.text.includes('apply the migration'));
      expect(card).toBeTruthy();
      // The unacked-and-required combination is the one that matters:
      // it is what makes the pane re-open itself on hydrate.
      expect(card!.requireAck).toBe(true);
      expect(card!.acked).toBe(false);
    } finally {
      await h.teardown();
    }
  });
});
