import { useCallback, useEffect, useRef, useState } from 'react';
import { Allotment, type AllotmentHandle } from 'allotment';
import 'allotment/dist/style.css';
import { TopBar } from './components/layout/TopBar';
import { useProjectStore } from './stores/project-store';
import { useUiStore } from './stores/ui-store';
import { usePlanStore } from './stores/plan-store';
import { Sidebar } from './components/layout/Sidebar';
import { MainCanvas } from './components/layout/MainCanvas';
import { CodeWorkspace } from './components/layout/CodeWorkspace';
import { BriefWorkspace } from './components/brief/BriefWorkspace';
import { InspectorPanel } from './components/layout/InspectorPanel';
import { PlanPanel } from './components/layout/PlanPanel';
import { StatusBar } from './components/layout/StatusBar';
import { AudioCaptureBar } from './components/audio/AudioCaptureBar';
import { MinimizedPlanChip } from './components/plan/MinimizedPlanChip';
import { PlanWorkspaceShellV2 } from './components/plan/v2/PlanWorkspaceShellV2';
import { SystemDocsPanel } from './components/system-docs/SystemDocsPanel';
import { FolderPickerModal } from './components/FolderPickerModal';
import { ArtefactViewer } from './components/artefact/ArtefactViewer';
import { GuideModal } from './components/guide/GuideModal';
import { GettingStarted } from './components/GettingStarted';
import { GUIDE_SEEN_KEY } from './components/guide/GuideModal';
import { FirstRunWizard } from './components/FirstRunWizard';
import { ToastContainer } from './components/Toast';
import { PresencePane } from './components/presence/PresencePane';
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

  // First run. Nothing blocks any more.
  //
  // This used to `return <FirstRunWizard/>` in place of the entire app,
  // so a new user met a two-step form — "who are you?", then the MCP
  // snippet — before they could look at a single thing. Both boxes were
  // pre-filled from `git config`, which means the interruption existed
  // to confirm what we already knew.
  //
  // It also hid a whole class of failure. The app was not merely
  // covered, it was NOT MOUNTED, so anything driving the product over
  // MCP got correct answers from the backend while the window showed a
  // sign-up form. A full demo run reported "nothing looked wrong"
  // against twenty-four scenes nobody could see.
  //
  // Now: seed the identity from git and get out of the way. The ask only
  // survives for the case that genuinely needs it — a machine where git
  // cannot tell us who this is — and even then it sits OVER the app
  // rather than instead of it.
  const [askIdentity, setAskIdentity] = useState(false);

  useEffect(() => {
    fetch('/api/settings/first-run-check')
      .then((r) => r.json())
      .then(async (data) => {
        if (data.firstRunComplete) return;

        if (data.canDeriveIdentity) {
          // Persist what git already told us and mark first run done.
          // Best-effort: a failure here costs a second attempt next
          // launch, which is cheaper than a modal.
          await fetch('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              identity: {
                displayName: data.identity?.displayName || data.gitDefaults?.name || '',
                email: data.identity?.email || data.gitDefaults?.email || '',
              },
              firstRunComplete: true,
            }),
          }).catch(() => {});
          return;
        }

        setAskIdentity(true);
      })
      .catch(() => {
        // Backend unreachable. Render the app regardless — a product
        // you cannot open is worse than one with no attribution.
      });
  }, []);

  const onFirstRunComplete = useCallback(() => {
    setAskIdentity(false);
  }, []);

  const horizontalRef = useRef<AllotmentHandle>(null);
  const verticalRef = useRef<AllotmentHandle>(null);

  const planPanelExpanded = useUiStore((s) => s.planPanelExpanded);
  const inspectorExpanded = useUiStore((s) => s.inspectorExpanded);
  const workspaceMode = useUiStore((s) => s.workspaceMode);
  const planPanelVisible = useUiStore((s) => s.agentPanelVisible);
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
    // Phase 31 §10.1 — in the Brief, opening or clearing a brief is part of
    // reading it: the person stays where they are.
    const inBrief = useUiStore.getState().workspaceMode === 'brief';
    if (activePlanUid && activePlanUid !== prev) {
      // New plan opened — fly into takeover.
      if (!inBrief) setWorkspaceMode('plan');
    } else if (!activePlanUid && prev) {
      // Plan cleared — return to graph.
      if (!inBrief) setWorkspaceMode('graph');
    }
    prevPlanUidRef.current = activePlanUid;
  }, [activePlanUid, setWorkspaceMode]);

  // Phase 31 §10.1 — a folder says where opening it lands: a folder of
  // documents opens in the Brief. Once per folder opened, and only from the
  // graph, so it never pulls someone out of where they chose to be.
  const projectRoot = useProjectStore((s) => s.root);
  useEffect(() => {
    if (!projectRoot) return;
    let live = true;
    fetch(`/api/project-config?project=${encodeURIComponent(projectRoot)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((config: { defaultSurface?: string } | null) => {
        const surface = config?.defaultSurface;
        if (!live || (surface !== 'brief' && surface !== 'code')) return;
        if (useUiStore.getState().workspaceMode === 'graph') setWorkspaceMode(surface);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [projectRoot, setWorkspaceMode]);

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

  // Test hook: open a file in the code reader, so a spec can start from
  // "reading this file" without ten clicks through the explorer tree.
  //
  // Sibling of the project hook above and used the same way — only to
  // ARRIVE. Everything a spec is actually asserting is driven through
  // the real controls; a hook that performed the journey would test the
  // hook.
  useEffect(() => {
    const handler = (e: Event) => {
      const { path: filePath, line } = (e as CustomEvent).detail ?? {};
      if (typeof filePath !== 'string') return;
      void import('./lib/open-file-at').then((m) => m.openFileAt(filePath, line ?? null));
    };
    window.addEventListener('__test_open_file__', handler);
    return () => window.removeEventListener('__test_open_file__', handler);
  }, []);

  // First-run auto-open of the Learn Trellis takeover. Triggers
  // exactly once per machine: when the user has no projects open
  // and the localStorage seen-flag isn't set. We wait a beat so
  // the splash render doesn't flash the takeover before the layout
  // settles.
  useEffect(() => {
    const seen = localStorage.getItem(GUIDE_SEEN_KEY) === '1';
    if (seen) return;
    const tabs = useProjectStore.getState().tabs;
    if (tabs.length > 0) {
      // User already had a project open from a previous session —
      // don't ambush them with onboarding. Mark seen so it doesn't
      // surface unprompted later either.
      localStorage.setItem(GUIDE_SEEN_KEY, '1');
      return;
    }
    // First run opens the guide rather than a nine-step carousel. Same
    // content, in a shape someone can come back to and search.
    const t = setTimeout(() => {
      window.dispatchEvent(new CustomEvent('open-mcp-guide'));
      localStorage.setItem(GUIDE_SEEN_KEY, '1');
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
    // `data-app-shell` is how anything outside the renderer can tell that
    // the application actually mounted, rather than something standing in
    // for it. See the `ui_ready` responder in useWebSocket.
    <div
      data-app-shell
      className="flex flex-col h-screen text-foreground bg-gradient-to-br from-[#0a0b10] via-[#0d0e18] to-[#0a0b10]"
    >
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
                {/* Not mounted in code mode. The layer's claim is that the
                    graph is not rendering while you read code, and an overlay
                    does not achieve that: ReactFlow stays mounted behind it
                    and the dagre + d3-force layout keeps running on every
                    graph change. Gated HERE rather than by an early return
                    inside MainCanvas, because hooks run before a return —
                    the layout would still be computed, just thrown away.
                    The Allotment stays mounted so pane sizes survive. */}
                {workspaceMode !== 'code' && workspaceMode !== 'brief' && <MainCanvas />}
              </Allotment.Pane>
              {/* Collapses when the panel is hidden. PlanPanel returns null
                  in that state, and the pane used to keep its full height
                  anyway, so hiding it left an empty slab under the graph. */}
              <Allotment.Pane preferredSize={PLAN_PANEL_DEFAULT} minSize={100} visible={planPanelVisible}>
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

        {/* Code-first surface — Phase 26. The graph really is unmounted
            behind this (see the pane above), and the sidebar stays beside it
            rather than under it: this used to cover the whole body, including
            the file tree, so the empty state said "Pick a file from the
            sidebar" while covering the sidebar. With no file selected — which
            is every fresh launch, since selectedNodeId is not persisted —
            there was no way forward except leaving code mode. */}
        {workspaceMode === 'code' && (
          <div className="absolute inset-0 z-30 bg-background">
            <Allotment>
              <Allotment.Pane preferredSize={SIDEBAR_DEFAULT} minSize={180} maxSize={400}>
                <Sidebar />
              </Allotment.Pane>
              <Allotment.Pane>
                <CodeWorkspace />
              </Allotment.Pane>
            </Allotment>
          </div>
        )}

        {/* Phase 31 §10 — the Brief. Like code mode, the graph is not
            mounted behind it (see the pane above). */}
        {workspaceMode === 'brief' && (
          <div className="absolute inset-0 z-30 bg-background">
            <BriefWorkspace />
          </div>
        )}

        {/* System Docs surface — full takeover when workspaceMode === 'docs'. */}
        {workspaceMode === 'docs' && (
          <div className="absolute inset-0 z-30 bg-background">
            <SystemDocsPanel />
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
      {/* Phase 29 §4.15 — sits directly above the status bar, whose mic
          button toggles it. Renders nothing unless toggled on or a
          capture is running. */}
      <AudioCaptureBar />
      <StatusBar />
      <FolderPickerModal />
      {/* Phase 31 §7 — evidence, opened at the place it cites. */}
      <ArtefactViewer />
      <GuideModal />
      {/* Only when git could not tell us who this is. Over the app,
          never instead of it. */}
      {askIdentity && <FirstRunWizard onComplete={onFirstRunComplete} />}
      <GettingStarted />
      <PresencePane />
      <ToastContainer />
    </div>
  );
}
