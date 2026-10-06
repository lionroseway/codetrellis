/**
 * Findings where the code is (Phase 33 G10; AGENT-CHECKS-AND-REVIEW §3.4).
 *
 * One finding, from one run: the sample app's OrderList.tsx imports React,
 * which the `react-in-views` rule keeps to the views folder. Sam reaches it from every place the
 * code is, and each place leads to the others:
 *  - the Checks view: the run, the finding, its code and its file on the graph;
 *  - the code: a ⊘ on the line that imports it, the finding in words on hover,
 *    and a click back to the run;
 *  - the diff: the same mark on the live side;
 *  - the inspector: what the latest check found here, with its fix and the run;
 *  - the Brief: the task's rules and the latest check's finding on its files,
 *    with its code and its run.
 * The phone's side is tests/phone/awareness.spec.ts; the backend's (the brief
 * block, the REST route and the phone's RPC, against real runs) is
 * tests/e2e/package-rules.test.ts.
 *
 * The runs are served; the files are the sample app's (a small graph, so the
 * graph link is quick to build).
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject, seedPlan, cleanupPlans, FIXTURE_PATH } from '../helpers/setup';
import { importLine } from '../../src/shared/lib/import-line';

const OUT = path.join('test-results', 'ux-audit');
const FILE = 'packages/web/src/OrderList.tsx';
const KIT = 'packages/web/src/views/';
const LINE = importLine(fs.readFileSync(path.join(FIXTURE_PATH, FILE), 'utf8'), 'npm:react');
const FINDING = {
  rule: 'react-in-views', suite: 'web', path: FILE, imports: 'npm:react', strength: 'block', failing: true,
  words: `only ${KIT} may import npm:react`, fix: `use ${KIT} instead`,
};
const RUN = {
  id: 'local-7', mine: true, who: 'you', verified: true, ranIn: 'the app', commit: 'c0ffee0912345678c0ffee0912345678c0ffee09', base: 'origin/main', scope: 'suite web',
  outcome: { ok: false, files: 1, blocks: 1, warns: 0 }, at: Date.now() - 60_000, says: [], findings: [FINDING],
  words: 'you in the app at c0ffee0, against origin/main, suite web: ✗ 1 blocks',
};
const HOVER = `✗ react-in-views (block): only ${KIT} may import npm:react → use ${KIT} instead`;

async function shot(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

/** Back in the Checks view, with the run open. */
async function atTheRun(page: Page) {
  await expect(page.getByTestId('checks-view')).toBeVisible();
  await expect(page.locator(`[data-testid="check-run-row"][data-run="${RUN.id}"]`)).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('check-run-words')).toHaveText(RUN.words);
}

