/**
 * Phase 17.E — Smart Plan Templates.
 *
 * Displayed on the plan home page when the plan is empty. Each template
 * seeds the plan description with structured prompting questions and
 * creates pre-structured child items (Actions + Objects) so the user
 * starts from a skeleton rather than a blank page.
 *
 * Templates are client-side data — no backend schema needed. Each
 * template defines:
 *   - id, label, icon, description
 *   - planDescription (markdown body with prompting questions)
 *   - items[] to pre-create (kind, title, body, template hint)
 *
 * The user picks a template, it populates the plan description and
 * creates child items. The user then fills in the blanks.
 */

import { useCallback, useState } from 'react';
import {
  ArrowRightLeft,
  Bug,
  Layers,
  Maximize,
  PackagePlus,
  Rocket,
  Wand2,
  Zap,
} from 'lucide-react';
import { usePlanStore } from '../../../stores/plan-store';
import { usePlanItemsStore } from '../../../stores/plan-items-store';
import { useProjectStore } from '../../../stores/project-store';
import type { PlanItemKind } from '@shared/types';

interface SmartTemplate {
  id: string;
  label: string;
  icon: typeof Zap;
  iconColor: string;
  shortDescription: string;
  /** Markdown body seeded into plan.description. */
  planDescription: string;
  /** Pre-created child items. */
  items: Array<{
    kind: PlanItemKind;
    title: string;
    body?: string;
    template?: string;
  }>;
}

const TEMPLATES: SmartTemplate[] = [
  {
    id: 'refactor',
    label: 'Refactor',
    icon: ArrowRightLeft,
    iconColor: 'text-purple-400',
    shortDescription: 'Rename, move, or restructure existing code',
    planDescription: `## What are you refactoring?

> Describe the code you want to change. What module, class, or pattern is being restructured?

## Why refactor now?

> What's wrong with the current structure? Is it causing bugs, slowing development, or creating confusion?

## From → To

> What does the current structure look like? What should it look like after?

## Constraints

> What must NOT change? Public APIs? Database schemas? Test expectations?
`,
    items: [
      { kind: 'object', title: 'Context & Analysis', body: '## Current structure\n\n> Describe the existing code\n\n## Problems\n\n> What specific issues exist?' },
      { kind: 'action', title: 'Phase 1: Prepare', body: 'Set up any scaffolding, create new files, update imports that need to change.' },
      { kind: 'action', title: 'Phase 2: Migrate', body: 'Move/rename the core code. Update all callers.' },
      { kind: 'action', title: 'Phase 3: Verify & Clean up', body: 'Run tests, remove old code, update docs.' },
    ],
  },
  {
    id: 'new-feature',
    label: 'New Feature',
    icon: Rocket,
    iconColor: 'text-accent',
    shortDescription: 'Build something new from scratch',
    planDescription: `## What does it do?

> One-sentence summary of the feature.

## Where does it live?

> Which directory/module? Does it create new files or modify existing ones?

## What existing code does it touch?

> Which modules, APIs, or components need to change to support this feature?

## Acceptance criteria

> How do you know it's done? Be specific.
- [ ] ...
- [ ] ...
`,
    items: [
      { kind: 'object', title: 'Design & References', body: '## Design decisions\n\n> Architecture, patterns, prior art\n\n## External references\n\n> Links to issues, specs, Figma, etc.' },
      { kind: 'action', title: 'Core implementation', body: 'Build the core logic. Focus on correctness, not polish.' },
      { kind: 'action', title: 'Integration', body: 'Wire into existing code — routes, UI, data layer.' },
      { kind: 'action', title: 'Tests', body: 'Unit tests, integration tests, edge cases.' },
    ],
  },
  {
    id: 'bug-fix',
    label: 'Bug Fix',
    icon: Bug,
    iconColor: 'text-red-400',
    shortDescription: 'Investigate and fix a defect',
    planDescription: `## What's wrong?

> Describe the bug. What happens vs what should happen?

## How to reproduce

> Steps to trigger the bug. Be specific.
1. ...
2. ...

## Where does it happen?

> File, function, or component. Stack trace if available.

## Expected behavior

> What should happen instead?

## Root cause (if known)

> What's causing it? Leave blank if unknown — let the investigation task find it.
`,
    items: [
      { kind: 'action', title: 'Investigate', body: 'Reproduce the bug, find the root cause, document what you find.' },
      { kind: 'action', title: 'Fix', body: 'Apply the minimal fix. Don\'t refactor unrelated code.' },
      { kind: 'action', title: 'Regression test', body: 'Write a test that would have caught this bug.' },
    ],
  },
  {
    id: 'dependency-upgrade',
    label: 'Dependency Upgrade',
    icon: PackagePlus,
    iconColor: 'text-emerald-400',
    shortDescription: 'Upgrade a package and fix breaking changes',
    planDescription: `## Package

> Which package? Current version → target version.

## Known breaking changes

> What changed between versions? Migration guide link?

## Callers to update

> Which files import from this package? (Check with: \`grep -r "from '<package>'" src/\`)

## Risks

> What could break? Are there runtime behaviors that changed?
`,
    items: [
      { kind: 'object', title: 'Migration notes', body: '## Breaking changes\n\n> List all breaking changes from the changelog\n\n## Files that import the package\n\n> ...' },
      { kind: 'action', title: 'Upgrade package', body: 'Update package.json, run install, fix type errors.' },
      { kind: 'action', title: 'Update callers', body: 'Migrate all call sites to the new API.' },
      { kind: 'action', title: 'Verify', body: 'Run full test suite. Check for runtime issues.' },
    ],
  },
  {
    id: 'api-change',
    label: 'API Change',
    icon: Layers,
    iconColor: 'text-cyan-400',
    shortDescription: 'Add, modify, or deprecate API endpoints',
    planDescription: `## Endpoint(s)

> Which endpoints are changing? Method, path, purpose.

## Current contract

> What does the API accept/return today?

## New contract

> What should it accept/return after?

## Consumers

> Who calls this API? Frontend components? Other services? External clients?

## Migration strategy

> How do you handle existing clients? Versioning? Deprecation period?
`,
    items: [
      { kind: 'object', title: 'API Design', body: '## Endpoints\n\n| Method | Path | Change |\n|--------|------|--------|\n| | | |\n\n## Request/Response schemas\n\n> ...' },
      { kind: 'action', title: 'Backend changes', body: 'Update route handlers, validation, database queries.' },
      { kind: 'action', title: 'Update consumers', body: 'Update all clients/callers of the changed endpoints.' },
      { kind: 'action', title: 'Tests & documentation', body: 'Update API tests and any API documentation.' },
    ],
  },
  {
    id: 'performance',
    label: 'Performance',
    icon: Maximize,
    iconColor: 'text-amber-400',
    shortDescription: 'Identify and fix a performance bottleneck',
    planDescription: `## What's slow?

> Which operation, page, or query is underperforming?

## Current performance

> How slow is it? Provide numbers if you have them (ms, p95, etc.)

## Target performance

> What's the goal? How fast should it be?

## Suspected bottleneck

> Where do you think the problem is? File, function, query?

## Measurement

> How will you verify the improvement? Benchmark command, profiler, etc.
`,
    items: [
      { kind: 'action', title: 'Profile & measure', body: 'Measure current performance. Identify the actual bottleneck (not guesses).' },
      { kind: 'action', title: 'Optimize', body: 'Apply the fix. Target the measured bottleneck.' },
      { kind: 'action', title: 'Verify improvement', body: 'Re-measure. Confirm the target was hit. Check for regressions.' },
    ],
  },
];

