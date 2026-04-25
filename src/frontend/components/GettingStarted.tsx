import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, Plug, ListChecks, Eye, X, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { useProjectStore } from '../stores/project-store';
import { useGraphStore } from '../stores/graph-store';
import { usePlanStore } from '../stores/plan-store';

interface OnboardingState {
  hasMcpSession: boolean;
  hasPlan: boolean;
  activeMcpSessionCount: number;
  planCount: number;
}

const POLL_INTERVAL_MS = 10000;

function dismissedKey(projectPath: string): string {
  return `codetrellis:gettingStarted:dismissed:${projectPath}`;
}

function triedTrellisKey(projectPath: string): string {
  return `codetrellis:gettingStarted:triedTrellis:${projectPath}`;
}

function collapsedKey(projectPath: string): string {
  return `codetrellis:gettingStarted:collapsed:${projectPath}`;
}

export function GettingStarted() {
  const root = useProjectStore((s) => s.root);
  const scanStatus = useProjectStore((s) => s.scanStatus);
  const trellisMode = useGraphStore((s) => s.trellisMode);
  const planCount = usePlanStore((s) => s.plans?.length ?? 0);
  const activePlanUid = usePlanStore((s) => s.activePlanUid);

  const [state, setState] = useState<OnboardingState | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [triedTrellis, setTriedTrellis] = useState(false);

  // Reset per-project flags when the active project changes
  useEffect(() => {
    if (!root) return;
    setDismissed(localStorage.getItem(dismissedKey(root)) === '1');
    setCollapsed(localStorage.getItem(collapsedKey(root)) === '1');
    setTriedTrellis(localStorage.getItem(triedTrellisKey(root)) === '1');
  }, [root]);

  // Track when the user explores any non-live trellis mode
  useEffect(() => {
    if (!root || triedTrellis) return;
    if (trellisMode === 'current' || trellisMode === 'planned' || trellisMode === 'diff') {
      localStorage.setItem(triedTrellisKey(root), '1');
      setTriedTrellis(true);
    }
  }, [root, trellisMode, triedTrellis]);

  // Poll onboarding state from the backend
  useEffect(() => {
    if (!root || scanStatus !== 'ready') return;

    const fetchState = () => {
      fetch(`/api/onboarding-state?project=${encodeURIComponent(root)}`)
        .then((r) => r.json())
        .then((data) => {
          if (data && !data.error) setState(data);
        })
        .catch(() => {});
    };

    fetchState();
    const interval = setInterval(fetchState, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [root, scanStatus, planCount, activePlanUid]);

  const handleDismiss = useCallback(() => {
    if (!root) return;
    localStorage.setItem(dismissedKey(root), '1');
    setDismissed(true);
  }, [root]);

  const handleToggleCollapse = useCallback(() => {
    if (!root) return;
    const next = !collapsed;
    localStorage.setItem(collapsedKey(root), next ? '1' : '0');
    setCollapsed(next);
  }, [root, collapsed]);

  const openMcpGuide = useCallback(() => {
    window.dispatchEvent(new CustomEvent('open-mcp-guide'));
  }, []);

  const steps = useMemo(() => {
    const hasMcpSession = state?.hasMcpSession ?? false;
    const hasPlan = (state?.hasPlan ?? false) || planCount > 0;

    return [
      {
        id: 'project',
        title: 'Project opened',
        description: 'CodeTrellis is parsing your codebase and watching for changes.',
        done: true,
        action: null,
        icon: Sparkles,
      },
      {
        id: 'agent',
        title: 'Connect a coding agent',
        description: 'Plug in any MCP-capable agent (Claude Code, Codex, Cursor) so plans and changes flow through CodeTrellis.',
        done: hasMcpSession,
        action: { label: 'Show MCP setup', onClick: openMcpGuide },
        icon: Plug,
      },
      {
        id: 'plan',
        title: 'Create or receive a plan',
        description: 'Plans are the spec. Agents create them via MCP, or you can author one in the Plans panel.',
        done: hasPlan,
        action: null,
        icon: ListChecks,
      },
      {
        id: 'trellis',
        title: 'Try the trellis modes',
        description: 'Switch between Baseline, Live, Planned, and Diff in the canvas to see the four-state view.',
        done: triedTrellis,
        action: null,
        icon: Eye,
      },
    ];
  }, [state, planCount, triedTrellis, openMcpGuide]);

  const completed = steps.filter((s) => s.done).length;
  const total = steps.length;
  const allDone = completed === total;

  if (!root || scanStatus !== 'ready' || dismissed) return null;
  if (allDone) return null;

  return (
    <div className="fixed bottom-10 left-3 z-30 w-[300px] rounded-xl border border-white/[0.08] bg-[#0b1020]/95 backdrop-blur-md shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06] rounded-t-xl">
        <Sparkles size={12} className="text-accent shrink-0 drop-shadow-[0_0_4px_rgba(59,130,246,0.5)]" />
        <button
          type="button"
          onClick={handleToggleCollapse}
          className="flex-1 flex items-center gap-2 text-left hover:opacity-90 transition-opacity"
        >
          <span className="flex-1 text-[11px] font-semibold text-foreground tracking-wide">
            Getting started
          </span>
          <span className="text-[10px] text-foreground-subtle">
            {completed}/{total}
          </span>
          {collapsed ? (
            <ChevronUp size={12} className="text-foreground-subtle" />
          ) : (
            <ChevronDown size={12} className="text-foreground-subtle" />
          )}
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          className="p-0.5 rounded-md text-foreground-subtle hover:text-foreground hover:bg-white/[0.05] transition-colors"
          title="Dismiss until next session"
        >
          <X size={11} />
        </button>
      </div>
      {!collapsed && (
        <div className="p-2 space-y-1">
          {steps.map((step) => {
            const StepIcon = step.icon;
            return (
              <div
                key={step.id}
                className={`group flex items-start gap-2.5 p-2 rounded-lg border transition-all ${
                  step.done
                    ? 'border-emerald-500/20 bg-emerald-500/[0.04]'
                    : 'border-white/[0.05] bg-white/[0.015] hover:border-white/[0.12]'
                }`}
              >
                <div className="shrink-0 mt-0.5">
                  {step.done ? (
                    <CheckCircle2 size={14} className="text-emerald-400 drop-shadow-[0_0_4px_rgba(34,197,94,0.4)]" />
                  ) : (
                    <Circle size={14} className="text-foreground-subtle" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <StepIcon size={10} className={step.done ? 'text-emerald-400' : 'text-foreground-subtle'} />
                    <span className={`text-[11px] font-medium ${step.done ? 'text-foreground' : 'text-foreground'}`}>
                      {step.title}
                    </span>
                  </div>
                  <p className="text-[10.5px] text-foreground-muted mt-0.5 leading-relaxed">
                    {step.description}
                  </p>
                  {!step.done && step.action && (
                    <button
                      onClick={step.action.onClick}
                      className="mt-1.5 text-[10px] text-accent hover:text-accent-hover underline-offset-2 hover:underline transition-colors"
                    >
                      {step.action.label}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
