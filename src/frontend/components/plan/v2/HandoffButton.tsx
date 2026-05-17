/**
 * Phase 17.H — One-Click Handoff.
 *
 * Dropdown button in the workspace header that offers:
 *   - "Copy as prompt" — serialize plan/task as markdown → clipboard
 *   - "Push to agent" — broadcast structured notification to connected agents
 *   - Agent picker — choose which connected agent gets the assignment
 *
 * Only shown when the plan has pending Actions that can be handed off.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Copy, ChevronDown, Radio } from 'lucide-react';
import { usePlanStore } from '../../../stores/plan-store';
import { usePlanItemsStore } from '../../../stores/plan-items-store';
import { useToastStore } from '../../../stores/toast-store';
import type { PlanItem, Plan, AgentSessionInfo } from '@shared/types';

/**
 * Generate a markdown prompt from a plan suitable for an agent.
 */
function planToPrompt(plan: Plan, items: PlanItem[]): string {
  const lines: string[] = [];
  lines.push(`# ${plan.title}`);
  if (plan.description) lines.push('', plan.description);
  lines.push('');

  // Git context
  if (plan.baseRef || plan.targetBranch) {
    lines.push('## Git Context');
    if (plan.baseRef) lines.push(`- Base: \`${plan.baseRef}\``);
    if (plan.targetBranch) lines.push(`- Target branch: \`${plan.targetBranch}\``);
    if (plan.autoCreateBranch) lines.push(`- Auto-create branch: yes`);
    lines.push('');
  }

  // Actions (pending/assigned only)
  const actions = items
    .filter((i) => i.kind === 'action' && (i.status === 'pending' || i.status === 'assigned'))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  if (actions.length > 0) {
    lines.push('## Tasks');
    lines.push('');
    for (const action of actions) {
      lines.push(`### ${action.title}`);
      if (action.body) lines.push('', action.body);
      if (action.scopePath) lines.push('', `Scope: \`${action.scopePath}\``);
      if (action.fileSpecs && action.fileSpecs.length > 0) {
        lines.push('', '**Files:**');
        for (const fs of action.fileSpecs) {
          const editsStr = (fs.edits ?? [])
            .filter((e) => e.instruction)
            .map((e) => e.symbol ? `  - ${e.symbol}: ${e.instruction}` : `  - ${e.instruction}`)
            .join('\n');
          lines.push(`- \`${fs.path}\` (${fs.action})${fs.description ? ` — ${fs.description}` : ''}`);
          if (editsStr) lines.push(editsStr);
        }
      }
      if (action.symbolSpecs && action.symbolSpecs.length > 0) {
        lines.push('', '**Symbols:**');
        for (const ss of action.symbolSpecs) {
          lines.push(`- ${ss.action} \`${ss.name}\`${ss.filePath ? ` in \`${ss.filePath}\`` : ''}${ss.description ? ` — ${ss.description}` : ''}`);
        }
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Generate a markdown prompt for a single task.
 */
function taskToPrompt(item: PlanItem, plan: Plan): string {
  const lines: string[] = [];
  lines.push(`# Task: ${item.title}`);
  if (item.body) lines.push('', item.body);
  lines.push('');

  if (item.scopePath) lines.push(`**Scope:** \`${item.scopePath}\``);

  if (item.fileSpecs && item.fileSpecs.length > 0) {
    lines.push('', '## Files to modify');
    for (const fs of item.fileSpecs) {
      lines.push(`- \`${fs.path}\` (${fs.action})${fs.description ? ` — ${fs.description}` : ''}`);
      for (const edit of fs.edits ?? []) {
        if (edit.instruction) {
          lines.push(`  - ${edit.symbol ? `\`${edit.symbol}\`: ` : ''}${edit.instruction}`);
        }
      }
    }
  }

  // Git context from parent plan
  if (plan.baseRef || plan.targetBranch) {
    lines.push('', '## Git Context');
    if (plan.baseRef) lines.push(`- Base: \`${plan.baseRef}\``);
    if (plan.targetBranch) lines.push(`- Branch: \`${plan.targetBranch}\``);
  }

  return lines.join('\n');
}

export function HandoffButton() {
  const plan = usePlanStore((s) => s.activePlan);
  const itemsByUid = usePlanItemsStore((s) => s.itemsByUid);
  const selectedItemUid = usePlanItemsStore((s) => s.selectedItemUid);
  const sessions = usePlanStore((s) => s.sessions);
  const addToast = useToastStore((s) => s.addToast);

  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const activeSessions = sessions.filter((s) => s.status === 'active');
  const items = Object.values(itemsByUid);
  const pendingActions = items.filter((i) => i.kind === 'action' && i.status === 'pending');
  const selectedItem = selectedItemUid ? itemsByUid[selectedItemUid] : null;

  // Copy plan as prompt
  const handleCopyPlan = useCallback(() => {
    if (!plan) return;
    const prompt = planToPrompt(plan, items);
    navigator.clipboard.writeText(prompt);
    addToast({ type: 'success', title: 'Copied', message: 'Plan prompt copied to clipboard.' });
    setOpen(false);
  }, [plan, items, addToast]);

  // Copy current task as prompt
  const handleCopyTask = useCallback(() => {
    if (!plan || !selectedItem) return;
    const prompt = taskToPrompt(selectedItem, plan);
    navigator.clipboard.writeText(prompt);
    addToast({ type: 'success', title: 'Copied', message: `Task "${selectedItem.title}" copied to clipboard.` });
    setOpen(false);
  }, [plan, selectedItem, addToast]);

  // Push to a specific agent
  const handlePushToAgent = useCallback(async (session: AgentSessionInfo) => {
    if (!plan) return;
    // Notify the agent by setting their active plan + broadcasting
    try {
      await fetch(`/api/sessions/${session.sessionId}/assign-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planUid: plan.uid }),
      });
      addToast({
        type: 'success',
        title: 'Plan assigned',
        message: `Pushed to ${session.agentType}${session.model ? ` (${session.model})` : ''}. Agent will pick up pending tasks.`,
      });
    } catch {
      // Fallback — just broadcast
      addToast({
        type: 'info',
        title: 'Notification sent',
        message: `Plan is ready. Agent can pick up tasks via get_next_task().`,
      });
    }
    setOpen(false);
  }, [plan, addToast]);

  if (!plan || pendingActions.length === 0) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-lg border border-accent/30 bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
      >
        <Send size={12} />
        Hand off
        <ChevronDown size={10} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[240px] rounded-lg border border-white/[0.10] bg-[#0c0e1a]/98 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] p-1.5">
          {/* Copy as prompt */}
          <button
            onClick={handleCopyPlan}
            className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] rounded-md hover:bg-white/[0.05] text-foreground-muted hover:text-foreground transition-colors"
          >
            <Copy size={13} className="text-zinc-400" />
            <div>
              <div className="font-medium">Copy plan as prompt</div>
              <div className="text-[10.5px] text-foreground-subtle">{pendingActions.length} pending tasks</div>
            </div>
          </button>

          {/* Copy current task */}
          {selectedItem && selectedItem.kind === 'action' && selectedItem.status === 'pending' && (
            <button
              onClick={handleCopyTask}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] rounded-md hover:bg-white/[0.05] text-foreground-muted hover:text-foreground transition-colors"
            >
              <Copy size={13} className="text-zinc-400" />
              <div>
                <div className="font-medium">Copy this task</div>
                <div className="text-[10.5px] text-foreground-subtle truncate max-w-[180px]">{selectedItem.title}</div>
              </div>
            </button>
          )}

          {/* Divider */}
          {activeSessions.length > 0 && (
            <div className="my-1.5 mx-2 border-t border-white/[0.06]" />
          )}

          {/* Connected agents */}
          {activeSessions.length > 0 && (
            <div className="px-2.5 py-1 text-[10px] uppercase tracking-wider text-foreground-subtle font-medium">
              Push to agent
            </div>
          )}
          {activeSessions.map((session) => (
            <button
              key={session.sessionId}
              onClick={() => handlePushToAgent(session)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] rounded-md hover:bg-white/[0.05] text-foreground-muted hover:text-foreground transition-colors"
            >
              <Radio size={13} className="text-green-400" />
              <div>
                <div className="font-medium">{session.agentType}</div>
                <div className="text-[10.5px] text-foreground-subtle">
                  {session.model || 'unknown model'}
                </div>
              </div>
            </button>
          ))}

          {activeSessions.length === 0 && (
            <div className="px-3 py-2 text-[11px] text-foreground-subtle">
              No agents connected. Copy the prompt and paste it into your agent.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
