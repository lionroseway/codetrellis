import { useEffect } from 'react';
import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import { TopBar } from './components/layout/TopBar';
import { useProjectStore } from './stores/project-store';
import { getAPI } from './bridge';
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

export function App() {
  useWebSocket();
  useKeyboardShortcuts();

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

  return (
    <div className="flex flex-col h-screen text-foreground bg-gradient-to-br from-[#0a0b10] via-[#0d0e18] to-[#0a0b10]">
      <TopBar />
      <Allotment className="flex-1 min-h-0">
        <Allotment.Pane preferredSize={240} minSize={180} maxSize={400}>
          <Sidebar />
        </Allotment.Pane>
        <Allotment.Pane>
          <Allotment vertical>
            <Allotment.Pane>
              <MainCanvas />
            </Allotment.Pane>
            <Allotment.Pane preferredSize={180} minSize={100} maxSize={400}>
              <PlanPanel />
            </Allotment.Pane>
          </Allotment>
        </Allotment.Pane>
        <Allotment.Pane preferredSize={280} minSize={200} maxSize={450}>
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
