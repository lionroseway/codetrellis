/**
 * Plan-template tests — proves the 5 built-in templates list cleanly,
 * placeholder substitution does what it says, and applying a
 * template seeds a real plan with the right phases + docs.
 *
 * Until this lands, the templates list was effectively a "trust me"
 * surface — no automated check that adding a new template doesn't
 * break list rendering, that placeholders interpolate correctly, or
 * that `applyTemplate` produces the expected phase + doc count.
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
});
