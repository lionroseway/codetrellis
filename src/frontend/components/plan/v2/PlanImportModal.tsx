/**
 * Phase 17.I — Import Plan from External Sources.
 *
 * Modal with tabs for each import source:
 *   - GitHub Issue: paste a URL or issue body
 *   - Conversation: paste a transcript from any agent
 *   - Git Diff: paste a unified diff
 *   - Claude Session: paste JSONL from a session file
 *
 * After parsing, shows a preview of what will be created, then
 * creates the plan + items on confirm.
 */

import { useCallback, useState } from 'react';
import {
  X,
  Import,
  GitPullRequest,
  MessageSquare,
  GitCompare,
  Sparkles,
  Loader2,
  FileText,
  Zap,
} from 'lucide-react';
import { usePlanStore } from '../../../stores/plan-store';
import { useProjectStore } from '../../../stores/project-store';
import { useUiStore } from '../../../stores/ui-store';
import { useToastStore } from '../../../stores/toast-store';

type ImportSource = 'github_issue' | 'conversation' | 'git_diff' | 'claude_session';

const SOURCE_META: Record<ImportSource, { label: string; Icon: typeof Import; description: string; placeholder: string }> = {
  github_issue: {
    label: 'GitHub Issue',
    Icon: GitPullRequest,
    description: 'Paste a GitHub issue body. Checklists become tasks.',
    placeholder: '## Bug: Login fails on mobile\n\n- [ ] Fix the auth redirect\n- [ ] Add mobile viewport test\n- [ ] Update the error message',
  },
  conversation: {
    label: 'Conversation',
    Icon: MessageSquare,
    description: 'Paste an agent transcript or planning conversation. Steps and headers become tasks.',
    placeholder: '# Refactor the auth module\n\n1. Extract token validation into its own service\n2. Add refresh token rotation\n3. Update all callers of the old validateToken()',
  },
  git_diff: {
    label: 'Git Diff',
    Icon: GitCompare,
    description: 'Paste a unified diff (git diff output). Each changed file becomes a task.',
    placeholder: 'diff --git a/src/auth/token.ts b/src/auth/token.ts\n--- a/src/auth/token.ts\n+++ b/src/auth/token.ts\n@@ -1,5 +1,10 @@\n ...',
  },
  claude_session: {
    label: 'Claude Session',
    Icon: Sparkles,
    description: 'Paste JSONL from a Claude Code session file (~/.claude/sessions/). File edits become tasks.',
    placeholder: '{"type":"human","message":"Refactor the auth module..."}\n{"type":"tool_use","name":"Edit","input":{"file_path":"src/auth/token.ts",...}}',
  },
};

