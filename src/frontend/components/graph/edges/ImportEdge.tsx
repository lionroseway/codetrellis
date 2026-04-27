import { memo, useId, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';

interface ImportEdgeData {
  importState?: 'regular' | 'planned_add' | 'planned_remove' | 'active' | 'symbol_link' | 'added' | 'removed' | 'unexpected';
  symbols?: string[];
  alwaysShowLabel?: boolean;
  symbolCount?: number;
  emphasized?: boolean;
  muted?: boolean;
}

function edgeVisuals(state: ImportEdgeData['importState']) {
  switch (state) {
    case 'planned_add':
      return {
        color: 'rgba(34, 197, 94, 0.82)',
        glow: 'rgba(34, 197, 94, 0.42)',
        dashArray: '8 8',
        flow: '#86efac',
      };
    case 'planned_remove':
      return {
        color: 'rgba(248, 113, 113, 0.82)',
        glow: 'rgba(239, 68, 68, 0.34)',
        dashArray: '5 8',
        flow: '#f87171',
      };
    case 'added':
      return {
        color: 'rgba(52, 211, 153, 0.9)',
        glow: 'rgba(16, 185, 129, 0.42)',
        dashArray: undefined,
        flow: '#6ee7b7',
      };
    case 'unexpected':
      // Drift — a new edge that no plan called for. Solid magenta-red so it
      // pops next to the green planned/realized adds.
      return {
        color: 'rgba(244, 63, 94, 0.95)',
        glow: 'rgba(244, 63, 94, 0.5)',
        dashArray: undefined,
        flow: '#fb7185',
      };
    case 'removed':
      return {
        color: 'rgba(248, 113, 113, 0.9)',
        glow: 'rgba(239, 68, 68, 0.4)',
        dashArray: '6 6',
        flow: '#fca5a5',
      };
    case 'active':
      return {
        color: 'rgba(96, 165, 250, 0.9)',
        glow: 'rgba(59, 130, 246, 0.42)',
        dashArray: undefined,
        flow: '#bfdbfe',
      };
    case 'symbol_link':
      return {
        color: 'rgba(255, 255, 255, 0.22)',
        glow: 'rgba(255, 255, 255, 0.12)',
        dashArray: '4 8',
        flow: '#e4e4e7',
      };
    default:
      return {
        color: 'rgba(96, 165, 250, 0.7)',
        glow: 'rgba(59, 130, 246, 0.28)',
        dashArray: undefined,
        flow: '#93c5fd',
      };
  }
}

function ImportEdgeComponent(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, selected, data, label } = props;
  const edgeData = (data || {}) as ImportEdgeData;
  const [isHovered, setIsHovered] = useState(false);
  const visual = edgeVisuals(edgeData.importState);
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
  const strokeWidth = edgeData.emphasized ? baseStrokeWidth + 1.5 : baseStrokeWidth;
  const labelText = symbolNames.length > 0 ? `{ ${symbolNames.slice(0, 4).join(', ')}${symbolNames.length > 4 ? ', ...' : ''} }` : typeof label === 'string' ? label : '';
  const showLabel = Boolean(labelText && (edgeData.alwaysShowLabel || selected || isHovered || edgeData.emphasized));

  return (
    <>
      <g onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
        <path id={pathId} d={edgePath} fill="none" stroke="transparent" strokeWidth={strokeWidth + 12} />
        <BaseEdge
          id={id}
          path={edgePath}
          markerEnd={markerEnd}
          style={{
            stroke: visual.color,
            strokeWidth,
            strokeDasharray: visual.dashArray,
            filter: `drop-shadow(0 0 ${isHovered || selected ? 10 : 6}px ${visual.glow})`,
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
            className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border px-2.5 py-1 text-[10px] font-medium backdrop-blur-md ${
              edgeData.importState === 'planned_remove' || edgeData.importState === 'removed'
                ? 'border-red-300/20 bg-red-500/12 text-red-100 line-through'
                : edgeData.importState === 'unexpected'
                  ? 'border-rose-300/30 bg-rose-500/15 text-rose-100'
                  : edgeData.importState === 'planned_add' || edgeData.importState === 'added'
                    ? 'border-emerald-300/20 bg-emerald-500/12 text-emerald-100'
                    : 'border-white/10 bg-[#0b1120]/78 text-zinc-100'
            }`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              boxShadow: `0 0 18px ${visual.glow}`,
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
