/**
 * Plan-template tests — proves the 5 built-in templates list cleanly,
 * placeholder substitution does what it says, and applying a
 * template seeds a real plan with the right phases + docs.
 *
 * Until this lands, the templates list was effectively a "trust me"
 * surface — no automated check that adding a new template doesn't
 * break list rendering, that placeholders interpolate correctly, or
 * that `applyTemplate` produces the expected phase + doc count.
 *
 * Phase 29 §4.10 adds the disk round trip. Built-ins were the only
 * thing covered here, and they are also the only thing that was ever
 * reachable — `source: 'project'` and `source: 'user'` templates load
 * from `.codetrellis/templates/` and, until the desktop picker
 * existed, nothing but MCP could see them. The round trip below is
 * exactly what the picker does: publish a plan, list with a project
 * root, create from what comes back.
 */

import { test, expect } from '@playwright/test';
import { setupHarness } from '../harness';

test.describe('Plan templates', () => {
  test.setTimeout(60_000);

  test('lists all built-in templates with sensible metadata', async () => {
    const h = await setupHarness('templates-list');
    try {
      const templates = await h.client.listTemplates();
      const ids = new Set(templates.map((t) => t.id));

      // The five built-ins shipped today.
      expect(ids.has('mass-refactor')).toBe(true);
      expect(ids.has('new-feature')).toBe(true);
      expect(ids.has('bug-fix')).toBe(true);
      expect(ids.has('library-migration')).toBe(true);
      expect(ids.has('perf-pass')).toBe(true);

      for (const t of templates) {
        // Every template should have content the picker can render.
        expect(t.label.length).toBeGreaterThan(0);
        expect(t.shortDescription.length).toBeGreaterThan(0);
        expect(t.defaultTitle.length).toBeGreaterThan(0);
        expect(t.phaseCount).toBeGreaterThan(0);
        expect(t.docCount).toBeGreaterThan(0);
      }

      // The lighter templates declare placeholders.
      const newFeature = templates.find((t) => t.id === 'new-feature')!;
      expect(newFeature.placeholders?.some((p) => p.key === 'feature')).toBe(true);

      const bugFix = templates.find((t) => t.id === 'bug-fix')!;
      const bugFixKeys = new Set((bugFix.placeholders ?? []).map((p) => p.key));
      expect(bugFixKeys.has('bug')).toBe(true);
      expect(bugFixKeys.has('area')).toBe(true);

      const libMig = templates.find((t) => t.id === 'library-migration')!;
      const libMigKeys = new Set((libMig.placeholders ?? []).map((p) => p.key));
      expect(libMigKeys.has('from_library')).toBe(true);
      expect(libMigKeys.has('to_library')).toBe(true);

      const perfPass = templates.find((t) => t.id === 'perf-pass')!;
      const perfKeys = new Set((perfPass.placeholders ?? []).map((p) => p.key));
      expect(perfKeys.has('target_metric')).toBe(true);
      expect(perfKeys.has('target_value')).toBe(true);
    } finally {
      await h.teardown();
    }
  });

  test('new-feature template applies, seeds 3 phases + 4 docs, substitutes {{feature}}', async () => {
    const h = await setupHarness('templates-new-feature-apply');
    try {
      await h.client.scanProject(h.fixture.projectPath);

      const plan = await h.client.createPlanFromTemplate({
        templateId: 'new-feature',
        projectPath: h.fixture.projectPath,
        placeholders: { feature: 'Saved searches' },
      });

      // The template's defaultTitle is `Feature: {{feature}}` — make
      // sure placeholder substitution happened.
      expect(plan.title).toBe('Feature: Saved searches');

      const detail = await h.client.getPlan(plan.uid);
      // No `tasks` declared on the new-feature phases, so taskCount
      // is 0 — that's fine. We're checking phase + doc seeding here.
      expect(detail.title).toBe('Feature: Saved searches');

      // Read the phases and docs directly rather than by exporting
      // and listing directories.
      //
      // These used to go through `exportPlan` and read `phases/` and
      // `docs/`. Phase 29 §4.10 made a V1 template also project its
      // rows into `plan_items` — without that the workspace rendered
      // nothing for a template-created plan — and `exportPlan`
      // switches to the V2 `items/` layout as soon as a plan has
      // items. So the old path stopped finding the directories.
      //
      // Asking the API for phases and docs is what this test meant all
      // along; the export was a detour, and a detour through a layout
      // that can legitimately change.
      const phases = await (await h.client.raw('GET', `/api/plans/${plan.uid}/phases`)).json() as unknown[];
      const docs = await (await h.client.raw('GET', `/api/plans/${plan.uid}/docs`)).json() as Array<{ body: string }>;
      expect(phases).toHaveLength(3);
      expect(docs).toHaveLength(4);

      // Every doc body should have placeholder interpolation done —
      // no `{{feature}}` strings should remain.
      for (const doc of docs) {
        expect(doc.body).not.toContain('{{feature}}');
      }
      expect(docs.map((d) => d.body).join('\n---\n')).toContain('Saved searches');
    } finally {
      await h.teardown();
    }
  });

  test('bug-fix template applies and substitutes {{bug}} + {{area}}', async () => {
    const h = await setupHarness('templates-bug-fix-apply');
    try {
      await h.client.scanProject(h.fixture.projectPath);

      const plan = await h.client.createPlanFromTemplate({
        templateId: 'bug-fix',
        projectPath: h.fixture.projectPath,
        placeholders: { bug: 'Login button hangs on slow networks', area: 'packages/web/src/UserList.tsx' },
      });
      expect(plan.title).toBe('Bug: Login button hangs on slow networks');

      // Spot-check that one of the doc bodies has the substituted bug
      // name (proves placeholder runs through every string field).
      // Read straight from the API — see the note in the new-feature
      // test on why this no longer goes via export.
      const docs = await (await h.client.raw('GET', `/api/plans/${plan.uid}/docs`)).json() as Array<{ title: string; body: string }>;
      const report = docs.find((d) => /bug.report/i.test(d.title));
      expect(report).toBeTruthy();
      expect(report!.body).toContain('Login button hangs on slow networks');
      expect(report!.body).toContain('packages/web/src/UserList.tsx');
    } finally {
      await h.teardown();
    }
  });

  test('a V1 template produces a plan the workspace can render', async () => {
    const h = await setupHarness('templates-v1-items');
    try {
      await h.client.scanProject(h.fixture.projectPath);

      // Every built-in is a V1 template: phases + docs, no `items`.
      // Before Phase 29 §4.10 this produced 0 plan_items, 11 docs and
      // 6 phases — and the V2 workspace renders plan_items and nothing
      // else (no component reads planDocs at all), so the plan showed
      // its empty state with all 17 pieces of content invisible.
      //
      // Latent until the picker gave built-in templates a desktop
      // surface. This is the assertion that keeps it closed.
      const plan = await h.client.createPlanFromTemplate({
        templateId: 'mass-refactor',
        projectPath: h.fixture.projectPath,
      });

      const itemsRes = await h.client.raw('GET', `/api/plans/${plan.uid}/items`);
      expect(itemsRes.ok).toBe(true);
      const items = await itemsRes.json() as Array<{
        uid: string; kind: string; title: string; template: string | null;
      }>;

      // The migrator maps documents → Objects and phases → Actions
      // (template='phase'), so both halves have to arrive.
      expect(items.length).toBeGreaterThan(0);
      expect(items.some((i) => i.kind === 'object')).toBe(true);
      expect(items.some((i) => i.kind === 'action' && i.template === 'phase')).toBe(true);

      // Nothing is lost on the way: one item per legacy row.
      const docs = await (await h.client.raw('GET', `/api/plans/${plan.uid}/docs`)).json() as unknown[];
      const phases = await (await h.client.raw('GET', `/api/plans/${plan.uid}/phases`)).json() as unknown[];
      expect(items.filter((i) => i.kind === 'object').length).toBe(docs.length);
      expect(items.filter((i) => i.template === 'phase').length).toBe(phases.length);

      // Uids are preserved by the migrator, which is what keeps
      // attachments and comments resolving — assert it rather than
      // trusting the doc comment.
      const docUids = new Set((docs as Array<{ uid: string }>).map((d) => d.uid));
      for (const uid of docUids) {
        expect(items.some((i) => i.uid === uid)).toBe(true);
      }
    } finally {
      await h.teardown();
    }
  });

  test('publish → list → create round trip for a project-local template', async () => {
    const h = await setupHarness('templates-project-roundtrip');
    try {
      await h.client.scanProject(h.fixture.projectPath);

      // 1. A plan with a shape worth reusing. Publishing takes the V2
      //    item path when any item exists, which is the path the
      //    desktop "Save as template" chip hits.
      const source = await h.client.createPlan({
        title: 'Service extraction',
        description: 'Pull a bounded context out into its own service.',
        projectPath: h.fixture.projectPath,
      });
      for (const title of ['Map the boundary', 'Move the code', 'Cut over']) {
        const res = await h.client.raw('POST', `/api/plans/${source.uid}/items`, {
          kind: 'action',
          title,
        });
        expect(res.ok).toBe(true);
      }

      // 2. Publish it into <project>/.codetrellis/templates/.
      const pubRes = await h.client.raw(
        'POST',
        `/api/plans/${source.uid}/publish-as-template`,
        {
          projectRoot: h.fixture.projectPath,
          templateId: 'service-extraction',
          label: 'Service extraction',
          shortDescription: 'Pull a bounded context into its own service',
        },
      );
      expect(pubRes.ok).toBe(true);
      const published = await pubRes.json() as { templateDir: string; files: string[] };
      expect(published.files.length).toBeGreaterThan(0);

      const fs = await import('node:fs');
      const path = await import('node:path');
      expect(fs.existsSync(path.join(published.templateDir, 'template.yaml'))).toBe(true);

      // 3. It has to come back from the list — and only when a project
      //    root is passed. Without one, disk templates for that project
      //    are not in scope, which is why the picker sends `?project=`.
      const withProject = await h.client.listTemplates(h.fixture.projectPath);
      const found = withProject.find((t) => t.id === 'service-extraction');
      expect(found).toBeTruthy();
      expect(found!.source).toBe('project');
      expect(found!.label).toBe('Service extraction');

      const withoutProject = await h.client.listTemplates();
      expect(withoutProject.find((t) => t.id === 'service-extraction')).toBeUndefined();

      // Built-ins must survive the merge — a disk template is additive,
      // not a replacement for the list.
      expect(withProject.some((t) => t.id === 'bug-fix' && t.source === 'builtin')).toBe(true);

      // 4. Create from it, the way the picker does.
      const created = await h.client.createPlanFromTemplate({
        templateId: 'service-extraction',
        projectPath: h.fixture.projectPath,
        title: 'Extract billing',
      });
      expect(created.uid).not.toBe(source.uid);
      expect(created.title).toBe('Extract billing');

      const itemsRes = await h.client.raw('GET', `/api/plans/${created.uid}/items`);
      expect(itemsRes.ok).toBe(true);
      const items = await itemsRes.json() as Array<{ title: string }>;
      expect(items.map((i) => i.title).sort()).toEqual(
        ['Cut over', 'Map the boundary', 'Move the code'],
      );
    } finally {
      await h.teardown();
    }
  });
});
