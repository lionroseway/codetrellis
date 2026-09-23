import { useState } from 'react';
import { Check, Hash } from 'lucide-react';
import { formatReference, formatReferenceLine, shortId, type ReferenceKind } from '@shared/lib/references';

/**
 * A reference you can paste to an agent — `#9f2c41ab`, click to copy.
 *
 * Steering an agent means pointing at things: "task 9f2c41ab isn't right,
 * I've left notes". This puts a line like `task 9f2c41ab "Q3 revenue
 * summary" (plan "Board pack")` on the clipboard, and every MCP tool accepts
 * the reference in place of a uid (resolved once, in `mcp/server.ts`).
 *
 * Quiet by design (Phase 29 §3): the same size and tone as the metadata
 * around it, never louder than what it sits beside.
 */
export function CopyRef({
  kind,
  uid,
  title,
  within,
  className = '',
}: {
  kind: ReferenceKind;
  uid: string;
  title?: string | null;
  within?: { kind: ReferenceKind; uid: string; title?: string | null } | null;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const line = formatReferenceLine({ kind, uid, title, within });

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(line);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard refused — nothing useful to say beyond the tooltip */
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      // The tooltip names the reference only, not the item's title: a title
      // attribute carrying user text would match any `[title*=…]` lookup
      // aimed at the controls beside it. The full line is in `data-ref`.
      title={`Copy a reference to this ${kind} for an agent: ${formatReference(kind, uid)}`}
      data-testid={`copy-ref-${kind}`}
      data-ref={line}
      className={`inline-flex items-center gap-0.5 font-mono text-[10px] text-foreground-subtle hover:text-foreground rounded px-1 py-0.5 hover:bg-white/[0.05] transition-colors ${className}`}
    >
      {copied ? <Check size={10} className="text-green-400" /> : <Hash size={10} />}
      {copied ? 'copied' : shortId(uid)}
    </button>
  );
}
