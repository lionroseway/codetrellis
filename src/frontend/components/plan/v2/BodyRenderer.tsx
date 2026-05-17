import { useMemo } from 'react';
import { FileText, Zap, Hash, Folder } from 'lucide-react';
import { usePlanItemsStore } from '../../../stores/plan-items-store';
import { Markdown } from '../../../lib/markdown';

/**
 * Phase 15 §15.D.2 — body renderer with inline chip support.
 *
 * Parses these chip syntaxes from the body markdown:
 *
 *   - `[[item:UID|title]]`          → plan item chip (Object or Action)
 *   - `[[action:UID|title]]`        → alias for item chip (Action kind)
 *   - `[[file:path|label]]`         → code file reference chip
 *   - `[[symbol:name@path|label]]`  → code symbol reference chip
 *   - `[[attach:uid|label]]`        → attachment reference chip
 *
 * Splits the markdown source on chip patterns; each segment is either
 * a plain markdown chunk (rendered via the existing `Markdown`
 * component) or a clickable chip with a kind icon + title.
 *
 * Falls back to plain markdown rendering when no chips are present —
 * zero overhead for bodies that don't use the chip feature.
 *
 * Source-of-truth lives in the body text. Chip syntax round-trips
 * unchanged through edit ↔ display so users can write chips by hand
 * if they want, and the @ mention menu just inserts the same syntax.
 */

// Matches all chip patterns:
//   [[item:UUID|title]]
//   [[action:UUID|title]]
//   [[file:path|label]]
//   [[symbol:name@path|label]]
//   [[attach:UUID|label]]
const CHIP_PATTERN = /\[\[(item|action|file|symbol|attach):([^\]|]+)\|([^\]]*)\]\]/gi;

interface ItemChipNode {
  type: 'chip';
  chipKind: 'item' | 'action';
  uid: string;
  title: string;
}

interface FileChipNode {
  type: 'file-chip';
  path: string;
  label: string;
}

interface SymbolChipNode {
  type: 'symbol-chip';
  name: string;
  filePath: string;
  label: string;
}

interface AttachChipNode {
  type: 'attach-chip';
  uid: string;
  label: string;
}

interface MarkdownNode {
  type: 'markdown';
  source: string;
}

type Node = ItemChipNode | FileChipNode | SymbolChipNode | AttachChipNode | MarkdownNode;

function splitSource(source: string): Node[] {
  if (!source) return [];
  const nodes: Node[] = [];
  let lastIndex = 0;
  CHIP_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CHIP_PATTERN.exec(source)) !== null) {
    const [full, kindRaw, value, title] = match;
    const start = match.index;
    if (start > lastIndex) {
      nodes.push({ type: 'markdown', source: source.slice(lastIndex, start) });
    }
    const kind = kindRaw.toLowerCase();
    if (kind === 'item' || kind === 'action') {
      nodes.push({
        type: 'chip',
        chipKind: kind === 'action' ? 'action' : 'item',
        uid: value,
        title: (title || 'untitled').trim(),
      });
    } else if (kind === 'file') {
      nodes.push({
        type: 'file-chip',
        path: value,
        label: (title || value.split('/').pop() || 'file').trim(),
      });
    } else if (kind === 'symbol') {
      // value = "name@path" or just "name"
      const atIdx = value.indexOf('@');
      const name = atIdx >= 0 ? value.slice(0, atIdx) : value;
      const filePath = atIdx >= 0 ? value.slice(atIdx + 1) : '';
      nodes.push({
        type: 'symbol-chip',
        name,
        filePath,
        label: (title || name).trim(),
      });
    } else if (kind === 'attach') {
      nodes.push({
        type: 'attach-chip',
        uid: value,
        label: (title || 'attachment').trim(),
      });
    }
    lastIndex = start + full.length;
  }
  if (lastIndex < source.length) {
    nodes.push({ type: 'markdown', source: source.slice(lastIndex) });
  }
  return nodes;
}

export function BodyRenderer({ source }: { source: string }) {
  const itemsByUid = usePlanItemsStore((s) => s.itemsByUid);
  const selectItem = usePlanItemsStore((s) => s.selectItem);

  const nodes = useMemo(() => splitSource(source), [source]);

  // Fast path — no chips.
  if (nodes.length === 1 && nodes[0].type === 'markdown') {
    return <Markdown source={nodes[0].source} />;
  }
  if (nodes.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1">
      {nodes.map((node, i) => {
        if (node.type === 'markdown') {
          return <Markdown key={i} source={node.source} />;
        }

        if (node.type === 'chip') {
          const live = itemsByUid[node.uid];
          const liveTitle = live?.title || node.title;
          const liveKind = live?.kind ?? node.chipKind;
          const exists = !!live;
          const Icon = liveKind === 'action' ? Zap : FileText;
          return (
            <button
              key={i}
              onClick={() => exists && selectItem(node.uid)}
              disabled={!exists}
              title={exists ? `Open ${liveKind === 'action' ? 'Action' : 'Object'}` : 'Linked item not found (deleted?)'}
              className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-md border text-[14px] mr-1.5 mb-1 align-baseline transition-colors ${
                exists
                  ? liveKind === 'action'
                    ? 'border-accent/30 bg-accent/[0.08] text-accent hover:bg-accent/15'
                    : 'border-white/[0.08] bg-white/[0.04] text-foreground-muted hover:bg-white/[0.08] hover:text-foreground'
                  : 'border-red-500/30 bg-red-500/[0.06] text-red-300 line-through opacity-70 cursor-not-allowed'
              }`}
            >
              <Icon size={13} className={liveKind === 'action' ? 'text-accent' : 'text-foreground-subtle'} />
              <span className="truncate max-w-[280px]">{liveTitle}</span>
            </button>
          );
        }

        if (node.type === 'file-chip') {
          const isDir = node.path.endsWith('/');
          const Icon = isDir ? Folder : FileText;
          return (
            <span
              key={i}
              title={node.path}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-300 text-[13.5px] font-mono mr-1.5 mb-1 align-baseline cursor-default"
            >
              <Icon size={13} className="text-emerald-400" />
              <span className="truncate max-w-[260px]">{node.label}</span>
            </span>
          );
        }

        if (node.type === 'symbol-chip') {
          return (
            <span
              key={i}
              title={node.filePath ? `${node.name} in ${node.filePath}` : node.name}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-cyan-500/30 bg-cyan-500/[0.06] text-cyan-300 text-[13.5px] font-mono mr-1.5 mb-1 align-baseline cursor-default"
            >
              <Hash size={13} className="text-cyan-400" />
              <span className="truncate max-w-[260px]">{node.label}</span>
            </span>
          );
        }

        if (node.type === 'attach-chip') {
          return (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-white/[0.08] bg-white/[0.04] text-foreground-muted text-[13.5px] mr-1.5 mb-1 align-baseline cursor-default"
            >
              <FileText size={13} className="text-foreground-subtle" />
              <span className="truncate max-w-[260px]">{node.label}</span>
            </span>
          );
        }

        return null;
      })}
    </div>
  );
}
