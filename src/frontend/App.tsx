import { useEffect, useRef } from 'react';
import { Allotment, type AllotmentHandle } from 'allotment';
import 'allotment/dist/style.css';
import { TopBar } from './components/layout/TopBar';
import { useProjectStore } from './stores/project-store';
import { useUiStore } from './stores/ui-store';
import { usePlanStore } from './stores/plan-store';
import { Sidebar } from './components/layout/Sidebar';
import { MainCanvas } from './components/layout/MainCanvas';
import { InspectorPanel } from './components/layout/InspectorPanel';
import { PlanPanel } from './components/layout/PlanPanel';
import { StatusBar } from './components/layout/StatusBar';
import { MinimizedPlanChip } from './components/plan/MinimizedPlanChip';
import { PlanWorkspaceShellV2 } from './components/plan/v2/PlanWorkspaceShellV2';
import { FolderPickerModal } from './components/FolderPickerModal';
import { McpGuideModal } from './components/McpGuideModal';
import { GettingStarted } from './components/GettingStarted';
import { LearnTrellis, LEARN_TRELLIS_SEEN_KEY } from './components/LearnTrellis';
import { ToastContainer } from './components/Toast';
import { TerminalPanel } from './components/terminal/TerminalPanel';
import { AgentPulse } from './components/layout/AgentPulse';
import { useWebSocket } from './hooks/useWebSocket';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

const PLAN_PANEL_DEFAULT = 200;
const PLAN_PANEL_EXPANDED_RATIO = 0.7;
const INSPECTOR_DEFAULT = 320;
const INSPECTOR_EXPANDED_RATIO = 0.55;
const SIDEBAR_DEFAULT = 240;

