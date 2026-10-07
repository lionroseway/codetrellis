import { memo, useId, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';

import { edgeVisual, EDGE } from '../../../lib/visual-language';
import { useUiStore } from '../../../stores/ui-store';

interface ImportEdgeData {
  importState?: 'regular' | 'planned_add' | 'planned_remove' | 'active' | 'symbol_link' | 'cross_system' | 'added' | 'removed' | 'unexpected';
  symbols?: string[];
  alwaysShowLabel?: boolean;
  symbolCount?: number;
  /** A cross-system edge's protocol: http, sql, subprocess, env. */
  protocol?: string;
  emphasized?: boolean;
  muted?: boolean;
  /** Phase 33 G8 — the rules this import breaks, with the Rules overlay on. */
  breaches?: string[];
}

/**
 * Colour, dash and label come from the vocabulary (`EDGE` in
 * `visual-language.ts`): import slate solid, cross-system cyan dashed with
 * its protocol in words, symbol link dotted, planned violet dashed, added
 * emerald, removed red, unplanned fuchsia, active blue with flow dots.
 */
function edgeStateOf(state: ImportEdgeData['importState']): string {
  return state === 'regular' || !state ? 'import' : state;
}

function ImportEdgeComponent(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, selected, data, label } = props;
  const edgeData = (data || {}) as ImportEdgeData;
  const [isHovered, setIsHovered] = useState(false);
  // One colour for every cross-system edge; the protocol is in its label,
  // in words, rather than in four more hues that already meant states.
  const breaks = edgeData.breaches && edgeData.breaches.length > 0 ? edgeData.breaches : null;
  const visual = edgeVisual(breaks ? 'breach' : edgeStateOf(edgeData.importState));
  const isCrossSystem = edgeData.importState === 'cross_system';
  const pathId = `${useId()}-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: 0.35,
  });

  const symbolNames = edgeData.symbols && edgeData.symbols.length > 0 ? edgeData.symbols : typeof label === 'string' && label.length > 0 ? label.split(',').map((item) => item.trim()) : [];
  const symbolCount = Math.max(edgeData.symbolCount || symbolNames.length, 1);
  const baseStrokeWidth = Math.min(1.2 + symbolCount * 0.55, 4.4);
  const perf = useUiStore((s) => s.graphStyle) === 'performance';
  // A status edge in performance mode has no glow to set it apart, so it
  // gets the weight instead. Same rule as the cards: the signal moves
  // from a filter to geometry, it does not go away.
  const hasStatus = !!breaks || (Boolean(edgeData.importState) && edgeData.importState !== 'symbol_link' && edgeData.importState !== 'cross_system' && edgeData.importState !== 'regular');
  const statusBoost = perf && hasStatus ? 1.5 : 0;
  const strokeWidth = (edgeData.emphasized ? baseStrokeWidth + 1.5 : baseStrokeWidth) + statusBoost;
  const plainLabel = symbolNames.length > 0 ? `{ ${symbolNames.slice(0, 4).join(', ')}${symbolNames.length > 4 ? ', ...' : ''} }` : typeof label === 'string' ? label : '';
  const labelText = breaks
    ? `${EDGE.breach.glyph} breaks ${breaks.join(', ')}`
    : isCrossSystem
      ? [EDGE.cross_system.glyph, edgeData.protocol ?? EDGE.cross_system.word, typeof label === 'string' ? label : ''].filter(Boolean).join(' ')
      : plainLabel;
  const showLabel = Boolean(labelText && (edgeData.alwaysShowLabel || selected || isHovered || edgeData.emphasized));

  return (
    <>
      <g onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
        <path id={pathId} d={edgePath} fill="none" stroke="transparent" strokeWidth={strokeWidth + 12} />
        {breaks && <title data-testid="edge-breach" data-rules={breaks.join(' ')}>{labelText}</title>}
        <BaseEdge
          id={id}
          path={edgePath}
          markerEnd={markerEnd}
          style={{
            stroke: visual.color,
            strokeWidth,
            strokeDasharray: visual.dashArray,
            // One SVG filter per edge is the single most expensive thing the
            // glass style does: thousands of them, re-rasterised on every
            // pan frame. Hover and selection still get it, since that is one edge.
            filter: perf && !isHovered && !selected ? undefined : `drop-shadow(0 0 ${isHovered || selected ? 10 : 6}px ${visual.glow})`,
            opacity: edgeData.muted ? 0.18 : edgeData.importState === 'planned_remove' ? 0.78 : 1,
          }}
        />

        {/* Animated flow dots — only for states where motion conveys
            meaning (the agent is working, a planned change is about to
            happen, or a change just landed). Animating EVERY regular
            edge with 2k+ edges in big repos pegs the GPU and makes
            pan/zoom feel sluggish. */}
        {(edgeData.importState === 'active' || edgeData.importState === 'planned_add') && (
          <>
            <circle r="3.2" fill={visual.flow}>
              <animateMotion dur={edgeData.importState === 'active' ? '1.6s' : '2.4s'} repeatCount="indefinite" rotate="auto">
                <mpath href={`#${pathId}`} />
              </animateMotion>
            </circle>
            <circle r="2.2" fill={visual.flow} opacity="0.7">
              <animateMotion begin="0.8s" dur={edgeData.importState === 'active' ? '1.6s' : '2.4s'} repeatCount="indefinite" rotate="auto">
                <mpath href={`#${pathId}`} />
              </animateMotion>
            </circle>
          </>
        )}
      </g>

      {showLabel && labelText && (
        <EdgeLabelRenderer>
          <div
            className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border px-2.5 py-1 text-[10px] font-medium ${perf ? '' : 'backdrop-blur-md'} ${visual.label}`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              boxShadow: perf ? undefined : `0 0 18px ${visual.glow}`,
            }}
          >
            {labelText}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const ImportEdge = memo(ImportEdgeComponent);
ImportEdge.displayName = 'ImportEdge';
