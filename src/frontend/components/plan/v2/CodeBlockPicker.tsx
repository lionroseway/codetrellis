import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, ChevronDown, FileText, Folder, X, Search } from 'lucide-react';
import { useProjectStore } from '../../../stores/project-store';
import { usePlanItemsStore } from '../../../stores/plan-items-store';
import { useToastStore } from '../../../stores/toast-store';
import type { FileTreeNode } from '@shared/types';

/**
 * Phase 15 §15.D — code-block picker.
 *
 * Two modes:
 *   1. Pick from project — file-tree picker → file → line range
 *      with snapshot. Stores `value: "<rel>:<from>-<to>"` and
 *      keeps the snippet in the attachment label so it survives
 *      file edits (Q2 = (a) — snapshot semantics).
 *   2. Raw paste — fallback when the snippet isn't in the project.
 *
 * Opens as a modal dialog from the AttachmentsPanel.
 */
export function CodeBlockPicker({
  itemUid, onClose,
}: {
  itemUid: string;
  onClose: () => void;
}) {
  const projectRoot = useProjectStore((s) => s.root);
  const fileTree = useProjectStore((s) => s.fileTree);
  const addItemAttachment = usePlanItemsStore((s) => s.addItemAttachment);
  const addToast = useToastStore((s) => s.addToast);

  const [mode, setMode] = useState<'project' | 'raw'>(projectRoot ? 'project' : 'raw');
  const [pickedFile, setPickedFile] = useState<{ path: string; relativePath: string } | null>(null);
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [startLine, setStartLine] = useState(1);
  const [endLine, setEndLine] = useState(20);
  const [filter, setFilter] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Raw-mode state
  const [rawSnippet, setRawSnippet] = useState('');
  const [rawLabel, setRawLabel] = useState('');

  // Load file content when a file is picked.
  useEffect(() => {
    if (!pickedFile) return;
    setLoading(true);
    fetch(`/api/file/content?path=${encodeURIComponent(pickedFile.path)}`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error('fetch failed')))
      .then((data: { content: string }) => {
        setContent(data.content || '');
        setStartLine(1);
        const totalLines = (data.content || '').split('\n').length;
        setEndLine(Math.min(totalLines, 40));
      })
      .catch(() => addToast({ type: 'error', title: 'Could not read file' }))
      .finally(() => setLoading(false));
  }, [pickedFile, addToast]);

  const filteredTree = useMemo(() => {
    if (!filter.trim()) return fileTree;
    const q = filter.toLowerCase();
    const filterNode = (node: FileTreeNode): FileTreeNode | null => {
      if (node.type === 'file') {
        return node.path.toLowerCase().includes(q) || node.name.toLowerCase().includes(q) ? node : null;
      }
      const kept = (node.children ?? []).map(filterNode).filter((n): n is FileTreeNode => n !== null);
      if (kept.length === 0) return null;
      return { ...node, children: kept };
    };
    return fileTree.map(filterNode).filter((n): n is FileTreeNode => n !== null);
  }, [fileTree, filter]);

  const lines = content.split('\n');
  const previewLines = lines.slice(
    Math.max(0, startLine - 1),
    Math.max(0, Math.min(lines.length, endLine)),
  );

  const submitProject = async () => {
    if (!pickedFile || !content) return;
    setSubmitting(true);
    try {
      const snippet = previewLines.join('\n');
      const value = `${pickedFile.relativePath}:${startLine}-${endLine}`;
      // Store the snippet inline AS the attachment value (M2 (a):
      // snapshot semantics — survives file edits). The path+lines
      // live as a separate label-prefix so the renderer can show
      // "src/foo.ts:45-60" + the actual code below.
      const formatted = `// ${value}\n${snippet}`;
      await addItemAttachment(itemUid, {
        kind: 'code_block',
        value: formatted,
        label: value,
      });
      addToast({ type: 'success', title: 'Code block attached', message: value, duration: 3500 });
      onClose();
    } catch (err) {
      addToast({ type: 'error', title: 'Pin failed', message: String(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const submitRaw = async () => {
    if (!rawSnippet.trim()) return;
    setSubmitting(true);
    try {
      await addItemAttachment(itemUid, {
        kind: 'code_block',
        value: rawSnippet,
        label: rawLabel.trim() || undefined,
      });
      addToast({ type: 'success', title: 'Code block attached', duration: 2500 });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl border border-white/[0.08] bg-[#0b1020] shadow-[0_24px_80px_rgba(0,0,0,0.6)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06]">
          <h3 className="text-[13px] font-semibold text-foreground">Add code block</h3>
          <button onClick={onClose} className="p-1.5 rounded-md text-foreground-subtle hover:text-foreground hover:bg-white/[0.05]">
            <X size={14} />
          </button>
        </div>

        <div className="flex items-center gap-1 px-5 pt-3">
          <button
            onClick={() => setMode('project')}
            disabled={!projectRoot}
            className={`px-3 py-1.5 text-[11px] rounded-md transition-colors ${
              mode === 'project'
                ? 'bg-accent/15 text-accent border border-accent/30'
                : 'text-foreground-muted hover:bg-white/[0.04] border border-transparent disabled:opacity-40 disabled:cursor-not-allowed'
            }`}
          >
            Pick from project
          </button>
          <button
            onClick={() => setMode('raw')}
            className={`px-3 py-1.5 text-[11px] rounded-md transition-colors ${
              mode === 'raw'
                ? 'bg-accent/15 text-accent border border-accent/30'
                : 'text-foreground-muted hover:bg-white/[0.04] border border-transparent'
            }`}
          >
            Paste raw
          </button>
        </div>

        {mode === 'project' && (
          <div className="flex-1 overflow-hidden grid grid-cols-[260px_1fr]">
            {/* File tree */}
            <div className="border-r border-white/[0.06] bg-black/20 flex flex-col">
              <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/[0.06]">
                <Search size={11} className="text-foreground-subtle" />
                <input
                  type="text"
                  placeholder="Filter files…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="flex-1 bg-transparent text-[11px] text-foreground placeholder:text-foreground-subtle focus:outline-none"
                />
              </div>
              <div className="flex-1 overflow-y-auto py-1 text-[11px]">
                {filteredTree.length === 0 ? (
                  <p className="px-3 py-4 text-[10.5px] text-foreground-subtle italic">No files match.</p>
                ) : (
                  filteredTree.map((node) => (
                    <TreeNode
                      key={node.path}
                      node={node}
                      depth={0}
                      pickedPath={pickedFile?.path}
                      projectRoot={projectRoot ?? ''}
                      onPickFile={(path, relativePath) => setPickedFile({ path, relativePath })}
                    />
                  ))
                )}
              </div>
            </div>

            {/* Preview + line picker */}
            <div className="flex flex-col overflow-hidden">
              {!pickedFile ? (
                <div className="flex-1 flex items-center justify-center text-[11px] text-foreground-subtle italic">
                  Pick a file to see its contents.
                </div>
              ) : (
                <>
                  <div className="px-4 py-2 border-b border-white/[0.06] flex items-center gap-2 bg-white/[0.015]">
                    <FileText size={11} className="text-foreground-subtle shrink-0" />
                    <span className="text-[11px] font-mono text-foreground truncate flex-1">{pickedFile.relativePath}</span>
                  </div>
                  <div className="px-4 py-2 border-b border-white/[0.04] flex items-center gap-2 text-[11px]">
                    <span className="text-foreground-subtle">Lines:</span>
                    <input
                      type="number"
                      min={1}
                      max={lines.length}
                      value={startLine}
                      onChange={(e) => setStartLine(Math.max(1, Number(e.target.value) || 1))}
                      className="w-16 bg-white/[0.02] border border-white/[0.08] rounded px-1.5 py-0.5 font-mono text-foreground focus:outline-none focus:border-accent/40"
                    />
                    <span className="text-foreground-subtle">–</span>
                    <input
                      type="number"
                      min={1}
                      max={lines.length}
                      value={endLine}
                      onChange={(e) => setEndLine(Math.max(startLine, Number(e.target.value) || startLine))}
                      className="w-16 bg-white/[0.02] border border-white/[0.08] rounded px-1.5 py-0.5 font-mono text-foreground focus:outline-none focus:border-accent/40"
                    />
                    <span className="text-foreground-subtle ml-1">of {lines.length}</span>
                  </div>
                  <div className="flex-1 overflow-auto bg-black/30 px-2 py-2">
                    {loading ? (
                      <p className="text-[11px] text-foreground-subtle italic px-2">Loading…</p>
                    ) : (
                      <pre className="text-[11px] font-mono text-foreground whitespace-pre">
                        {previewLines.map((line, i) => (
                          <div key={i} className="flex">
                            <span className="text-foreground-subtle/60 select-none pr-3 text-right" style={{ minWidth: '3em' }}>
                              {startLine + i}
                            </span>
                            <span className="whitespace-pre">{line || ' '}</span>
                          </div>
                        ))}
                      </pre>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {mode === 'raw' && (
          <div className="flex-1 overflow-auto px-5 py-4 space-y-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-foreground-subtle mb-1">Snippet</label>
              <textarea
                autoFocus
                value={rawSnippet}
                onChange={(e) => setRawSnippet(e.target.value)}
                placeholder="Paste a snippet…"
                className="w-full min-h-[200px] bg-black/30 border border-white/[0.06] rounded-md px-3 py-2 text-[12px] font-mono text-foreground placeholder:text-foreground-subtle focus:outline-none focus:border-accent/30 leading-relaxed resize-y"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-foreground-subtle mb-1">Label (optional)</label>
              <input
                type="text"
                value={rawLabel}
                onChange={(e) => setRawLabel(e.target.value)}
                placeholder="e.g. login validation logic"
                className="w-full bg-white/[0.02] border border-white/[0.08] rounded-md px-3 py-1.5 text-[11.5px] text-foreground focus:outline-none focus:border-accent/40"
              />
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-white/[0.06]">
          <button onClick={onClose} className="px-3 py-1.5 text-[11px] rounded-md text-foreground-muted hover:text-foreground hover:bg-white/[0.04]">
            Cancel
          </button>
          <button
            onClick={mode === 'project' ? submitProject : submitRaw}
            disabled={submitting || (mode === 'project' ? !pickedFile : !rawSnippet.trim())}
            className="px-3 py-1.5 text-[11px] rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Pinning…' : 'Pin code block'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function TreeNode({
  node, depth, pickedPath, projectRoot, onPickFile,
}: {
  node: FileTreeNode;
  depth: number;
  pickedPath: string | undefined;
  projectRoot: string;
  onPickFile: (path: string, relativePath: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1); // expand top-level by default
  const isDir = node.type !== 'file';
  const indent = { paddingLeft: 4 + depth * 12 };

  if (isDir) {
    return (
      <div>
        <button
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center gap-1 py-0.5 hover:bg-white/[0.03] text-foreground-muted"
          style={indent}
        >
          {open ? <ChevronDown size={10} className="text-foreground-subtle" /> : <ChevronRight size={10} className="text-foreground-subtle" />}
          <Folder size={11} className="text-foreground-subtle" />
          <span className="truncate">{node.name}</span>
        </button>
        {open && node.children && (
          <div>
            {node.children.map((c) => (
              <TreeNode
                key={c.path}
                node={c}
                depth={depth + 1}
                pickedPath={pickedPath}
                projectRoot={projectRoot}
                onPickFile={onPickFile}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const relativePath = projectRoot && node.path.startsWith(projectRoot)
    ? node.path.slice(projectRoot.length).replace(/^\/+/, '')
    : node.path;
  const isPicked = pickedPath === node.path;

  return (
    <button
      onClick={() => onPickFile(node.path, relativePath)}
      className={`w-full flex items-center gap-1 py-0.5 hover:bg-white/[0.03] ${
        isPicked ? 'bg-accent/15 text-accent' : 'text-foreground-muted'
      }`}
      style={indent}
    >
      <span className="w-3 shrink-0" />
      <FileText size={11} className={isPicked ? 'text-accent' : 'text-foreground-subtle'} />
      <span className="truncate">{node.name}</span>
    </button>
  );
}