export function App() {
  useWebSocket();
  useKeyboardShortcuts();

  const horizontalRef = useRef<AllotmentHandle>(null);
  const verticalRef = useRef<AllotmentHandle>(null);

  const planPanelExpanded = useUiStore((s) => s.planPanelExpanded);
  const inspectorExpanded = useUiStore((s) => s.inspectorExpanded);
  const workspaceMode = useUiStore((s) => s.workspaceMode);
  const setWorkspaceMode = useUiStore((s) => s.setWorkspaceMode);
  const splitView = useUiStore((s) => s.splitView);
  const activePlanUid = usePlanStore((s) => s.activePlanUid);

  // Phase 14 §B — auto-flip into plan workspace ONLY on a new plan
  // selection, and back to graph when the plan is cleared. Tracking
  // the previous uid via a ref means the user's manual "minimize to
  // graph" (workspaceMode = 'graph' with the same plan still active)
  // sticks instead of being ping-ponged by this effect.
  const prevPlanUidRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevPlanUidRef.current;
    if (activePlanUid && activePlanUid !== prev) {
      // New plan opened — fly into takeover.
      setWorkspaceMode('plan');
    } else if (!activePlanUid && prev) {
      // Plan cleared — return to graph.
      setWorkspaceMode('graph');
    }
    prevPlanUidRef.current = activePlanUid;
  }, [activePlanUid, setWorkspaceMode]);

  // Test hook: allow e2e tests to open a project programmatically
  useEffect(() => {
    const handler = async (e: Event) => {
      const { projectPath, branch, result } = (e as CustomEvent).detail;
      const store = useProjectStore.getState();
      store.addTab(projectPath, branch);
      store.setMonorepoConfig(result.monorepoConfig);
      store.setFileTree(result.fileTree);
      store.setScanStatus('ready');
    };
    window.addEventListener('__test_open_project__', handler);
    return () => window.removeEventListener('__test_open_project__', handler);
  }, []);

  // First-run auto-open of the Learn Trellis takeover. Triggers
  // exactly once per machine: when the user has no projects open
  // and the localStorage seen-flag isn't set. We wait a beat so
  // the splash render doesn't flash the takeover before the layout
  // settles.
  useEffect(() => {
    const seen = localStorage.getItem(LEARN_TRELLIS_SEEN_KEY) === '1';
    if (seen) return;
    const tabs = useProjectStore.getState().tabs;
    if (tabs.length > 0) {
      // User already had a project open from a previous session —
      // don't ambush them with onboarding. Mark seen so it doesn't
      // surface unprompted later either.
      localStorage.setItem(LEARN_TRELLIS_SEEN_KEY, '1');
      return;
    }
    const t = setTimeout(() => {
      useUiStore.getState().setLearnTrellisOpen(true);
    }, 250);
    return () => clearTimeout(t);
  }, []);

  // Skip the very first effect run — Allotment is still wiring up its
  // internal views and calling resize() too early throws "Cannot read
  // properties of undefined (reading 'minimumSize')". On mount we let
  // Allotment use the Pane preferredSize/minSize props.
  const planResizeMounted = useRef(false);
  const inspectorResizeMounted = useRef(false);

  useEffect(() => {
    if (!planResizeMounted.current) {
      planResizeMounted.current = true;
      return;
    }
    const handle = verticalRef.current;
    if (!handle) return;
    // Defer one frame so Allotment finishes any in-flight layout work.
    const raf = requestAnimationFrame(() => {
      try {
        const total = window.innerHeight - 11 * 16 /* TopBar + StatusBar approx */;
        const planHeight = planPanelExpanded
          ? Math.round(total * PLAN_PANEL_EXPANDED_RATIO)
          : PLAN_PANEL_DEFAULT;
        const canvasHeight = Math.max(total - planHeight, 120);
        handle.resize([canvasHeight, planHeight]);
      } catch (err) {
        console.warn('[App] plan panel resize failed', err);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [planPanelExpanded]);

  useEffect(() => {
    if (!inspectorResizeMounted.current) {
      inspectorResizeMounted.current = true;
      return;
    }
    const handle = horizontalRef.current;
    if (!handle) return;
    const raf = requestAnimationFrame(() => {
      try {
        const total = window.innerWidth;
        const inspectorWidth = inspectorExpanded
          ? Math.round(total * INSPECTOR_EXPANDED_RATIO)
          : INSPECTOR_DEFAULT;
        const center = Math.max(total - SIDEBAR_DEFAULT - inspectorWidth, 320);
        handle.resize([SIDEBAR_DEFAULT, center, inspectorWidth]);
      } catch (err) {
        console.warn('[App] inspector resize failed', err);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [inspectorExpanded]);

  return (
    <div className="flex flex-col h-screen text-foreground bg-gradient-to-br from-[#0a0b10] via-[#0d0e18] to-[#0a0b10]">
      <AgentPulse />
      <TopBar />
      {/* Graph layout is always rendered behind. The plan workspace
          overlays the entire body area when active, so this stays
          mounted (no scan / canvas re-init when minimizing) but is
          hidden under the takeover. */}
      <div className="relative flex-1 min-h-0">
        <Allotment className="absolute inset-0" ref={horizontalRef}>
          <Allotment.Pane preferredSize={SIDEBAR_DEFAULT} minSize={180} maxSize={400}>
            <Sidebar />
          </Allotment.Pane>
          <Allotment.Pane>
            <Allotment vertical ref={verticalRef}>
              <Allotment.Pane>
                <MainCanvas />
              </Allotment.Pane>
              <Allotment.Pane preferredSize={PLAN_PANEL_DEFAULT} minSize={100}>
                <PlanPanel />
              </Allotment.Pane>
            </Allotment>
          </Allotment.Pane>
          <Allotment.Pane preferredSize={INSPECTOR_DEFAULT} minSize={220}>
            <InspectorPanel />
          </Allotment.Pane>
        </Allotment>

        {/* Plan Workspace — full takeover (default) or split view with graph. */}
        {workspaceMode === 'plan' && activePlanUid && !splitView && (
          <div className="absolute inset-0 z-30">
            <PlanWorkspaceShellV2 />
          </div>
        )}
        {workspaceMode === 'plan' && activePlanUid && splitView && (
          <div className="absolute inset-0 z-30">
            <Allotment>
              <Allotment.Pane preferredSize="55%" minSize={360}>
                <PlanWorkspaceShellV2 />
              </Allotment.Pane>
              <Allotment.Pane minSize={320}>
                <MainCanvas />
              </Allotment.Pane>
            </Allotment>
          </div>
        )}

        {/* Floating "Plan: …" chip shown in graph mode when a plan is
            still active (e.g. user hit Minimize). Click to fly the
            workspace back open. */}
        {workspaceMode === 'graph' && activePlanUid && (
          <MinimizedPlanChip onRestore={() => setWorkspaceMode('plan')} />
        )}
      </div>
      <TerminalPanel />
      <StatusBar />
      <FolderPickerModal />
      <McpGuideModal />
      <GettingStarted />
      <LearnTrellis />
      <ToastContainer />
    </div>
  );
}