export function PlanTemplateChooser() {
  const plan = usePlanStore((s) => s.activePlan);
  const fetchPlans = usePlanStore((s) => s.fetchPlans);
  const projectRoot = useProjectStore((s) => s.root);
  const createItem = usePlanItemsStore((s) => s.createItem);
  const selectItem = usePlanItemsStore((s) => s.selectItem);
  const [applying, setApplying] = useState<string | null>(null);

  const handleApply = useCallback(async (template: SmartTemplate) => {
    if (!plan) return;
    setApplying(template.id);

    try {
      // Update plan description
      await fetch(`/api/plans/${plan.uid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: template.planDescription }),
      });

      // Create child items
      let firstItemUid: string | null = null;
      for (const itemDef of template.items) {
        const item = await createItem({
          planUid: plan.uid,
          kind: itemDef.kind,
          title: itemDef.title,
          body: itemDef.body,
          template: itemDef.template ?? null,
        });
        if (item && !firstItemUid) firstItemUid = item.uid;
      }

      // Refresh plan data
      fetchPlans(projectRoot ?? undefined);

      // Select the first created item
      if (firstItemUid) selectItem(firstItemUid);
    } catch (err) {
      console.error('Template apply failed:', err);
    } finally {
      setApplying(null);
    }
  }, [plan, createItem, selectItem, fetchPlans, projectRoot]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Wand2 size={13} className="text-accent" />
        <span className="text-[12px] font-semibold text-foreground-muted uppercase tracking-wider">
          Start from a template
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {TEMPLATES.map((t) => {
          const Icon = t.icon;
          const isApplying = applying === t.id;
          return (
            <button
              key={t.id}
              onClick={() => handleApply(t)}
              disabled={!!applying}
              className="flex items-start gap-2.5 p-3 rounded-lg border border-white/[0.06] bg-white/[0.015] hover:bg-white/[0.04] hover:border-accent/20 text-left transition-colors disabled:opacity-50"
            >
              <Icon size={16} className={`${t.iconColor} mt-0.5 shrink-0`} />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-foreground font-medium">
                  {isApplying ? 'Applying...' : t.label}
                </div>
                <div className="text-[11px] text-foreground-subtle mt-0.5 leading-relaxed">
                  {t.shortDescription}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
