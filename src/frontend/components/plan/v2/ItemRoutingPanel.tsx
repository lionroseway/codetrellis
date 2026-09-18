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

import { useCallback, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Shield,
  Cpu,
  Plug,
  RotateCcw,
  Pencil,
  ShieldAlert,
  X,
  Plus,
} from 'lucide-react';
import { usePlanItemsStore } from '../../../stores/plan-items-store';
import type { PlanItem, Skill, ClaimPolicy, ExecutionConfig, ItemConstraints } from '@shared/types';

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

  const resetSkills = useCallback(() => {
    updateItem(item.uid, {
      skills: [],
      skillsMode: 'inherit',
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

  // Add a skill
  const [newSkillName, setNewSkillName] = useState('');
  const addSkill = useCallback(() => {
    if (!newSkillName.trim()) return;
    const existing = item.skills ?? [];
    const skill: Skill = { name: newSkillName.trim(), source: 'mcp', required: true };
    updateItem(item.uid, {
      skills: [...existing, skill],
      skillsMode: item.skillsMode === 'inherit' && existing.length === 0 ? 'replace' : item.skillsMode,
    });
    setNewSkillName('');
  }, [item, newSkillName, updateItem]);

  const removeSkill = useCallback((name: string) => {
    const existing = item.skills ?? [];
    updateItem(item.uid, { skills: existing.filter((s) => s.name !== name) });
  }, [item, updateItem]);

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

          {/* ── Skills ───────────────────────────────────── */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <Plug size={11} className="text-zinc-500" />
              <span className="text-[11px] font-medium text-foreground-muted">Required skills</span>
              {isInherited(resolved.skills.source) && (
                <span className="text-[10px] text-foreground-subtle italic">
                  (inherited from {resolved.skills.source})
                </span>
              )}
              {(item.skills ?? []).length > 0 && (
                <button onClick={resetSkills} className="text-[10px] text-accent hover:text-accent-hover ml-auto" title="Reset to inherit">
                  <RotateCcw size={10} />
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {resolved.skills.skills.map((s) => (
                <span
                  key={s.name}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] border border-purple-500/20 bg-purple-500/[0.06] text-purple-300"
                >
                  {s.name}
                  <span className="text-[9px] opacity-50">{s.source}</span>
                  {(item.skills ?? []).some((ls) => ls.name === s.name) && (
                    <button onClick={() => removeSkill(s.name)} className="ml-0.5 opacity-50 hover:opacity-100">&times;</button>
                  )}
                </span>
              ))}
              {resolved.skills.skills.length === 0 && (
                <span className="text-[11px] text-foreground-subtle">None required</span>
              )}
            </div>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={newSkillName}
                onChange={(e) => setNewSkillName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addSkill(); }}
                placeholder="Add skill (e.g. playwright, typescript)"
                className="flex-1 text-[11.5px] px-2 py-1 rounded-md border border-white/[0.06] bg-white/[0.02] text-foreground placeholder:text-foreground-subtle/40 focus:border-accent/30 focus:outline-none"
              />
              <button
                onClick={addSkill}
                disabled={!newSkillName.trim()}
                className="px-2 py-1 text-[11px] rounded-md border border-white/[0.08] bg-white/[0.03] text-foreground-muted hover:text-foreground hover:bg-white/[0.06] disabled:opacity-30 transition-colors"
              >
                Add
              </button>
            </div>
          </div>

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
          <div className="text-[11px] text-amber-300/80">🔒 Interfaces locked</div>
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
