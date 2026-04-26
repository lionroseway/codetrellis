import { useEffect, useRef } from 'react';
import { Allotment, type AllotmentHandle } from 'allotment';
import 'allotment/dist/style.css';
import { TopBar } from './components/layout/TopBar';
import { useProjectStore } from './stores/project-store';
import { useUiStore } from './stores/ui-store';
import { Sidebar } from './components/layout/Sidebar';
import { MainCanvas } from './components/layout/MainCanvas';
import { InspectorPanel } from './components/layout/InspectorPanel';
import { PlanPanel } from './components/layout/PlanPanel';
import { StatusBar } from './components/layout/StatusBar';
import { FolderPickerModal } from './components/FolderPickerModal';
import { McpGuideModal } from './components/McpGuideModal';
import { GettingStarted } from './components/GettingStarted';
import { ToastContainer } from './components/Toast';
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
      <TopBar />
      <Allotment className="flex-1 min-h-0" ref={horizontalRef}>
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
      <StatusBar />
      <FolderPickerModal />
      <McpGuideModal />
      <GettingStarted />
      <ToastContainer />
    </div>
  );
}
