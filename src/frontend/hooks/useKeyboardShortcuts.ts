import { useEffect } from 'react';
import { useGraphStore } from '../stores/graph-store';
import { useUiStore } from '../stores/ui-store';
import { useTerminalStore } from '../stores/terminal-store';

/**
 * Global keyboard shortcuts:
 * - Cmd+O: Open project
 * - Cmd+1/2/3: Switch depth (Package/File/Symbol)
 * - Cmd+B: Toggle sidebar
 * - Cmd+J: Toggle agent panel
 * - Cmd+\: Toggle split view (workspace + graph)
 * - Cmd+`: Toggle terminal panel
 * - Cmd+Shift+C: Toggle the code-first surface (Phase 26)
 * - Cmd+Shift+M: Toggle the audio capture bar (Phase 29 §4.15)
 * - Escape: Deselect node
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.key === 'o') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('open-folder-picker'));
      }

      if (meta && e.key === '1') {
        e.preventDefault();
        useGraphStore.getState().setViewDepth('package');
      }
      if (meta && e.key === '2') {
        e.preventDefault();
        useGraphStore.getState().setViewDepth('file');
      }
      if (meta && e.key === '3') {
        e.preventDefault();
        useGraphStore.getState().setViewDepth('symbol');
      }

      if (meta && e.key === 'b') {
        e.preventDefault();
        useUiStore.getState().toggleSidebar();
      }

      if (meta && e.key === 'j') {
        e.preventDefault();
        useUiStore.getState().toggleAgentPanel();
      }

      // Cmd+\ — toggle split view (plan workspace + graph side by side)
      if (meta && e.key === '\\') {
        e.preventDefault();
        useUiStore.getState().toggleSplitView();
      }

      // Cmd+` — toggle terminal panel
      if (meta && e.key === '`') {
        e.preventDefault();
        useTerminalStore.getState().togglePanel();
      }

      // Cmd+Shift+C — the code-first surface. A peer of the graph, so
      // it gets a shortcut of its own rather than living in a menu.
      if (meta && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        e.preventDefault();
        const ui = useUiStore.getState();
        ui.setWorkspaceMode(ui.workspaceMode === 'code' ? 'graph' : 'code');
      }

      // Cmd+Shift+M — the audio capture bar. The bar has advertised
      // this shortcut in its own UI since Phase 8, and nothing bound it;
      // the bar was never rendered, so nobody could find out.
      if (meta && e.shiftKey && (e.key === 'M' || e.key === 'm')) {
        e.preventDefault();
        useUiStore.getState().toggleAudioBar();
      }

      if (e.key === 'Escape') {
        useUiStore.getState().setSelectedNode(null);
        // Phase 17.C — clear multi-select on graph
        useGraphStore.getState().clearSelection();
      }
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