test.describe('Findings where the code is', () => {
  test.setTimeout(150_000);
  test.use({ viewport: { width: 1440, height: 900 } });
  const TITLE = `E2E Findings ${Math.random().toString(36).slice(2, 7)}`;

  test.afterEach(async ({ request }) => { await cleanupPlans(request, TITLE); });

  test('one finding, reached from the run, the code, the diff, the inspector and the Brief, each leading back to the run', async ({ page, request }) => {
    expect(LINE, 'the file still imports React').not.toBeNull();
    await page.route((url) => url.pathname === '/api/check-runs', (route) => route.fulfill({ json: { runs: [RUN] } }));
    await page.route((url) => url.pathname === '/api/rules', (route) => route.fulfill({ json: { rules: [], suites: [] } }));

    // The Checks view: the run and its finding.
    await gotoWithProject(page, { projectPath: FIXTURE_PATH });
    await page.getByRole('button', { name: 'Rules', exact: true }).click();
    await page.getByTestId('rules-tab-checks').click();
    await page.getByTestId('check-run-row').click();
    const finding = page.getByTestId('check-finding');
    await expect(finding.getByTestId('check-finding-where')).toHaveText(`⊘ ${FILE} imports npm:react`);

    // → its code: the ⊘ on the line that imports it, the finding in words on hover.
    await finding.getByTestId('check-finding-code').click();
    const mark = page.getByTestId('code-finding');
    await expect(mark).toHaveCount(1, { timeout: 20_000 });
    await expect(mark).toHaveAttribute('data-line', String(LINE));
    await expect(mark).toHaveAttribute('title', `${HOVER}\nOpen the check run`);
    await expect(page.locator(`div[data-line="${LINE}"]`).first()).toContainText("from 'react'");
    await shot(page, 'findings-code-gutter');
    // ← back to the run.
    await mark.click();
    await atTheRun(page);

    // → its file on the graph: the inspector says what the latest check found here.
    await page.getByTestId('check-finding-graph').click();
    const inspector = page.locator('.glass-panel.border-l');
    const found = inspector.getByTestId('file-findings');
    await expect(found).toBeVisible({ timeout: 20_000 });
    await expect(found.getByTestId('file-findings-words')).toHaveText('you in the app');
    await expect(found.getByTestId('file-finding')).toContainText('⊘ imports npm:react');
    await expect(found.getByTestId('file-finding-fix')).toHaveText(`→ use ${KIT} instead`);
    // The inspector's code carries the same mark (once the graph it opened has been built).
    await expect(page.getByText('Building dependency graph')).toHaveCount(0, { timeout: 60_000 });
    await inspector.getByText('View source').click();
    await expect(inspector.getByTestId('code-finding')).toHaveAttribute('data-line', String(LINE), { timeout: 20_000 });
    await shot(page, 'findings-inspector');

    // The diff: the same mark, on the live side. (A change near the import, so it is not folded away.)
    const live = fs.readFileSync(path.join(FIXTURE_PATH, FILE), 'utf8');
    await page.route((url) => url.pathname === '/api/file/at', (route) => {
      const at = new URL(route.request().url()).searchParams.get('at');
      return route.fulfill({ json: { ok: true, content: at === 'live' ? live : `// before\n${live.split('\n').slice(1).join('\n')}`, label: at } });
    });
    await inspector.getByRole('button', { name: 'Diff' }).click();
    const diffMark = inspector.getByTestId('diff-finding');
    await expect(diffMark).toHaveCount(1, { timeout: 20_000 });
    await expect(diffMark).toHaveAttribute('data-line', String(LINE));
    await expect(diffMark).toHaveAttribute('title', `${HOVER}\nOpen the check run`);
    // ← back to the run from the inspector.
    await found.getByTestId('file-finding-run').click();
    await atTheRun(page);

    // The Brief: a task that changes the file names its rules and the finding.
    const plan = await seedPlan(request, { title: TITLE, projectPath: FIXTURE_PATH, actions: [{ title: 'Filter the orders', fileSpecs: [{ path: FILE, action: 'modify' }] }] });
    const [task] = plan.actionUids;
    await page.route((url) => url.pathname === `/api/items/${task}/rules`, (route) => route.fulfill({
      json: {
        files: [FILE], in_scope: [{ rule: 'react-in-views', suite: 'web', strength: 'block', words: FINDING.words, because: 'Views render; the rest stays plain TypeScript.' }],
        latest_run: { id: RUN.id, who: 'you', ran_in: 'the app', at: new Date(RUN.at).toISOString(), findings: [FINDING].map(({ rule, path: p, imports, failing, words, fix }) => ({ rule, path: p, imports, failing, words, fix })) },
        says: '1 rule judges this task\'s files. The latest check (you in the app) found 1 import in them that breaks a rule.',
      },
    }));
    await page.getByRole('button', { name: 'Brief', exact: true }).click();
    await page.getByTestId('brief-pick').getByRole('button', { name: TITLE }).click();
    const rules = page.getByTestId('brief-rules');
    await expect(rules.getByTestId('brief-rules-says')).toHaveText('1 rule judges this task\'s files. The latest check (you in the app) found 1 import in them that breaks a rule.');
    await expect(rules.getByTestId('brief-rule')).toHaveText(`■ block${FINDING.words}: Views render; the rest stays plain TypeScript.`);
    await expect(rules.getByTestId('brief-rule-finding')).toContainText(`⊘ ${FILE} imports npm:react`);
    await expect(rules.getByTestId('brief-rule-finding')).toContainText(`→ use ${KIT} instead`);
    await shot(page, 'findings-brief');
    // → its run.
    await rules.getByTestId('brief-rule-run').click();
    await atTheRun(page);

    // → and from the Brief, its code, with the mark.
    await page.getByRole('button', { name: 'Brief', exact: true }).click();
    await page.getByTestId('brief-rules').getByTestId('brief-rule-code').click();
    await expect(page.getByTestId('code-finding')).toHaveAttribute('data-line', String(LINE), { timeout: 20_000 });
  });
});
