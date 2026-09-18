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

      // Phase + doc counts are queryable via the file-export
      // endpoint indirectly, but for a direct REST check we need
      // to read the raw plan. We use the export-then-read pattern
      // since the round-trip is already test-covered.
      const exported = await h.client.exportPlan(plan.uid, h.fixture.projectPath);
      const fs = await import('node:fs');
      const path = await import('node:path');
      const phaseFiles = fs.readdirSync(path.join(exported.planDir, 'phases')).filter((f) => f.endsWith('.yaml'));
      const docFiles = fs.readdirSync(path.join(exported.planDir, 'docs')).filter((f) => f.endsWith('.md'));
      expect(phaseFiles).toHaveLength(3);
      expect(docFiles).toHaveLength(4);

      // Every doc body should have placeholder interpolation done —
      // no `{{feature}}` strings should remain.
      for (const docFile of docFiles) {
        const body = fs.readFileSync(path.join(exported.planDir, 'docs', docFile), 'utf-8');
        expect(body).not.toContain('{{feature}}');
        // The requirements doc starts with `# Requirements — <feature>`,
        // so at least one doc should contain the substituted name.
      }
      const allDocBodies = docFiles
        .map((f) => fs.readFileSync(path.join(exported.planDir, 'docs', f), 'utf-8'))
        .join('\n---\n');
      expect(allDocBodies).toContain('Saved searches');
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
      const exported = await h.client.exportPlan(plan.uid, h.fixture.projectPath);
      const fs = await import('node:fs');
      const path = await import('node:path');
      const reportFile = fs
        .readdirSync(path.join(exported.planDir, 'docs'))
        .find((f) => /bug.report/i.test(f));
      expect(reportFile).toBeTruthy();
      const reportBody = fs.readFileSync(path.join(exported.planDir, 'docs', reportFile!), 'utf-8');
      expect(reportBody).toContain('Login button hangs on slow networks');
      expect(reportBody).toContain('packages/web/src/UserList.tsx');
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