export function PlanImportModal({ onClose }: { onClose: () => void }) {
  const [source, setSource] = useState<ImportSource>('github_issue');
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const projectRoot = useProjectStore((s) => s.root);
  const fetchPlans = usePlanStore((s) => s.fetchPlans);
  const setActivePlan = usePlanStore((s) => s.setActivePlan);
  const setWorkspaceMode = useUiStore((s) => s.setWorkspaceMode);
  const addToast = useToastStore((s) => s.addToast);

  const handleImport = useCallback(async () => {
    if (!content.trim() || !projectRoot) return;
    setLoading(true);

    try {
      // Build the request body based on source
      let body: Record<string, unknown> = { source, projectPath: projectRoot };

      switch (source) {
        case 'github_issue':
          body = { ...body, title: title || 'Imported from GitHub issue', body: content };
          break;
        case 'conversation':
          body = { ...body, text: content, title: title || undefined };
          break;
        case 'git_diff':
          body = { ...body, diff: content, title: title || undefined };
          break;
        case 'claude_session':
          body = { ...body, jsonl: content, title: title || undefined };
          break;
      }

      const res = await fetch('/api/plans/import-external', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const result = await res.json();
      await fetchPlans(projectRoot);
      await setActivePlan(result.plan.uid);
      setWorkspaceMode('plan');

      addToast({
        type: 'success',
        title: 'Plan imported',
        message: `Created "${result.plan.title}" with ${result.itemCount} items from ${result.source.replace('_', ' ')}.`,
      });
      onClose();
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Import failed',
        message: String(err instanceof Error ? err.message : err),
      });
    } finally {
      setLoading(false);
    }
  }, [source, content, title, projectRoot, fetchPlans, setActivePlan, setWorkspaceMode, addToast, onClose]);

  const meta = SOURCE_META[source];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[680px] max-h-[85vh] bg-[#0c0e1a] border border-white/[0.10] rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.7)] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.06]">
          <Import size={16} className="text-accent" />
          <h2 className="text-[15px] font-semibold text-foreground flex-1">Import Plan</h2>
          <button onClick={onClose} className="text-foreground-subtle hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Source tabs */}
        <div className="flex border-b border-white/[0.06] px-2">
          {(Object.entries(SOURCE_META) as Array<[ImportSource, typeof SOURCE_META.github_issue]>).map(
            ([key, m]) => {
              const Icon = m.Icon;
              const isActive = key === source;
              return (
                <button
                  key={key}
                  onClick={() => setSource(key)}
                  className={`flex items-center gap-1.5 px-3.5 py-2.5 text-[12px] border-b-2 transition-colors ${
                    isActive
                      ? 'border-accent text-accent'
                      : 'border-transparent text-foreground-subtle hover:text-foreground'
                  }`}
                >
                  <Icon size={12} />
                  {m.label}
                </button>
              );
            },
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <p className="text-[12.5px] text-foreground-subtle">{meta.description}</p>

          {/* Optional title override */}
          <div>
            <label className="text-[11px] text-foreground-muted uppercase tracking-wider font-medium block mb-1.5">
              Plan title (optional)
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Auto-detected from content"
              className="w-full bg-white/[0.03] border border-white/[0.08] rounded-md px-3 py-2 text-[13px] text-foreground placeholder:text-foreground-subtle/40 focus:outline-none focus:border-accent/40"
            />
          </div>

          {/* Main content area */}
          <div>
            <label className="text-[11px] text-foreground-muted uppercase tracking-wider font-medium block mb-1.5">
              Content
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={meta.placeholder}
              rows={14}
              className="w-full bg-white/[0.03] border border-white/[0.08] rounded-md px-3 py-2.5 text-[12.5px] text-foreground font-mono placeholder:text-foreground-subtle/30 focus:outline-none focus:border-accent/40 resize-none leading-relaxed"
            />
          </div>

          {/* Preview hint */}
          {content.trim() && (
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-1.5">
              <div className="text-[11px] text-foreground-muted uppercase tracking-wider font-medium">
                Preview
              </div>
              <ImportPreview source={source} content={content} title={title} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-white/[0.06]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[12.5px] text-foreground-muted hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!content.trim() || !projectRoot || loading}
            className="flex items-center gap-2 px-4 py-2 text-[12.5px] rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-40 transition-colors shadow-[0_0_10px_rgba(59,130,246,0.15)]"
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <Import size={13} />}
            Import as plan
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Quick client-side preview of what will be extracted.
 */
function ImportPreview({ source, content, title }: { source: ImportSource; content: string; title: string }) {
  // Simple client-side parsing for preview — mirrors the backend logic
  const items: Array<{ kind: string; title: string }> = [];

  if (source === 'github_issue' || source === 'conversation') {
    const checklistPattern = /^[-*]\s+\[[ x]\]\s+(.+)$/gm;
    const numberedPattern = /^\d+\.\s+(.+)$/gm;
    const headerPattern = /^#{2,3}\s+(.+)$/gm;

    let m: RegExpExecArray | null;
    while ((m = checklistPattern.exec(content)) !== null) {
      items.push({ kind: 'action', title: m[1].trim() });
    }
    if (items.length === 0) {
      while ((m = numberedPattern.exec(content)) !== null) {
        if (m[1].length > 5) items.push({ kind: 'action', title: m[1] });
      }
    }
    if (items.length === 0) {
      while ((m = headerPattern.exec(content)) !== null) {
        items.push({ kind: 'action', title: m[1] });
      }
    }
  } else if (source === 'git_diff') {
    const diffFilePattern = /^diff --git a\/(.+?) b\/(.+?)$/gm;
    let m: RegExpExecArray | null;
    while ((m = diffFilePattern.exec(content)) !== null) {
      items.push({ kind: 'action', title: m[2] });
    }
  } else if (source === 'claude_session') {
    const lines = content.split('\n').filter((l) => l.trim());
    for (const line of lines.slice(0, 20)) {
      try {
        const entry = JSON.parse(line);
        if ((entry.type === 'tool_use' || entry.type === 'tool_call') && (entry.name === 'Write' || entry.name === 'Edit')) {
          const fp = entry.input?.file_path ?? entry.input?.path ?? '';
          if (fp) items.push({ kind: 'action', title: `${entry.name} ${fp.split('/').pop()}` });
        }
      } catch { /* */ }
    }
  }

  if (items.length === 0) {
    return <p className="text-[11.5px] text-foreground-subtle">No structured items detected. Plan will be created with description only.</p>;
  }

  return (
    <div className="space-y-0.5 max-h-[120px] overflow-y-auto">
      <p className="text-[11px] text-foreground-subtle mb-1">{items.length} items detected:</p>
      {items.slice(0, 10).map((item, i) => (
        <div key={i} className="flex items-center gap-2 text-[11.5px]">
          {item.kind === 'action' ? (
            <Zap size={10} className="text-accent shrink-0" />
          ) : (
            <FileText size={10} className="text-foreground-subtle shrink-0" />
          )}
          <span className="text-foreground-muted truncate">{item.title}</span>
        </div>
      ))}
      {items.length > 10 && (
        <p className="text-[10px] text-foreground-subtle/60">...and {items.length - 10} more</p>
      )}
    </div>
  );
}
