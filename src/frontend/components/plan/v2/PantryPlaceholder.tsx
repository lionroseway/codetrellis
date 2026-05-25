/**
 * PantryPlaceholder — Phase 7.1.
 *
 * Displays a styled placeholder when an attachment reference cannot be
 * resolved locally. External contributors see this instead of broken
 * images or missing file errors. Shows the reason and suggests
 * requesting access from the item author.
 */

import { EyeOff, Lock, FileQuestion } from 'lucide-react';

interface PantryPlaceholderProps {
  /** The original reference that couldn't be resolved */
  reference: string;
  /** Why the reference is unresolvable */
  reason?: string;
  /** Author of the item (for "request access from..." text) */
  author?: string;
  /** Visual size: compact for inline, normal for card view */
  size?: 'compact' | 'normal';
}

export function PantryPlaceholder({
  reference,
  reason,
  author,
  size = 'normal',
}: PantryPlaceholderProps) {
  const isUserData = reference.startsWith('userdata://');
  const Icon = isUserData ? Lock : FileQuestion;

  if (size === 'compact') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-zinc-800/60 text-zinc-400 border border-zinc-700/50">
        <EyeOff size={9} />
        <span>Team-only content</span>
      </span>
    );
  }

  return (
    <div className="flex items-start gap-3 p-3 rounded-md border border-dashed border-zinc-700/60 bg-zinc-900/40">
      <div className="flex-shrink-0 mt-0.5 p-1.5 rounded bg-zinc-800/60">
        <Icon size={14} className="text-zinc-500" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-zinc-400">
          {isUserData ? 'User-local content' : 'Team-only content'}
        </p>
        {reason && (
          <p className="mt-0.5 text-[10px] text-zinc-500 leading-relaxed">
            {reason}
          </p>
        )}
        {author && (
          <p className="mt-1 text-[10px] text-zinc-500">
            Request access from <span className="text-zinc-400">{author}</span>
          </p>
        )}
        <p className="mt-1 text-[9px] text-zinc-600 font-mono truncate">
          {reference}
        </p>
      </div>
    </div>
  );
}

/**
 * Badge showing the count of unresolved pantry references on a plan card.
 */
export function PantryBadge({ externalCount }: { externalCount: number }) {
  if (externalCount === 0) return null;

  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-zinc-800/50 text-zinc-400 border border-zinc-700/40">
      <EyeOff size={8} />
      {externalCount} team-only
    </span>
  );
}
