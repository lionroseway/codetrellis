/**
 * Phase 17.R — External References panel.
 *
 * Inline panel rendered on the item canvas below the ContextRail.
 * Shows linked external resources (GitHub issues, PRs, Jira tickets,
 * Figma frames, etc.) and lets the user paste a URL to add a new one.
 *
 * The URL kind is auto-detected from the hostname/path, so the user
 * only has to paste — no dropdown needed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Link2,
  Plus,
  X,
  ExternalLink,
  GitPullRequest,
  CircleDot,
  GitCommitHorizontal,
  Figma,
  Slack,
  FileText,
  Globe,
  Ticket,
} from 'lucide-react';
import { useToastStore } from '../../../stores/toast-store';
import type { ExternalRef, ExternalRefKind } from '@shared/types';

// ── Icon map ────────────────────────────────────────────────────────────

const KIND_META: Record<ExternalRefKind, { Icon: typeof Globe; tint: string; label: string }> = {
  github_issue: { Icon: CircleDot, tint: 'text-green-400', label: 'Issue' },
  github_pr: { Icon: GitPullRequest, tint: 'text-purple-400', label: 'PR' },
  github_commit: { Icon: GitCommitHorizontal, tint: 'text-blue-400', label: 'Commit' },
  jira: { Icon: Ticket, tint: 'text-blue-300', label: 'Jira' },
  linear: { Icon: Ticket, tint: 'text-indigo-400', label: 'Linear' },
  figma: { Icon: Figma, tint: 'text-pink-400', label: 'Figma' },
  notion: { Icon: FileText, tint: 'text-foreground-muted', label: 'Notion' },
  slack: { Icon: Slack, tint: 'text-yellow-400', label: 'Slack' },
  url: { Icon: Globe, tint: 'text-foreground-subtle', label: 'Link' },
};

export function ExternalRefsPanel({ itemUid }: { itemUid: string }) {
  const [refs, setRefs] = useState<ExternalRef[]>([]);
  const [showInput, setShowInput] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const addToast = useToastStore((s) => s.addToast);

  // Fetch refs on mount / itemUid change
  const fetchRefs = useCallback(async () => {
    try {
      const res = await fetch(`/api/items/${itemUid}/refs`);
      if (res.ok) setRefs(await res.json());
    } catch { /* silently skip */ }
  }, [itemUid]);

  useEffect(() => { fetchRefs(); }, [fetchRefs]);

  // Focus the input when it appears
  useEffect(() => {
    if (showInput) inputRef.current?.focus();
  }, [showInput]);

  const addRef = async () => {
    const url = urlDraft.trim();
    if (!url) return;

    // Basic URL validation
    try {
      new URL(url.startsWith('http') ? url : `https://${url}`);
    } catch {
      addToast({ type: 'error', title: 'Invalid URL' });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/items/${itemUid}/refs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.startsWith('http') ? url : `https://${url}` }),
      });
      if (!res.ok) throw new Error(await res.text());
      const ref = await res.json();
      setRefs((prev) => [...prev, ref]);
      setUrlDraft('');
      setShowInput(false);
    } catch (err) {
      addToast({ type: 'error', title: 'Failed to add reference', message: String(err) });
    } finally {
      setLoading(false);
    }
  };

  const removeRef = async (uid: string) => {
    try {
      await fetch(`/api/refs/${uid}`, { method: 'DELETE' });
      setRefs((prev) => prev.filter((r) => r.uid !== uid));
    } catch {
      addToast({ type: 'error', title: 'Failed to remove reference' });
    }
  };

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Link2 size={13} className="text-foreground-subtle" />
        <span className="text-[12px] font-semibold text-foreground-muted uppercase tracking-wider flex-1">
          External References
        </span>
        <span className="text-[11px] text-foreground-subtle tabular-nums">
          {refs.length > 0 ? refs.length : ''}
        </span>
        <button
          onClick={() => setShowInput(true)}
          className="flex items-center gap-1 text-[11px] text-foreground-subtle hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-white/[0.04]"
        >
          <Plus size={11} /> Add
        </button>
      </div>

      {/* Ref list */}
      {refs.length > 0 && (
        <div className="space-y-1">
          {refs.map((ref) => {
            const meta = KIND_META[ref.kind] || KIND_META.url;
            const Icon = meta.Icon;
            return (
              <div
                key={ref.uid}
                className="group flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-white/[0.04] bg-white/[0.01] hover:bg-white/[0.03] transition-colors"
              >
                <Icon size={13} className={`${meta.tint} shrink-0`} />
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] text-foreground truncate">
                    {ref.title}
                  </div>
                  <div className="text-[10.5px] text-foreground-subtle truncate font-mono">
                    {shortenUrl(ref.url)}
                  </div>
                </div>
                <span className="text-[10px] text-foreground-subtle/50 uppercase tracking-wider hidden group-hover:inline shrink-0">
                  {meta.label}
                </span>
                <a
                  href={ref.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground-subtle hover:text-accent shrink-0 transition-colors"
                  title="Open in browser"
                >
                  <ExternalLink size={11} />
                </a>
                <button
                  onClick={() => removeRef(ref.uid)}
                  className="text-foreground-subtle/40 hover:text-red-400 shrink-0 opacity-0 group-hover:opacity-100 transition-all"
                  title="Remove"
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Inline URL input */}
      {showInput && (
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addRef();
              if (e.key === 'Escape') { setShowInput(false); setUrlDraft(''); }
            }}
            placeholder="Paste a URL (GitHub, Jira, Figma, etc.)…"
            className="flex-1 bg-white/[0.03] border border-white/[0.08] rounded-md px-2.5 py-1.5 text-[12.5px] text-foreground placeholder:text-foreground-subtle/40 focus:outline-none focus:border-accent/40"
            disabled={loading}
          />
          <button
            onClick={addRef}
            disabled={loading || !urlDraft.trim()}
            className="px-2.5 py-1.5 text-[12px] rounded-md bg-accent/80 text-white hover:bg-accent disabled:opacity-40 transition-colors"
          >
            {loading ? '...' : 'Add'}
          </button>
          <button
            onClick={() => { setShowInput(false); setUrlDraft(''); }}
            className="text-foreground-subtle hover:text-foreground transition-colors"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Empty state — show when no refs and input is closed */}
      {refs.length === 0 && !showInput && (
        <button
          onClick={() => setShowInput(true)}
          className="w-full py-2 rounded-lg border border-dashed border-white/[0.06] text-[11.5px] text-foreground-subtle hover:text-foreground hover:border-white/[0.12] transition-colors"
        >
          Paste a URL to link an issue, PR, or design…
        </button>
      )}
    </div>
  );
}

function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 40 ? u.pathname.slice(0, 37) + '...' : u.pathname;
    return u.hostname + path;
  } catch {
    return url.slice(0, 60);
  }
}
