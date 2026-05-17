/**
 * Phase 17.C — Floating action bar for multi-selected graph nodes.
 *
 * Appears when 2+ nodes are selected (Shift+click or drag-select).
 * Offers "Plan these" to batch-create a plan Action with all selected
 * file paths as fileSpecs, and "Add to task" if an item is selected
 * in the workspace.
 */

import { useCallback, useMemo, useRef, useEffect, useState } from 'react';
import { useReactFlow, useViewport } from '@xyflow/react';
import { Zap, Plus, X, FileText } from 'lucide-react';
import { useGraphStore } from '../../stores/graph-store';
import { usePlanItemsStore } from '../../stores/plan-items-store';
import { usePlanStore } from '../../stores/plan-store';
import { useUiStore } from '../../stores/ui-store';
import { useToastStore } from '../../stores/toast-store';
import type { FileSpec } from '@shared/types';

export function SelectionActionBar() {
  const selectedNodeIds = useGraphStore((s) => s.selectedNodeIds);
  const clearSelection = useGraphStore((s) => s.clearSelection);
  const { getNodes } = useReactFlow();
  const viewport = useViewport();
  const barRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  // Compute file paths from selection
  const selectedFiles = useMemo(() => {
    if (selectedNodeIds.length < 2) return [];
    const allNodes = getNodes();
    const paths: string[] = [];
    for (const id of selectedNodeIds) {
      const node = allNodes.find((n) => n.id === id);
      if (!node) continue;
      const data = (node.data || {}) as Record<string, unknown>;
      // Only include file nodes (not packages/directories)
      const nodeType = data.nodeType as string | undefined;
      if (nodeType === 'package' || nodeType === 'directory') continue;
      const filePath = typeof data.filePath === 'string' ? data.filePath : id;
      if (filePath) paths.push(filePath);
    }
    return paths;
  }, [selectedNodeIds, getNodes]);

  // Position the bar below the center of selection bounding box
  useEffect(() => {
    if (selectedNodeIds.length < 2) {
      setPos(null);
      return;
    }
    const allNodes = getNodes();
    const selectedNodes = allNodes.filter((n) => selectedNodeIds.includes(n.id));
    if (selectedNodes.length === 0) { setPos(null); return; }

    // Compute bounding box in flow coordinates
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of selectedNodes) {
      const w = n.measured?.width ?? (n.width ?? 160);
      const h = n.measured?.height ?? (n.height ?? 40);
      if (n.position.x < minX) minX = n.position.x;
      if (n.position.y < minY) minY = n.position.y;
      if (n.position.x + w > maxX) maxX = n.position.x + w;
      if (n.position.y + h > maxY) maxY = n.position.y + h;
    }

    // Center-bottom of bounding box, converted to screen coordinates
    const centerX = (minX + maxX) / 2;
    const bottomY = maxY;
    const screenX = centerX * viewport.zoom + viewport.x;
    const screenY = bottomY * viewport.zoom + viewport.y + 16; // 16px gap below

    setPos({ x: screenX, y: screenY });
  }, [selectedNodeIds, viewport, getNodes]);

  // Store refs for plan creation
  const activePlanUid = usePlanStore((s) => s.activePlanUid);
  const setActivePlan = usePlanStore((s) => s.setActivePlan);
  const setWorkspaceMode = useUiStore((s) => s.setWorkspaceMode);
  const createItem = usePlanItemsStore((s) => s.createItem);
  const updateItem = usePlanItemsStore((s) => s.updateItem);
  const selectedItemUid = usePlanItemsStore((s) => s.selectedItemUid);
  const itemsByUid = usePlanItemsStore((s) => s.itemsByUid);
  const selectItem = usePlanItemsStore((s) => s.selectItem);
  const addToast = useToastStore((s) => s.addToast);

  // "Plan these" — create a new Action with all selected files
  const handlePlanThese = useCallback(async () => {
    if (selectedFiles.length === 0) {
      addToast({ type: 'warning', title: 'No file nodes selected', message: 'Select file nodes (not packages) to plan changes.' });
      return;
    }

    let planUid = activePlanUid;
    // Create a plan if none active
    if (!planUid) {
      try {
        const res = await fetch('/api/plans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `Plan (${selectedFiles.length} files)`,
            description: '',
            tasks: [],
          }),
        });
        if (!res.ok) throw new Error('Failed to create plan');
        const plan = await res.json();
        planUid = plan.uid;
        await setActivePlan(planUid!);
      } catch {
        addToast({ type: 'error', title: 'Error', message: 'Could not create plan.' });
        return;
      }
    }

    const fileSpecs: FileSpec[] = selectedFiles.map((path) => ({
      path,
      action: 'modify' as const,
    }));

    const item = await createItem({
      planUid: planUid!,
      kind: 'action',
      title: selectedFiles.length <= 3
        ? selectedFiles.map((p) => p.split('/').pop()).join(', ')
        : `Change ${selectedFiles.length} files`,
      fileSpecs,
    });

    if (item) {
      selectItem(item.uid);
      setWorkspaceMode('plan');
      addToast({ type: 'success', title: 'Task created', message: `${selectedFiles.length} files added as targets.` });
    }
    clearSelection();
  }, [selectedFiles, activePlanUid, createItem, selectItem, setWorkspaceMode, setActivePlan, clearSelection, addToast]);

  // "Add to current task" — append to the selected item's fileSpecs
  const handleAddToCurrentTask = useCallback(async () => {
    if (!selectedItemUid || selectedFiles.length === 0) return;
    const item = itemsByUid[selectedItemUid];
    if (!item || item.kind !== 'action') {
      addToast({ type: 'warning', title: 'Select an Action', message: 'The current item must be an Action to add file targets.' });
      return;
    }

    const existingPaths = new Set((item.fileSpecs ?? []).map((fs) => fs.path));
    const newSpecs: FileSpec[] = selectedFiles
      .filter((p) => !existingPaths.has(p))
      .map((path) => ({ path, action: 'modify' as const }));

    if (newSpecs.length === 0) {
      addToast({ type: 'info', title: 'Already added', message: 'All selected files are already targets of this task.' });
      clearSelection();
      return;
    }

    await updateItem(selectedItemUid, {
      fileSpecs: [...(item.fileSpecs ?? []), ...newSpecs],
    });
    addToast({ type: 'success', title: 'Targets added', message: `${newSpecs.length} file(s) added to "${item.title}".` });
    clearSelection();
  }, [selectedItemUid, selectedFiles, itemsByUid, updateItem, clearSelection, addToast]);

  // Don't render unless 2+ nodes selected
  if (selectedNodeIds.length < 2 || !pos) return null;

  // Clamp position to viewport
  const barWidth = 280;
  const clampedX = Math.max(8, Math.min(pos.x - barWidth / 2, window.innerWidth - barWidth - 8));
  const clampedY = Math.max(8, Math.min(pos.y, window.innerHeight - 80));

  return (
    <div
      ref={barRef}
      className="fixed z-[60] pointer-events-auto animate-in fade-in slide-in-from-bottom-2 duration-150"
      style={{ left: clampedX, top: clampedY }}
    >
      <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/[0.10] bg-[#0c0e1a]/95 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
        {/* Count badge */}
        <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent/10 border border-accent/20 text-accent text-xs font-medium">
          <FileText size={12} />
          {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''}
        </div>

        {/* Plan these — primary */}
        <button
          onClick={handlePlanThese}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/15 hover:bg-accent/25 text-accent text-xs font-medium transition-colors border border-accent/20"
        >
          <Zap size={12} />
          Plan these
        </button>

        {/* Add to current task — secondary */}
        {selectedItemUid && itemsByUid[selectedItemUid]?.kind === 'action' && (
          <button
            onClick={handleAddToCurrentTask}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 text-xs transition-colors border border-white/[0.06]"
          >
            <Plus size={12} />
            Add to task
          </button>
        )}

        {/* Clear */}
        <button
          onClick={clearSelection}
          className="p-1.5 rounded-md hover:bg-white/[0.06] text-zinc-500 hover:text-zinc-300 transition-colors"
          title="Clear selection (Esc)"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
