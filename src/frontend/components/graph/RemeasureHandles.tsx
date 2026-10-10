import { useEffect } from 'react';
import { useStore, useUpdateNodeInternals, type ReactFlowState } from '@xyflow/react';

/**
 * The nodes React Flow has a size for and no handle positions, as one string
 * so the selector is stable between store updates.
 */
function unhandled(s: ReactFlowState): string {
  const ids: string[] = [];
  for (const node of s.nodeLookup.values()) {
    if (!node.hidden && node.measured?.width && node.measured?.height && !node.internals.handleBounds) ids.push(node.id);
  }
  return ids.join('\n');
}

/**
 * Measures again any drawn node React Flow knows the size of but not the
 * handles of, so its edges can be drawn.
 *
 * React Flow 12 draws an edge from its two nodes' handle positions, and
 * records them only when a node's ResizeObserver reports. A node object that
 * comes back carrying its `measured` size (as `preserveNodePositions` keeps
 * it, so nodes are not hidden on every rebuild) is taken as measured, and if
 * React Flow's own record of its handles has gone meanwhile, nothing measures
 * them again: the element's size has not changed, so its observer stays
 * quiet. CI's serial run caught the canvas like that (#387): 21 nodes drawn
 * and measured, 25 edges held, no node with handles, and not one edge drawn.
 *
 * A node that is not mounted (off screen, with `onlyRenderVisibleElements`)
 * is skipped by `updateNodeInternals` and measured as usual when it mounts.
 */
export function RemeasureHandles() {
  const ids = useStore(unhandled);
  const update = useUpdateNodeInternals();
  useEffect(() => {
    if (ids) update(ids.split('\n'));
  }, [ids, update]);
  return null;
}
