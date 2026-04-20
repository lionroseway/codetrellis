import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import { TopBar } from './components/layout/TopBar';
import { Sidebar } from './components/layout/Sidebar';
import { MainCanvas } from './components/layout/MainCanvas';
import { InspectorPanel } from './components/layout/InspectorPanel';
import { AgentPanel } from './components/layout/AgentPanel';
import { StatusBar } from './components/layout/StatusBar';
import { FolderPickerModal } from './components/FolderPickerModal';
import { McpGuideModal } from './components/McpGuideModal';
import { useWebSocket } from './hooks/useWebSocket';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

export function App() {
  useWebSocket();
  useKeyboardShortcuts();

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
              <AgentPanel />
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
    </div>
  );
}
