/**
 * Plan-overlay helpers — Phase 26, layer A (frontend side).
 *
 * See [docs/PHASE-26-CODE-FIRST-SURFACE.md](../../../docs/PHASE-26-CODE-FIRST-SURFACE.md).
 *
 * The backend decides *where* a marker goes and whether it could be
 * placed at all; this turns that into a per-line lookup the renderer can
 * use without re-deriving anything.
 */

export type OverlayAnchor = 'lines' | 'symbol' | 'file' | 'unanchored';

export interface OverlayMarker {
  itemUid: string;
  itemTitle: string;
  itemStatus: string | null;
  planUid: string;
  anchor: OverlayAnchor;
  startLine: number | null;
  endLine: number | null;
  instruction: string;
  intent: string | null;
  symbol: string | null;
  reason?: string;
}

export interface FileOverlay {
  relativePath: string;
  markers: OverlayMarker[];
  fileLevel: OverlayMarker[];
  unanchored: OverlayMarker[];
  itemCount: number;
}

/** Everything applying to a given line, in the order it was declared. */
export type OverlayIndex = Map<number, OverlayMarker[]>;

/**
 * Expand each marker's span into a per-line index.
 *
 * Spans are usually small (a function, a handful of lines), so expanding
 * is cheaper and far simpler at render time than an interval search per
 * line — and the file view renders every line anyway.
 */
export function indexMarkers(markers: OverlayMarker[]): OverlayIndex {
  const index: OverlayIndex = new Map();

  for (const marker of markers) {
    if (marker.startLine === null || marker.endLine === null) continue;
    for (let line = marker.startLine; line <= marker.endLine; line++) {
      const bucket = index.get(line);
      if (bucket) bucket.push(marker);
      else index.set(line, [marker]);
    }
  }

  return index;
}

/** True when a line is the first of its marker's span — where the label goes. */
export function isSpanStart(marker: OverlayMarker, line: number): boolean {
  return marker.startLine === line;
}

/**
 * The one-line label for a set of markers on a line.
 *
 * Several items wanting the same lines is a real and interesting state —
 * it usually means two pieces of work will collide — so it is counted
 * rather than hidden behind the first title.
 */
export function markerLabel(markers: OverlayMarker[]): string {
  if (markers.length === 0) return '';
  if (markers.length === 1) return markers[0].itemTitle;
  return `${markers[0].itemTitle} +${markers.length - 1} more`;
}

/** Tailwind tint for a marker, by the intent its author gave it. */
export function intentTint(intent: string | null): string {
  switch (intent) {
    case 'add':
      return 'text-emerald-300';
    case 'remove':
      return 'text-rose-300';
    case 'replace':
    case 'modify':
      return 'text-amber-300';
    default:
      return 'text-accent';
  }
}

/**
 * Whether the overlay has anything at all to say about this file.
 *
 * Used to keep the rail out of the layout entirely when there is nothing
 * in it, rather than rendering an empty column.
 */
export function hasContent(overlay: FileOverlay | null): boolean {
  if (!overlay) return false;
  return overlay.markers.length > 0 || overlay.fileLevel.length > 0 || overlay.unanchored.length > 0;
}
