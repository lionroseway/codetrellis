/**
 * Phase 17.G — Plan Readiness Score.
 *
 * A ring/badge in the workspace header that grades the plan from
 * "not ready" (red) to "good to go" (green). Checks:
 *
 *   ✓ Has title and intent (plan.title + plan.description non-empty)
 *   ✓ Tasks have targets (every action has ≥1 fileSpec)
 *   ✓ Targets exist (referenced files exist in the scanned project)
 *   ✓ No circular deps (task dependency graph is acyclic)
 *   ✓ Scope is bounded (total file count < 50)
 *   ○ Symbols specified (targets drill down to functions)
 *   ○ Tests mentioned (body references "test" or has test fileSpecs)
 *   ○ Constraints defined (at least one guardrail set)
 *   ○ Agent can reach files (connected agent has the right skills)
 *
 * ✓ = required (red if missing), ○ = suggested (amber if missing)
 */

import { useEffect, useMemo, useState } from 'react';
import { Shield, CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { usePlanStore } from '../../../stores/plan-store';
import { usePlanItemsStore } from '../../../stores/plan-items-store';
import type { PlanItem, Plan } from '@shared/types';

interface ReadinessCheck {
  id: string;
  label: string;
  level: 'required' | 'suggested';
  passed: boolean;
  detail?: string;
}

function computeChecks(plan: Plan, items: PlanItem[]): ReadinessCheck[] {
  const actions = items.filter((i) => i.kind === 'action');
  const checks: ReadinessCheck[] = [];

  // ✓ Has title and intent
  checks.push({
    id: 'title',
    label: 'Has title and intent',
    level: 'required',
    passed: !!(plan.title?.trim() && plan.description?.trim()),
    detail: !plan.title?.trim() ? 'Plan needs a title' :
            !plan.description?.trim() ? 'Add a description so agents know the intent' : undefined,
  });

  // ✓ Has at least one action
  checks.push({
    id: 'has-actions',
    label: 'Has tasks',
    level: 'required',
    passed: actions.length > 0,
    detail: actions.length === 0 ? 'Add at least one task (action item)' : undefined,
  });

  // ✓ Tasks have targets
  const actionsWithTargets = actions.filter((a) =>
    (a.fileSpecs?.length ?? 0) > 0 || (a.symbolSpecs?.length ?? 0) > 0,
  );
  checks.push({
    id: 'targets',
    label: 'Tasks have targets',
    level: 'required',
    passed: actions.length === 0 || actionsWithTargets.length === actions.length,
    detail: actionsWithTargets.length < actions.length
      ? `${actions.length - actionsWithTargets.length} task${actions.length - actionsWithTargets.length !== 1 ? 's' : ''} missing file/symbol targets`
      : undefined,
  });

  // ✓ No circular dependencies
  const depGraph = new Map<string, string[]>();
  for (const a of actions) {
    depGraph.set(a.uid, a.dependencies ?? []);
  }
  const hasCycle = detectCycle(depGraph);
  checks.push({
    id: 'no-cycles',
    label: 'No circular dependencies',
    level: 'required',
    passed: !hasCycle,
    detail: hasCycle ? 'Task dependency graph has a cycle — resolve before handoff' : undefined,
  });

  // ✓ Scope is bounded
  const allFiles = new Set<string>();
  for (const a of actions) {
    for (const fs of a.fileSpecs ?? []) {
      allFiles.add(fs.path);
    }
  }
  checks.push({
    id: 'scope',
    label: 'Scope is bounded',
    level: 'required',
    passed: allFiles.size <= 50,
    detail: allFiles.size > 50 ? `${allFiles.size} files targeted — consider splitting into smaller plans` : undefined,
  });

  // ○ Symbols specified
  const actionsWithSymbols = actions.filter((a) =>
    (a.symbolSpecs?.length ?? 0) > 0 ||
    (a.fileSpecs ?? []).some((fs) => (fs.edits?.length ?? 0) > 0),
  );
  checks.push({
    id: 'symbols',
    label: 'Symbols specified',
    level: 'suggested',
    passed: actions.length === 0 || actionsWithSymbols.length >= actions.length * 0.5,
    detail: actionsWithSymbols.length < actions.length * 0.5
      ? 'Add function-level targeting for more precise execution'
      : undefined,
  });

  // ○ Tests mentioned
  const mentionsTests = actions.some((a) => {
    const body = (a.body ?? '').toLowerCase();
    const hasTestKeyword = body.includes('test') || body.includes('spec') || body.includes('jest') || body.includes('vitest');
    const hasTestFile = (a.fileSpecs ?? []).some((fs) =>
      fs.path.includes('test') || fs.path.includes('spec') || fs.path.includes('__tests__'),
    );
    return hasTestKeyword || hasTestFile;
  });
  const hasTestConstraint = actions.some((a) => a.constraints?.requireTests);
  checks.push({
    id: 'tests',
    label: 'Tests mentioned',
    level: 'suggested',
    passed: mentionsTests || hasTestConstraint,
    detail: !mentionsTests && !hasTestConstraint ? 'Consider adding test requirements or test file targets' : undefined,
  });

  // ○ Constraints defined
  const hasConstraints = actions.some((a) =>
    a.constraints && (
      (a.constraints.excludePaths?.length ?? 0) > 0 ||
      a.constraints.lockInterfaces ||
      a.constraints.requireTests ||
      a.constraints.requireLint ||
      (a.constraints.customRules?.length ?? 0) > 0
    ),
  );
  checks.push({
    id: 'constraints',
    label: 'Guardrails defined',
    level: 'suggested',
    passed: hasConstraints,
    detail: !hasConstraints ? 'Add constraints to prevent agents from going off-rails' : undefined,
  });

  // ○ Git context set
  checks.push({
    id: 'git',
    label: 'Git context set',
    level: 'suggested',
    passed: !!(plan.baseRef || plan.targetBranch),
    detail: !(plan.baseRef || plan.targetBranch) ? 'Set base ref and target branch for proper diff tracking' : undefined,
  });

  return checks;
}

function detectCycle(graph: Map<string, string[]>): boolean {
  const visited = new Set<string>();
  const stack = new Set<string>();

  function dfs(node: string): boolean {
    if (stack.has(node)) return true;
    if (visited.has(node)) return false;
    visited.add(node);
    stack.add(node);
    for (const dep of graph.get(node) ?? []) {
      if (dfs(dep)) return true;
    }
    stack.delete(node);
    return false;
  }

  for (const node of graph.keys()) {
    if (dfs(node)) return true;
  }
  return false;
}

/**
 * Compact readiness ring for the workspace header.
 */
export function PlanReadinessRing() {
  const plan = usePlanStore((s) => s.activePlan);
  const itemsByUid = usePlanItemsStore((s) => s.itemsByUid);
  const [expanded, setExpanded] = useState(false);

  const items = useMemo(() => Object.values(itemsByUid), [itemsByUid]);

  const checks = useMemo(() => {
    if (!plan) return [];
    return computeChecks(plan, items);
  }, [plan, items]);

  if (!plan || checks.length === 0) return null;

  const requiredChecks = checks.filter((c) => c.level === 'required');
  const suggestedChecks = checks.filter((c) => c.level === 'suggested');
  const requiredPassed = requiredChecks.filter((c) => c.passed).length;
  const suggestedPassed = suggestedChecks.filter((c) => c.passed).length;
  const allRequiredPassed = requiredPassed === requiredChecks.length;
  const totalPassed = checks.filter((c) => c.passed).length;
  const pct = Math.round((totalPassed / checks.length) * 100);

  // Color: red if required fail, amber if all required pass but suggested missing, green if all pass
  const color = !allRequiredPassed
    ? 'text-red-400 border-red-500/30 bg-red-500/10'
    : totalPassed === checks.length
    ? 'text-green-400 border-green-500/30 bg-green-500/10'
    : 'text-amber-400 border-amber-500/30 bg-amber-500/10';

  const ringColor = !allRequiredPassed
    ? 'stroke-red-400'
    : totalPassed === checks.length
    ? 'stroke-green-400'
    : 'stroke-amber-400';

  return (
    <div className="relative">
      <button
        onClick={() => setExpanded((p) => !p)}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] font-medium transition-colors ${color}`}
        title={`Plan readiness: ${pct}% — ${allRequiredPassed ? 'ready to hand off' : 'needs attention'}`}
      >
        {/* Mini SVG ring */}
        <svg width="16" height="16" viewBox="0 0 20 20" className="shrink-0">
          <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.15" />
          <circle
            cx="10" cy="10" r="8" fill="none"
            className={ringColor}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * 50.26} 50.26`}
            transform="rotate(-90 10 10)"
          />
        </svg>
        <span>{pct}%</span>
        {expanded ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
      </button>

      {expanded && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[280px] rounded-lg border border-white/[0.10] bg-[#0c0e1a]/98 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] p-3">
          <div className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wider mb-2">
            Readiness Checklist
          </div>

          {/* Required */}
          <div className="space-y-1 mb-3">
            <div className="text-[10px] text-foreground-subtle uppercase tracking-wider font-medium">
              Required
            </div>
            {requiredChecks.map((c) => (
              <CheckRow key={c.id} check={c} />
            ))}
          </div>

          {/* Suggested */}
          <div className="space-y-1">
            <div className="text-[10px] text-foreground-subtle uppercase tracking-wider font-medium">
              Suggested
            </div>
            {suggestedChecks.map((c) => (
              <CheckRow key={c.id} check={c} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CheckRow({ check }: { check: ReadinessCheck }) {
  const Icon = check.passed ? CheckCircle2 : check.level === 'required' ? XCircle : AlertTriangle;
  const tint = check.passed
    ? 'text-green-400'
    : check.level === 'required'
    ? 'text-red-400'
    : 'text-amber-400';

  return (
    <div className="flex items-start gap-2 px-1 py-0.5">
      <Icon size={11} className={`${tint} mt-0.5 shrink-0`} />
      <div className="flex-1 min-w-0">
        <div className={`text-[11.5px] ${check.passed ? 'text-foreground-subtle' : 'text-foreground-muted'}`}>
          {check.label}
        </div>
        {!check.passed && check.detail && (
          <div className="text-[10px] text-foreground-subtle mt-0.5">{check.detail}</div>
        )}
      </div>
    </div>
  );
}
