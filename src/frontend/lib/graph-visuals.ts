import type { CSSProperties } from 'react';

import { alpha, chipClass, GRAPH_CHROME, languageOf, minimapColor, nodeChange } from './visual-language';

export type GraphDirection = 'inbound' | 'outbound';

export interface GraphNodeVisualData {
  label?: string;
  fullPath?: string;
  language?: string;
  symbolCount?: number;
  connectionCount?: number;
  isHub?: boolean;
  isFocused?: boolean;
  direction?: GraphDirection;
  exports?: string[];
  changeStatus?: string;
  ghost?: boolean;
  taskDescription?: string;
  taskNumber?: number;
  done?: boolean;
  frozen?: boolean;
  nodeType?: string;
  childCount?: number;
  topFiles?: string[];
  expanded?: boolean;
  symbolKind?: string;
  mode?: string;
  gitStates?: string[];
  [key: string]: unknown;
}

export interface LanguageVisual {
  accent: string;
  glow: string;
  bg: string;
  badge: string;
  shortLabel: string;
}

export interface ChangeVisual {
  symbol: string;
  tone: string;
  glow: string;
  /** The state in words, for the chip's hover. */
  word: string;
}

/**
 * Language is identity: it colours the file icon only. The glow, ground
 * and badge are neutral, so a Python file never reads as an added one
 * (Phase 33 G1; the vocabulary is `visual-language.ts`).
 */
export function getLanguageVisual(language?: string): LanguageVisual {
  const lang = languageOf(language);
  return {
    accent: lang.hex,
    glow: GRAPH_CHROME.glow,
    bg: GRAPH_CHROME.iconGround,
    badge: GRAPH_CHROME.badge,
    shortLabel: lang.short,
  };
}

/** A node's change status as the vocabulary draws it: its chip and glow. */
export function getChangeVisual(changeStatus?: string): ChangeVisual | null {
  const change = nodeChange(changeStatus);
  if (!change) return null;
  return {
    symbol: change.symbol,
    tone: chipClass(change.state.tone),
    glow: alpha(change.state.tone, 0.36),
    word: change.state.word,
  };
}

/** The colour the minimap paints a node, by its change status. */
export function minimapNodeColor(node: { data?: Record<string, unknown> }): string {
  return minimapColor(node.data?.changeStatus);
}

export function getNodeDimensions(data: GraphNodeVisualData): { width: number; height: number } {
  if (data.nodeType === 'symbol') return { width: 190, height: 60 };
  if (data.nodeType === 'directory') return { width: 230, height: 78 };
  if (data.nodeType === 'package') {
    return data.isFocused ? { width: 320, height: 190 } : { width: 260, height: 136 };
  }

  const connectionCount = data.connectionCount || 0;

  if (data.isFocused) {
    return {
      width: 280 + Math.min(connectionCount, 8) * 6,
      height: 190 + Math.min((data.exports?.length || 0), 6) * 10,
    };
  }

  if (data.isHub) {
    return {
      width: 220 + Math.min(connectionCount, 6) * 5,
      height: 112 + Math.min((data.exports?.length || 0), 4) * 8,
    };
  }

  if (data.ghost) return { width: 210, height: 92 };

  return {
    width: 164 + Math.min(connectionCount, 6) * 6,
    height: 70,
  };
}

export function getLanguageLabel(language?: string): string {
  return getLanguageVisual(language).shortLabel;
}

/**
 * The same colour as a glow, at full strength.
 *
 * Glows are stored as translucent rgba because a blurred shadow needs the
 * transparency. An outline needs the opposite, because a 3px line at 30%
 * alpha reads as nothing.
 */
export function solidOf(rgba: string, a = 1): string {
  const m = rgba.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  return m ? `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${a})` : rgba;
}

export interface StatusOutlineInput {
  /** The glow colour the glass style would have used. */
  glow: string;
  /** A change status is present: this node is the news. */
  changed: boolean;
  /** Planned but not yet done. Drawn dashed, like the ghost card border. */
  planned?: boolean;
  /** Work in progress on this node right now. Glass pulses it. */
  live?: boolean;
  focused?: boolean;
  planHighlighted?: boolean;
}

/**
 * Performance-mode replacement for the status glow.
 *
 * Visual identification is a core feature. The graph exists so you can
 * see which files an agent touched without reading anything. So this
 * does not tone the signal down. It moves it from a blurred halo, which
 * costs a filter pass per frame, to an outline, which is painted once.
 *
 *   changed           3px solid, status colour
 *   planned           3px dashed, status colour (not happened yet)
 *   live / pulsing    5px double, status colour (motion becomes shape)
 *   focused           +1px and offset, so selection reads over status
 *   plan-highlighted  3px dashed planned violet, when nothing else claims it
 *   otherwise         1px in the language colour: identity, not news
 *
 * `outline` rather than `border` so the card's layout never shifts when
 * a status arrives, and rather than `box-shadow` because the stylesheet
 * strips shadows from nodes in this mode.
 */
export function statusOutline(input: StatusOutlineInput): CSSProperties {
  const color = solidOf(input.glow, 0.95);
  if (input.live) {
    return { outline: `${input.focused ? 6 : 5}px double ${color}`, outlineOffset: input.focused ? 3 : 1 };
  }
  if (input.changed) {
    return {
      outline: `${input.focused ? 4 : 3}px ${input.planned ? 'dashed' : 'solid'} ${color}`,
      outlineOffset: input.focused ? 3 : 0,
    };
  }
  if (input.planHighlighted) {
    return { outline: `3px dashed ${alpha('planned', 0.95)}`, outlineOffset: input.focused ? 3 : 0 };
  }
  if (input.focused) {
    return { outline: `3px solid ${alpha('select', 0.85)}`, outlineOffset: 3 };
  }
  return { outline: `1px solid ${solidOf(input.glow, 0.45)}`, outlineOffset: 0 };
}

/**
 * Below this zoom a card's detail is unreadable (an 11px chip at 0.4 is
 * 4px), so performance mode stops mounting it and draws only the name
 * at a size that still reads, plus the status outline. Glass keeps full
 * detail at every zoom, since that mode chooses fidelity over speed.
 */
export const LOD_ZOOM = 0.4;

/**
 * Zoomed-out status: the whole card becomes the signal.
 *
 * An outline is drawn in graph units, so a 3px line at zoom 0.12 is a
 * third of a screen pixel and simply vanishes, which is worse than the
 * glass glow it replaced, since a 36px blur still reads as a smudge of
 * colour from far out. Found by screenshotting a Diff with real changes
 * at fit-view zoom and seeing no status at all.
 *
 * So below LOD_ZOOM a changed card fills with its status colour and
 * carries an 8px outline. A block of colour is identifiable at any
 * zoom, and it costs a flat paint.
 */
export function farStatusStyle(input: StatusOutlineInput): CSSProperties {
  const base = statusOutline(input);
  const hasSignal = input.changed || input.live || input.planHighlighted;
  if (!hasSignal) return base;
  const color = input.planHighlighted && !input.changed && !input.live ? alpha('planned', 1) : solidOf(input.glow);
  return {
    ...base,
    outlineWidth: input.live ? 12 : 8,
    background: solidOf(color, input.planned ? 0.45 : 0.8),
  };
}
