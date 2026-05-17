import { useEffect } from 'react';
import { useGraphStore } from '../stores/graph-store';
import { useUiStore } from '../stores/ui-store';

/**
 * Global keyboard shortcuts:
 * - Cmd+O: Open project
 * - Cmd+1/2/3: Switch depth (Package/File/Symbol)
 * - Cmd+B: Toggle sidebar
 * - Cmd+J: Toggle agent panel
 * - Cmd+\: Toggle split view (workspace + graph)
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
