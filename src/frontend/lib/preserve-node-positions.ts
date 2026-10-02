import type { Node } from '@xyflow/react';

/**
 * The next graph's nodes, keeping what each still-present node already had on
 * screen: where it was dragged to, and React Flow's measurement of it.
 *
 * The canvas rebuilds every node object whenever what it shows changes
 * (selection, plan highlights, overlays, work counts, collisions). React Flow
 * 12 takes a new node object's size from its `measured`, and a node without
 * one is drawn `visibility: hidden` until it is measured again. Keeping only
 * the position hid every node for a frame on each of those changes, and when
 * two landed in one batch the re-measure never came: the element's size had
 * not changed, so the ResizeObserver stayed quiet and the canvas stayed empty
 * (node-click on #226: 14 nodes in the DOM, none visible, none in the
 * minimap). A node whose content really changes size is re-measured by that
 * observer as usual.
 */
export function preserveNodePositions(previousNodes: Node[], nextNodes: Node[]): Node[] {
  const previous = new Map(previousNodes.map((node) => [node.id, node]));
  return nextNodes.map((node) => {
    const before = previous.get(node.id);
    if (!before) return node;
    return { ...node, position: before.position, ...(before.measured ? { measured: before.measured } : {}) };
  });
}
