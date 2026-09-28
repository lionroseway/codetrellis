/**
 * Phase 17.P — Cascade & Inheritance UI for item properties.
 *
 * Collapsible panel showing skills, claim policy, and execution config
 * for the current item. Each property displays:
 *   - The effective (resolved) value
 *   - An "(inherited from <ancestor>)" label when cascaded
 *   - Override/Reset controls
 *
 * Renders between TargetsStrip and ContextRail on the item canvas.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Shield,
  Cpu,
  RotateCcw,
  Pencil,
  ShieldAlert,
  X,
  Plus, Lock } from 'lucide-react';
import { usePlanItemsStore } from '../../../stores/plan-items-store';
import { SkillsEditor } from './SkillsEditor';
import type { PlanItem, Skill, ClaimPolicy, ExecutionConfig, ItemConstraints } from '@shared/types';
import { useBreakpointsStore, itemBreakpoint } from '../../../stores/breakpoints-store';
import { useAwarenessStore } from '../../../stores/awareness-store';
import { usePlanStore } from '../../../stores/plan-store';
import { useProjectStore } from '../../../stores/project-store';
import { useTerminalStore, type AgentPreset } from '../../../stores/terminal-store';
import { suggestSectionBranch, worktreeDirFor } from '@shared/lib/branch-name';

// ─── Cascade resolution (client-side mirror of backend logic) ───────────

function resolveClaimPolicyClient(
  item: PlanItem,
  itemsByUid: Record<string, PlanItem>,
): { policy: ClaimPolicy; source: string } {
  if (item.claimPolicy && item.claimPolicyMode !== 'inherit') {
    return { policy: item.claimPolicy, source: item.title };
  }
  if (item.claimPolicy && item.claimPolicyMode === 'inherit') {
    // Has a local policy that's marked inherit — this IS the policy (it's the nearest)
    return { policy: item.claimPolicy, source: item.title };
  }
  // Walk up
  let cur = item.parentUid ? itemsByUid[item.parentUid] : null;
  while (cur) {
    if (cur.claimPolicy) {
      return { policy: cur.claimPolicy, source: cur.title };
    }
    cur = cur.parentUid ? itemsByUid[cur.parentUid] : null;
  }
  return { policy: { mode: 'any' }, source: '(default)' };
}

function resolveSkillsClient(
  item: PlanItem,
  itemsByUid: Record<string, PlanItem>,
): { skills: Skill[]; source: string } {
  const chain: PlanItem[] = [];
  let cur: PlanItem | null = item;
  while (cur) {
    chain.unshift(cur);
    cur = cur.parentUid ? itemsByUid[cur.parentUid] : null;
  }

  let resolved: Skill[] = [];
  let source = '(none)';
  for (const ancestor of chain) {
    const skills = ancestor.skills ?? [];
    if (skills.length === 0 && (ancestor.skillsMode ?? 'inherit') === 'inherit') continue;
    if (ancestor.skillsMode === 'replace') {
      resolved = [...skills];
      source = ancestor.title;
    } else if (ancestor.skillsMode === 'none') {
      resolved = [];
      source = ancestor.title;
    } else {
      const byName = new Map(resolved.map((s) => [s.name, s]));
      for (const s of skills) byName.set(s.name, s);
      resolved = Array.from(byName.values());
      if (skills.length > 0) source = ancestor.title;
    }
  }
  return { skills: resolved, source };
}

function resolveExecutionConfigClient(
  item: PlanItem,
  itemsByUid: Record<string, PlanItem>,
): { config: ExecutionConfig | null; source: string } {
  if (item.executionConfig && item.executionConfigMode !== 'inherit') {
    return { config: item.executionConfig, source: item.title };
  }
  if (item.executionConfig) {
    return { config: item.executionConfig, source: item.title };
  }
  let cur = item.parentUid ? itemsByUid[item.parentUid] : null;
  while (cur) {
    if (cur.executionConfig) {
      return { config: cur.executionConfig, source: cur.title };
    }
    cur = cur.parentUid ? itemsByUid[cur.parentUid] : null;
  }
  return { config: null, source: '(default)' };
}

function resolveConstraintsClient(
  item: PlanItem,
  itemsByUid: Record<string, PlanItem>,
): { constraints: ItemConstraints; source: string } {
  const chain: PlanItem[] = [];
  let cur: PlanItem | null = item;
  while (cur) {
    chain.unshift(cur);
    cur = cur.parentUid ? itemsByUid[cur.parentUid] : null;
  }

  let resolved: ItemConstraints = {};
  let source = '(none)';
  for (const ancestor of chain) {
    const c = ancestor.constraints;
    const mode = ancestor.constraintsMode ?? 'inherit';

    if (mode === 'none') {
      resolved = {};
      source = ancestor.title;
      continue;
    }
    if (mode === 'replace' && c) {
      resolved = { ...c };
      source = ancestor.title;
      continue;
    }
    if (!c) continue;
    // inherit — merge additively
    resolved = {
      excludePaths: [...(resolved.excludePaths ?? []), ...(c.excludePaths ?? [])],
      excludeSymbols: [...(resolved.excludeSymbols ?? []), ...(c.excludeSymbols ?? [])],
      lockInterfaces: resolved.lockInterfaces || c.lockInterfaces || false,
      requireTests: resolved.requireTests || c.requireTests || false,
      requireLint: resolved.requireLint || c.requireLint || false,
      maxFilesTouched: c.maxFilesTouched ?? resolved.maxFilesTouched ?? null,
      maxLinesChanged: c.maxLinesChanged ?? resolved.maxLinesChanged ?? null,
      customRules: [...(resolved.customRules ?? []), ...(c.customRules ?? [])],
    };
    source = ancestor.title;
  }
  return { constraints: resolved, source };
}

// ─── Claim policy display helpers ───────────────────────────────────────

const CLAIM_MODE_LABELS: Record<string, string> = {
  any: 'Anyone',
  'agent-only': 'AI agents only',
  'human-only': 'Human only',
  assigned: 'Specific assignee',
  'match-skills': 'Match by skills',
};

// ─── Component ──────────────────────────────────────────────────────────

export function ItemRoutingPanel({ item }: { item: PlanItem }) {
  const [expanded, setExpanded] = useState(false);
  const itemsByUid = usePlanItemsStore((s) => s.itemsByUid);
  const updateItem = usePlanItemsStore((s) => s.updateItem);

  const resolved = useMemo(() => ({
    claim: resolveClaimPolicyClient(item, itemsByUid),
    skills: resolveSkillsClient(item, itemsByUid),
    exec: resolveExecutionConfigClient(item, itemsByUid),
    constraints: resolveConstraintsClient(item, itemsByUid),
  }), [item, itemsByUid]);

  const hasConstraints = !!(
    (resolved.constraints.constraints.excludePaths?.length) ||
    (resolved.constraints.constraints.excludeSymbols?.length) ||
    resolved.constraints.constraints.lockInterfaces ||
    resolved.constraints.constraints.requireTests ||
    resolved.constraints.constraints.requireLint ||
    resolved.constraints.constraints.maxFilesTouched ||
    (resolved.constraints.constraints.customRules?.length)
  );

  const hasAnyConfig = resolved.skills.skills.length > 0 ||
    resolved.claim.policy.mode !== 'any' ||
    resolved.exec.config !== null ||
    hasConstraints;

  const isInherited = (source: string) => source !== item.title && source !== '(default)' && source !== '(none)';

  // Quick-set claim policy
  const setClaimMode = useCallback((mode: ClaimPolicy['mode']) => {
    updateItem(item.uid, {
      claimPolicy: { mode },
      claimPolicyMode: 'replace',
    });
  }, [item.uid, updateItem]);

  // Reset to inherit
  const resetClaimPolicy = useCallback(() => {
    updateItem(item.uid, {
      claimPolicy: null,
      claimPolicyMode: 'inherit',
    });
  }, [item.uid, updateItem]);

  const resetExecConfig = useCallback(() => {
    updateItem(item.uid, {
      executionConfig: null,
      executionConfigMode: 'inherit',
    });
  }, [item.uid, updateItem]);

  const resetConstraints = useCallback(() => {
    updateItem(item.uid, {
      constraints: null,
      constraintsMode: 'inherit',
    });
  }, [item.uid, updateItem]);

  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <div className="border-t border-white/[0.04] pt-3">
      <button
        onClick={() => setExpanded((p) => !p)}
        className="flex items-center gap-2 text-[11.5px] text-foreground-subtle hover:text-foreground transition-colors w-full"
      >
        <Chevron size={12} className="text-zinc-500" />
        <Shield size={12} className="text-zinc-500" />
        <span className="uppercase tracking-wider font-medium">Routing & Execution</span>
        {hasAnyConfig && !expanded && (
          <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] text-foreground-subtle">
            {resolved.claim.policy.mode !== 'any' ? CLAIM_MODE_LABELS[resolved.claim.policy.mode] : ''}
            {resolved.skills.skills.length > 0 ? ` · ${resolved.skills.skills.length} skills` : ''}
            {resolved.exec.config?.model ? ` · ${resolved.exec.config.model}` : ''}
            {hasConstraints ? ' · guardrails' : ''}
          </span>
        )}
      </button>

      {expanded && (
        <div className="mt-3 space-y-4 ml-6">
          {/* ── Claim Policy ─────────────────────────────── */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[11px] font-medium text-foreground-muted">Who works on this</span>
              {isInherited(resolved.claim.source) && (
                <span className="text-[10px] text-foreground-subtle italic">
                  (inherited from {resolved.claim.source})
                </span>
              )}
              {item.claimPolicy && (
                <button onClick={resetClaimPolicy} className="text-[10px] text-accent hover:text-accent-hover ml-auto" title="Reset to inherit from parent">
                  <RotateCcw size={10} />
                </button>
              )}
            </div>
            <select
              value={resolved.claim.policy.mode}
              onChange={(e) => setClaimMode(e.target.value as ClaimPolicy['mode'])}
              className="w-full text-[12px] px-2.5 py-1.5 rounded-md border border-white/[0.08] bg-white/[0.02] text-foreground focus:outline-none focus:border-accent/30"
            >
              <option value="any">Anyone (default)</option>
              <option value="agent-only">AI agents only</option>
              <option value="human-only">Human only (no AI)</option>
              <option value="assigned">Specific assignee</option>
              <option value="match-skills">Match by skills</option>
            </select>
          </div>

          {/* ── Worked in: one plan, several worktrees (Phase 32 C5.1) ── */}
          <WorkedIn item={item} />

          {/* ── Ask me first: breakpoints (Phase 32 B4.3) ── */}
          <AskMeFirst item={item} />

          {/* ── Skills (Phase 32 C1.2) ───────────────────── */}
          <SkillsEditor
            item={item}
            resolved={resolved.skills.skills}
          />

          {/* ── Execution Config ─────────────────────────── */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <Cpu size={11} className="text-zinc-500" />
              <span className="text-[11px] font-medium text-foreground-muted">Execution settings</span>
              {isInherited(resolved.exec.source) && (
                <span className="text-[10px] text-foreground-subtle italic">
                  (inherited from {resolved.exec.source})
                </span>
              )}
              {item.executionConfig && (
                <button onClick={resetExecConfig} className="text-[10px] text-accent hover:text-accent-hover ml-auto" title="Reset to inherit">
                  <RotateCcw size={10} />
                </button>
              )}
            </div>
            <ExecConfigEditor
              config={resolved.exec.config}
              isLocal={resolved.exec.source === item.title}
              onUpdate={(config) => {
                updateItem(item.uid, {
                  executionConfig: config,
                  executionConfigMode: 'replace',
                });
              }}
            />
          </div>

          {/* ── Constraints & Guardrails (17.F) ─────────── */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <ShieldAlert size={11} className="text-amber-500/70" />
              <span className="text-[11px] font-medium text-foreground-muted">Guardrails</span>
              {isInherited(resolved.constraints.source) && (
                <span className="text-[10px] text-foreground-subtle italic">
                  (inherited from {resolved.constraints.source})
                </span>
              )}
              {item.constraints && (
                <button onClick={resetConstraints} className="text-[10px] text-accent hover:text-accent-hover ml-auto" title="Reset to inherit">
                  <RotateCcw size={10} />
                </button>
              )}
            </div>
            <ConstraintsEditor
              constraints={resolved.constraints.constraints}
              localConstraints={item.constraints ?? null}
              onUpdate={(c) => {
                updateItem(item.uid, {
                  constraints: c,
                  constraintsMode: 'replace',
                });
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Execution Config Editor ────────────────────────────────────────────

// ─── Constraints Editor ────────────────────────────────────────────────

function ConstraintsEditor({
  constraints,
  localConstraints,
  onUpdate,
}: {
  constraints: ItemConstraints;
  localConstraints: ItemConstraints | null;
  onUpdate: (c: ItemConstraints) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [newExcludePath, setNewExcludePath] = useState('');
  const [newRule, setNewRule] = useState('');

  const isEmpty = !constraints.excludePaths?.length &&
    !constraints.excludeSymbols?.length &&
    !constraints.lockInterfaces &&
    !constraints.requireTests &&
    !constraints.requireLint &&
    !constraints.maxFilesTouched &&
    !constraints.customRules?.length;

  if (!editing && isEmpty) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="flex items-center gap-1.5 text-[11px] text-foreground-subtle hover:text-foreground transition-colors"
      >
        <Plus size={10} />
        Add guardrails
      </button>
    );
  }

  if (!editing) {
    return (
      <div className="space-y-1.5">
        {constraints.excludePaths && constraints.excludePaths.length > 0 && (
          <div className="text-[11px] text-foreground-muted">
            <span className="text-foreground-subtle">Exclude:</span>{' '}
            {constraints.excludePaths.map((p) => (
              <span key={p} className="inline-block px-1.5 py-0.5 mr-1 rounded bg-red-500/[0.06] border border-red-500/20 text-red-300 font-mono text-[10px]">
                {p}
              </span>
            ))}
          </div>
        )}
        {constraints.lockInterfaces && (
          <div className="flex items-center gap-1 text-[11px] text-amber-300/80"><Lock size={10} /> Interfaces locked</div>
        )}
        {constraints.requireTests && (
          <div className="text-[11px] text-green-300/80">✓ Tests required</div>
        )}
        {constraints.requireLint && (
          <div className="text-[11px] text-blue-300/80">✓ Lint/format required</div>
        )}
        {constraints.maxFilesTouched && (
          <div className="text-[11px] text-foreground-muted">
            <span className="text-foreground-subtle">Max files:</span> {constraints.maxFilesTouched}
          </div>
        )}
        {constraints.maxLinesChanged && (
          <div className="text-[11px] text-foreground-muted">
            <span className="text-foreground-subtle">Max lines:</span> {constraints.maxLinesChanged}
          </div>
        )}
        {constraints.customRules && constraints.customRules.length > 0 && (
          <div className="text-[11px] text-foreground-muted">
            <span className="text-foreground-subtle">Rules:</span>{' '}
            {constraints.customRules.length} custom
          </div>
        )}
        <button
          onClick={() => setEditing(true)}
          className="text-[10.5px] text-accent hover:text-accent-hover"
        >
          Edit
        </button>
      </div>
    );
  }

  // Editing mode
  const draft = localConstraints ?? constraints;

  return (
    <div className="space-y-3 p-2.5 rounded-lg border border-white/[0.06] bg-white/[0.01]">
      {/* Exclude paths */}
      <div>
        <label className="text-[10px] text-foreground-subtle uppercase tracking-wider">Excluded paths (globs)</label>
        <div className="flex flex-wrap gap-1 mt-1">
          {(draft.excludePaths ?? []).map((p) => (
            <span key={p} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-mono bg-red-500/[0.06] border border-red-500/20 text-red-300">
              {p}
              <button
                onClick={() => onUpdate({ ...draft, excludePaths: (draft.excludePaths ?? []).filter((x) => x !== p) })}
                className="opacity-50 hover:opacity-100"
              >
                <X size={9} />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-1 mt-1">
          <input
            type="text"
            value={newExcludePath}
            onChange={(e) => setNewExcludePath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newExcludePath.trim()) {
                onUpdate({ ...draft, excludePaths: [...(draft.excludePaths ?? []), newExcludePath.trim()] });
                setNewExcludePath('');
              }
            }}
            placeholder="src/auth/** or *.lock"
            className="flex-1 text-[11px] px-2 py-1 rounded-md border border-white/[0.06] bg-white/[0.02] text-foreground font-mono placeholder:text-foreground-subtle/40 focus:border-accent/30 focus:outline-none"
          />
        </div>
      </div>

      {/* Boolean toggles */}
      <div className="space-y-1.5">
        <label className="flex items-center gap-2 text-[11px] text-foreground-muted cursor-pointer">
          <input
            type="checkbox"
            checked={draft.lockInterfaces ?? false}
            onChange={(e) => onUpdate({ ...draft, lockInterfaces: e.target.checked })}
            className="rounded border-white/[0.15] bg-white/[0.02] text-accent focus:ring-accent/30"
          />
          Lock interfaces (no signature changes)
        </label>
        <label className="flex items-center gap-2 text-[11px] text-foreground-muted cursor-pointer">
          <input
            type="checkbox"
            checked={draft.requireTests ?? false}
            onChange={(e) => onUpdate({ ...draft, requireTests: e.target.checked })}
            className="rounded border-white/[0.15] bg-white/[0.02] text-accent focus:ring-accent/30"
          />
          Require tests for changes
        </label>
        <label className="flex items-center gap-2 text-[11px] text-foreground-muted cursor-pointer">
          <input
            type="checkbox"
            checked={draft.requireLint ?? false}
            onChange={(e) => onUpdate({ ...draft, requireLint: e.target.checked })}
            className="rounded border-white/[0.15] bg-white/[0.02] text-accent focus:ring-accent/30"
          />
          Require lint/format pass
        </label>
      </div>

      {/* Numeric limits */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-foreground-subtle uppercase tracking-wider">Max files</label>
          <input
            type="number"
            value={draft.maxFilesTouched ?? ''}
            onChange={(e) => onUpdate({ ...draft, maxFilesTouched: e.target.value ? Number(e.target.value) : null })}
            placeholder="∞"
            className="w-full mt-0.5 text-[11px] px-2 py-1 rounded-md border border-white/[0.06] bg-white/[0.02] text-foreground placeholder:text-foreground-subtle/40 focus:border-accent/30 focus:outline-none"
          />
        </div>
        <div>
          <label className="text-[10px] text-foreground-subtle uppercase tracking-wider">Max lines</label>
          <input
            type="number"
            value={draft.maxLinesChanged ?? ''}
            onChange={(e) => onUpdate({ ...draft, maxLinesChanged: e.target.value ? Number(e.target.value) : null })}
            placeholder="∞"
            className="w-full mt-0.5 text-[11px] px-2 py-1 rounded-md border border-white/[0.06] bg-white/[0.02] text-foreground placeholder:text-foreground-subtle/40 focus:border-accent/30 focus:outline-none"
          />
        </div>
      </div>

      {/* Custom rules */}
      <div>
        <label className="text-[10px] text-foreground-subtle uppercase tracking-wider">Custom rules</label>
        <div className="space-y-1 mt-1">
          {(draft.customRules ?? []).map((rule, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <span className="text-[11px] text-foreground-muted flex-1 leading-relaxed">{rule}</span>
              <button
                onClick={() => onUpdate({ ...draft, customRules: (draft.customRules ?? []).filter((_, j) => j !== i) })}
                className="opacity-50 hover:opacity-100 mt-0.5"
              >
                <X size={9} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-1 mt-1">
          <input
            type="text"
            value={newRule}
            onChange={(e) => setNewRule(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newRule.trim()) {
                onUpdate({ ...draft, customRules: [...(draft.customRules ?? []), newRule.trim()] });
                setNewRule('');
              }
            }}
            placeholder="e.g. Do not use console.log"
            className="flex-1 text-[11px] px-2 py-1 rounded-md border border-white/[0.06] bg-white/[0.02] text-foreground placeholder:text-foreground-subtle/40 focus:border-accent/30 focus:outline-none"
          />
        </div>
      </div>

      <button
        onClick={() => setEditing(false)}
        className="text-[10.5px] text-accent hover:text-accent-hover"
      >
        Done
      </button>
    </div>
  );
}

// ─── Execution Config Editor ────────────────────────────────────────────

function ExecConfigEditor({
  config,
  
  onUpdate,
}: {
  config: ExecutionConfig | null;
  isLocal: boolean;
  onUpdate: (config: ExecutionConfig) => void;
}) {
  const [editing, setEditing] = useState(false);
  const current = config ?? {};

  if (!editing && !config) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="flex items-center gap-1.5 text-[11px] text-foreground-subtle hover:text-foreground transition-colors"
      >
        <Pencil size={10} />
        Set model / settings
      </button>
    );
  }

  if (!editing && config) {
    return (
      <div className="space-y-1">
        {config.model && (
          <div className="text-[11.5px] text-foreground-muted">
            <span className="text-foreground-subtle">Model:</span> {config.model}
          </div>
        )}
        {config.reasoningEffort && (
          <div className="text-[11.5px] text-foreground-muted">
            <span className="text-foreground-subtle">Reasoning:</span> {config.reasoningEffort}
          </div>
        )}
        {config.maxTokens && (
          <div className="text-[11.5px] text-foreground-muted">
            <span className="text-foreground-subtle">Max tokens:</span> {config.maxTokens.toLocaleString()}
          </div>
        )}
        {config.systemPrompt && (
          <div className="text-[11.5px] text-foreground-muted">
            <span className="text-foreground-subtle">System prompt:</span> {config.systemPrompt.slice(0, 60)}...
          </div>
        )}
        <button
          onClick={() => setEditing(true)}
          className="text-[10.5px] text-accent hover:text-accent-hover"
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2 p-2 rounded-lg border border-white/[0.06] bg-white/[0.01]">
      <div>
        <label className="text-[10px] text-foreground-subtle uppercase tracking-wider">Model</label>
        <input
          type="text"
          defaultValue={current.model ?? ''}
          onBlur={(e) => onUpdate({ ...current, model: e.target.value || null })}
          placeholder="e.g. claude-opus-4, claude-sonnet-4"
          className="w-full mt-0.5 text-[11.5px] px-2 py-1 rounded-md border border-white/[0.06] bg-white/[0.02] text-foreground placeholder:text-foreground-subtle/40 focus:border-accent/30 focus:outline-none"
        />
      </div>
      <div>
        <label className="text-[10px] text-foreground-subtle uppercase tracking-wider">Reasoning effort</label>
        <select
          defaultValue={current.reasoningEffort ?? ''}
          onChange={(e) => onUpdate({ ...current, reasoningEffort: (e.target.value || null) as any })}
          className="w-full mt-0.5 text-[11.5px] px-2 py-1 rounded-md border border-white/[0.06] bg-white/[0.02] text-foreground focus:outline-none focus:border-accent/30"
        >
          <option value="">Default</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </div>
      <div>
        <label className="text-[10px] text-foreground-subtle uppercase tracking-wider">Max tokens</label>
        <input
          type="number"
          defaultValue={current.maxTokens ?? ''}
          onBlur={(e) => onUpdate({ ...current, maxTokens: e.target.value ? Number(e.target.value) : null })}
          placeholder="e.g. 8192"
          className="w-full mt-0.5 text-[11.5px] px-2 py-1 rounded-md border border-white/[0.06] bg-white/[0.02] text-foreground placeholder:text-foreground-subtle/40 focus:border-accent/30 focus:outline-none"
        />
      </div>
      <div>
        <label className="text-[10px] text-foreground-subtle uppercase tracking-wider">System prompt</label>
        <textarea
          defaultValue={current.systemPrompt ?? ''}
          onBlur={(e) => onUpdate({ ...current, systemPrompt: e.target.value || null })}
          placeholder="Additional instructions for the agent..."
          rows={3}
          className="w-full mt-0.5 text-[11.5px] px-2 py-1.5 rounded-md border border-white/[0.06] bg-white/[0.02] text-foreground placeholder:text-foreground-subtle/40 focus:border-accent/30 focus:outline-none resize-none"
        />
      </div>
      <button
        onClick={() => setEditing(false)}
        className="text-[10.5px] text-accent hover:text-accent-hover"
      >
        Done
      </button>
    </div>
  );
}

/**
 * Breakpoints on this item (Phase 32 B4.3): "ask me before an agent claims
 * or finishes this", and "before an agent changes its description". A
 * breakpoint on a parent covers this item too, and says so here.
 */
function AskMeFirst({ item }: { item: PlanItem }) {
  const breakpoints = useBreakpointsStore((s) => s.breakpoints);
  const setBp = useBreakpointsStore((s) => s.set);
  const clear = useBreakpointsStore((s) => s.clear);
  const refresh = useBreakpointsStore((s) => s.refresh);
  const itemsByUid = usePlanItemsStore((s) => s.itemsByUid);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void refresh(); }, [refresh]);

  const inheritedFrom = (kind: 'task' | 'spec'): string | null => {
    const seen = new Set<string>();
    let at = item.parentUid ?? null;
    while (at && !seen.has(at)) {
      seen.add(at);
      if (itemBreakpoint(breakpoints, kind, at)) return itemsByUid[at]?.title ?? 'a parent';
      at = itemsByUid[at]?.parentUid ?? null;
    }
    return null;
  };

  const toggle = async (kind: 'task' | 'spec') => {
    const own = itemBreakpoint(breakpoints, kind, item.uid);
    setBusy(true);
    const err = own ? await clear(own.id) : await setBp({ kind, itemUid: item.uid });
    setBusy(false);
    setError(err);
  };

  const rows: Array<{ kind: 'task' | 'spec'; label: string }> = [
    { kind: 'task', label: 'Before an agent claims or finishes this' },
    { kind: 'spec', label: 'Before an agent changes its description' },
  ];
  return (
    <div data-testid="ask-me-first">
      <div className="text-[11px] font-medium text-foreground-muted mb-1.5">Ask me first</div>
      <div className="space-y-1">
        {rows.map(({ kind, label }) => {
          const own = !!itemBreakpoint(breakpoints, kind, item.uid);
          const parent = own ? null : inheritedFrom(kind);
          return (
            <label key={kind} className="flex items-center gap-2 text-[11px] text-foreground-muted cursor-pointer">
              <input type="checkbox" checked={own} disabled={busy} onChange={() => toggle(kind)} data-testid={`ask-me-${kind}`} />
              {label}
              {parent && <span className="text-[10px] text-foreground-subtle italic">(already asked, from the breakpoint on “{parent}”)</span>}
            </label>
          );
        })}
      </div>
      <div className="mt-1 text-[10px] text-foreground-subtle">
        The agent&apos;s call waits until you answer, in Awareness: continue, continue with a note, or stop.
      </div>
      {error && <div role="alert" className="mt-1 text-[10px] text-danger">{error}</div>}
    </div>
  );
}


interface SectionView {
  own: string | null;
  section: { branch: string; fromUid: string; fromTitle: string } | null;
  where: string | null;
  /** The worktree's folder, when one has the section's branch checked out. */
  root: string | null;
}

/**
 * Which worktree this item is worked in (Phase 32 C5.1): its branch, set
 * here or inherited from the section above it. Agents in another worktree
 * are not offered its tasks and cannot claim them, whatever client they are.
 */
function WorkedIn({ item }: { item: PlanItem }) {
  const workstreams = useAwarenessStore((s) => s.workstreams);
  const [view, setView] = useState<SectionView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/items/${encodeURIComponent(item.uid)}/workstream`);
      if (res.ok) setView((await res.json()) as SectionView);
    } catch { /* shown as unknown below */ }
  }, [item.uid]);
  useEffect(() => { void load(); }, [load, item.workstream]);

  const choose = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/items/${encodeURIComponent(item.uid)}/workstream`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workstream: value || null }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Not saved (${res.status})`);
      }
    } catch {
      setError('Could not reach CodeTrellis.');
    }
    await load();
    setBusy(false);
  };

  // Every branch a workstream is on, the main checkout first; a folder name beside a worktree's.
  const options = workstreams
    .filter((w) => w.branch)
    .sort((a, b) => Number(b.main) - Number(a.main) || (a.branch ?? '').localeCompare(b.branch ?? ''))
    .map((w) => ({ branch: w.branch as string, label: w.root.startsWith('branch:') ? `${w.branch} (branch only)` : `${w.branch} — ${w.root.split(/[\\/]/).pop()}` }));
  const own = view?.own ?? null;
  if (own && !options.some((o) => o.branch === own)) options.push({ branch: own, label: `${own} (no workstream here now)` });
  const inherited = view && !own && view.section ? view.section : null;

  return (
    <div data-testid="worked-in">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[11px] font-medium text-foreground-muted">Worked in</span>
        {inherited && (
          <span className="text-[10px] text-foreground-subtle italic">(inherited from “{inherited.fromTitle}”)</span>
        )}
      </div>
      <select
        value={own ?? ''}
        disabled={busy || !view}
        onChange={(e) => void choose(e.target.value)}
        data-testid="worked-in-select"
        aria-label="Which worktree this is worked in"
        className="w-full text-[12px] px-2.5 py-1.5 rounded-md border border-white/[0.08] bg-white/[0.02] text-foreground focus:outline-none focus:border-accent/30"
      >
        <option value="">{inherited ? `As its section: ${inherited.branch}` : 'Any worktree (default)'}</option>
        {options.map((o) => <option key={o.branch} value={o.branch}>{o.label}</option>)}
      </select>
      <div className="mt-1 text-[10px] text-foreground-subtle" data-testid="worked-in-note">
        {view?.section
          ? `Only agents working on ${view.where} are offered these tasks or can claim them, whichever agent they are.`
          : 'Any agent, in any worktree, can pick these tasks up. Choose a worktree to keep this section to one.'}
      </div>
      {error && <div role="alert" className="mt-1 text-[10px] text-danger">{error}</div>}
      {view && !own && <NewWorktree item={item} onMade={load} />}
      {view?.root && view.section && <StartAgentHere root={view.root} branch={view.section.branch} />}
    </div>
  );
}

/**
 * "New worktree for this section" (Phase 32 C5.2): a branch named after the
 * plan and the section (editable), made beside the project from the plan's
 * base, and the section kept to it. Shows the folder before anything is made.
 */
function NewWorktree({ item, onMade }: { item: PlanItem; onMade: () => Promise<void> }) {
  const planTitle = usePlanStore((s) => s.plans.find((p) => p.uid === item.planUid)?.title ?? '');
  const root = useProjectStore((s) => s.root);
  const [open, setOpen] = useState(false);
  const [branch, setBranch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setBranch(suggestSectionBranch(planTitle, item.title)); }, [planTitle, item.title]);
  const folder = root && branch.trim() ? worktreeDirFor(root, branch.trim()) : null;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/items/${encodeURIComponent(item.uid)}/worktree`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: branch.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setError(body.error ?? `Not made (${res.status})`);
      else {
        setOpen(false);
        // The new worktree is a workstream now: list it without waiting for the broadcast.
        await useAwarenessStore.getState().refresh(root);
      }
    } catch {
      setError('Could not reach CodeTrellis.');
    }
    await onMade();
    setBusy(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        data-testid="new-worktree"
        className="mt-1.5 text-[11px] text-accent hover:underline"
      >
        New worktree for this section…
      </button>
    );
  }
  return (
    <div className="mt-1.5 rounded-md border border-white/[0.08] bg-white/[0.02] p-2 space-y-1.5" data-testid="new-worktree-form">
      <label className="block text-[10px] text-foreground-muted">
        Branch
        <input
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          disabled={busy}
          aria-label="Branch for the new worktree"
          className="mt-0.5 w-full text-[12px] font-mono px-2 py-1 rounded border border-white/[0.08] bg-black/20 text-foreground focus:outline-none focus:border-accent/30"
        />
      </label>
      <div className="text-[10px] text-foreground-subtle" data-testid="new-worktree-folder">
        {folder ? <>Makes <span className="font-mono text-foreground-muted">{folder}</span> on a new branch, and keeps this section to it.</> : 'Give the branch a name.'}
      </div>
      {error && <div role="alert" className="text-[10px] text-danger">{error}</div>}
      <div className="flex gap-2">
        <button
          onClick={() => void create()}
          disabled={busy || !folder}
          className="px-2 py-0.5 text-[11px] rounded bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-50"
        >
          {busy ? 'Making…' : 'Make worktree'}
        </button>
        <button onClick={() => { setOpen(false); setError(null); }} disabled={busy} className="px-2 py-0.5 text-[11px] rounded text-foreground-muted hover:text-foreground">
          Cancel
        </button>
      </div>
    </div>
  );
}

const START_PRESETS: Array<{ preset: AgentPreset; label: string }> = [
  { preset: 'claude', label: 'Claude Code' },
  { preset: 'codex', label: 'Codex' },
  { preset: 'aider', label: 'aider' },
  { preset: 'shell', label: 'A shell (any other agent)' },
];

/**
 * Start an agent where the section is worked (Phase 32 C5.2): a CodeTrellis
 * terminal in that folder, for whichever agent the person uses, or the
 * folder copied for a terminal of their own.
 */
function StartAgentHere({ root, branch }: { root: string; branch: string }) {
  const createSession = useTerminalStore((s) => s.createSession);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(`cd "${root}"`); setCopied(true); } catch { setCopied(false); }
  };
  return (
    <div className="mt-2" data-testid="start-agent-here">
      <div className="text-[10px] text-foreground-muted mb-1">Start an agent in {branch}:</div>
      <div className="flex flex-wrap gap-1.5">
        {START_PRESETS.map(({ preset, label }) => (
          <button
            key={preset}
            onClick={() => void createSession(preset, { cwd: root, title: `${label} · ${branch}` })}
            className="px-2 py-0.5 text-[11px] rounded border border-white/[0.08] text-foreground-muted hover:text-foreground hover:bg-white/[0.04]"
          >
            {label}
          </button>
        ))}
        <button
          onClick={() => void copy()}
          title={`cd "${root}"`}
          className="px-2 py-0.5 text-[11px] rounded border border-white/[0.08] text-foreground-muted hover:text-foreground hover:bg-white/[0.04]"
        >
          {copied ? 'Copied' : 'Copy the folder'}
        </button>
      </div>
    </div>
  );
}
