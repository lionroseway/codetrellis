/**
 * Phase 33 G6 — opening a plan shows it. Structural, like reachable.test.ts:
 * the owner's report was that opening a minimised plan from eight places left
 * it minimised, because each called `setActivePlan`, which only shows the plan
 * when the active plan CHANGES. A person's "open this plan" goes through
 * `showPlan`; a new direct caller must be listed here with why it may not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const FRONTEND = path.resolve(__dirname, '..');

/** Files that may call setActivePlan directly, and why. */
const ALLOWED: Record<string, string> = {
  'lib/open-plan-item.ts': 'showPlan and openPlanItem themselves',
  'components/plan/MinimizedPlanChip.tsx': 'closes the plan (null), it does not open one',
  'components/brief/BriefWorkspace.tsx': 'the Brief keeps its place on purpose (Phase 31 §10.1)',
  'hooks/useWebSocket.ts': 'navigation from an agent sets the workspace itself, after the plan (select_item uses showPlan)',
  // Creating or importing a plan makes a NEW active plan, which App.tsx shows.
  'components/plan/PlanListView.tsx': 'creates a plan (new uid: App.tsx shows it)',
  'components/plan/PlanTemplatePicker.tsx': 'creates a plan from a template (new uid)',
  'components/plan/v2/PlanImportModal.tsx': 'imports a plan (new uid), then sets the workspace',
  'components/graph/SelectionActionBar.tsx': 'creates a plan from the selection (new uid), then sets the workspace',
  'components/layout/MainCanvas.tsx': 'creates a plan from the graph (new uid)',
};

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

test('a person\'s "open this plan" goes through showPlan; every direct setActivePlan caller says why', () => {
  const callers = sources(FRONTEND)
    .filter((f) => /\bsetActivePlan\(/.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(FRONTEND, f).split(path.sep).join('/'))
    .sort();
  const unexplained = callers.filter((f) => !(f in ALLOWED));
  assert.deepEqual(unexplained, [], `call showPlan (lib/open-plan-item.ts) instead, or add the file to ALLOWED with why: ${unexplained.join(', ')}`);
  const stale = Object.keys(ALLOWED).filter((f) => !callers.includes(f));
  assert.deepEqual(stale, [], `no longer calls setActivePlan; remove from ALLOWED: ${stale.join(', ')}`);
});

test('the places that open an existing plan use showPlan', () => {
  for (const f of [
    'components/plan/PlanListView.tsx', 'components/layout/StackTab.tsx', 'components/plan/RecurringSeriesList.tsx',
    'components/layout/RecurringDue.tsx', 'components/plan/OtherWorktreesSection.tsx', 'components/layout/ConnectedAgents.tsx',
    'components/plan/v2/PlanSwitcher.tsx', 'hooks/useWebSocket.ts',
  ]) {
    assert.match(fs.readFileSync(path.join(FRONTEND, f), 'utf8'), /\bshowPlan\(/, `${f} opens a plan with showPlan`);
  }
});
