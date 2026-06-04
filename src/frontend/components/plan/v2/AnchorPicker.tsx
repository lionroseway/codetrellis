import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, FileText, Folder, Hash, ChevronRight, ChevronDown, X, Clock,
} from 'lucide-react';
import { useProjectStore } from '../../../stores/project-store';
import type { FileTreeNode } from '@shared/types';

/**
 * Phase 15 §15.D — Anchor Picker.
 *
 * The unified browse-or-search picker for code anchors. Replaces the
 * OS file dialog (modal, leaves the app, doesn't show symbols) with
 * an in-app modal that knows the project structure and graph.
 *
 * Two modes, same component:
 *   - **Empty / browse mode** — file tree on the left side, click a
 *     file to expand its symbols on the right. Click into folders to
 *     drill in. Recent picks at the bottom.
 *   - **Search mode** — start typing, the tree collapses and a
 *     grouped results list appears: matching folders, files, and
 *     symbols (live from `/api/symbols/search`) interleaved.
 *
 * Tabs across the top filter the result kind: All / Files / Folders /
 * Symbols / Recent. ↑↓ navigates; Enter picks; Esc closes.
 *
 * The picker doesn't decide whether the result becomes a target or a
 * reference — the caller does, via `onPick`. That keeps it reusable
 * for any rail / form that needs an anchor.
 *
 * Recent picks are stored per-plan in localStorage so the picker
 * leads with what you've used before.
 */

export type AnchorKind = 'file' | 'folder' | 'symbol';
export type AnchorTab = 'all' | 'files' | 'folders' | 'symbols' | 'recent';

export interface AnchorSelection {
  kind: AnchorKind;
  /** project-relative path for file/folder; symbol name for symbols */
  value: string;
  /** human-readable label (file basename, folder basename, symbol name) */
  label: string;
  /** for symbols — the file the symbol lives in (project-relative) */
  filePath?: string;
  /** for symbols — function/class/interface/etc. */
  symbolKind?: string;
}

export interface AnchorPickerProps {
  /** Whether to allow each kind. e.g. when picking a "folder target",
   *  pass { folder: true } and the others as false. */
  allow?: { file?: boolean; folder?: boolean; symbol?: boolean };
  /** Title shown at the top of the modal. */
  title?: string;
  /** Plan uid — namespaces the recent picks. */
  planUid?: string;
  onPick: (selection: AnchorSelection) => void;
  onClose: () => void;
}

interface SymbolMatch {
  name: string;
  kind: string;
  filePath: string;
  relativePath: string;
  startLine: number;
  endLine: number;
}

const RECENT_KEY = (planUid?: string) =>
  `codetrellis:recent-anchors:${planUid ?? 'global'}`;
const RECENT_MAX = 12;

function readRecent(planUid?: string): AnchorSelection[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY(planUid));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function pushRecent(sel: AnchorSelection, planUid?: string): void {
  try {
    const existing = readRecent(planUid).filter((r) =>
      !(r.kind === sel.kind && r.value === sel.value && r.filePath === sel.filePath));
    const next = [sel, ...existing].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY(planUid), JSON.stringify(next));
  } catch { /* localStorage may be disabled — picker still works */ }
}

export function AnchorPicker({
  allow = { file: true, folder: true, symbol: true },
  title = 'Browse project',
  planUid,
  onPick,
  onClose,
}: AnchorPickerProps) {
  const fileTree = useProjectStore((s) => s.fileTree);
  const projectRoot = useProjectStore((s) => s.root);

  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<AnchorTab>('all');
  const [activeIdx, setActiveIdx] = useState(0);
  const [symbolMatches, setSymbolMatches] = useState<SymbolMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [recent, setRecent] = useState<AnchorSelection[]>(() => readRecent(planUid));
  const [selectedFile, setSelectedFile] = useState<FileTreeNode | null>(null);
  const [fileSymbols, setFileSymbols] = useState<SymbolMatch[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close on Escape, focus the input on mount.
  useEffect(() => {
    inputRef.current?.focus();
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Debounced symbol search.
  useEffect(() => {
    if (!query.trim() || query.length < 2) { setSymbolMatches([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/symbols/search?q=${encodeURIComponent(query)}`);
        const json = (await res.json()) as SymbolMatch[];
        setSymbolMatches(Array.isArray(json) ? json.slice(0, 30) : []);
      } catch {
        setSymbolMatches([]);
      } finally {
        setSearching(false);
      }
    }, 180);
  }, [query]);

  // When a file is selected (browse mode), fetch its symbols.
  useEffect(() => {
    if (!selectedFile || selectedFile.type !== 'file') {
      setFileSymbols([]);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/symbols/file?path=${encodeURIComponent(selectedFile.path)}`);
        const json = await res.json();
        // server returns { name, kind, startLine, endLine, modifiers }[]
        // — re-shape into SymbolMatch for the renderer.
        const rel = projectRoot && selectedFile.path.startsWith(projectRoot)
          ? selectedFile.path.slice(projectRoot.length).replace(/^\//, '')
          : selectedFile.path;
        const symbols: SymbolMatch[] = Array.isArray(json) ? json.map((s: any) => ({
          name: s.name,
          kind: s.kind,
          filePath: selectedFile.path,
          relativePath: rel,
          startLine: s.startLine,
          endLine: s.endLine,
        })) : [];
        setFileSymbols(symbols);
      } catch {
        setFileSymbols([]);
      }
    })();
  }, [selectedFile, projectRoot]);

  // Flatten file tree into a searchable list.
  const flatNodes = useMemo(() => flattenTree(fileTree), [fileTree]);

  // Filter the flat list by query.
  const queryLower = query.trim().toLowerCase();
  const matchedFiles = useMemo(() => {
    if (!queryLower) return [];
    return flatNodes
      .filter((n) => n.type === 'file')
      .filter((n) => n.name.toLowerCase().includes(queryLower)
        || n.path.toLowerCase().includes(queryLower))
      .slice(0, 30);
  }, [flatNodes, queryLower]);

  const matchedFolders = useMemo(() => {
    if (!queryLower) return [];
    return flatNodes
      .filter((n) => n.type === 'directory' || n.type === 'package')
      .filter((n) => n.name.toLowerCase().includes(queryLower)
        || n.path.toLowerCase().includes(queryLower))
      .slice(0, 30);
  }, [flatNodes, queryLower]);

  // Build the visible result list (flat, for keyboard navigation),
  // honoring the active tab + allow flags.
  const visible = useMemo(() => {
    const out: VisibleItem[] = [];
    const showFiles = allow.file !== false && (tab === 'all' || tab === 'files');
    const showFolders = allow.folder !== false && (tab === 'all' || tab === 'folders');
    const showSymbols = allow.symbol !== false && (tab === 'all' || tab === 'symbols');
    const showRecent = tab === 'all' || tab === 'recent';

    // No query → browse mode (show recent + file tree on left).
    if (!queryLower) {
      if (showRecent && recent.length > 0) {
        out.push({ kind: 'header', label: 'Recent' });
        for (const r of recent) {
          if (r.kind === 'file' && !showFiles) continue;
          if (r.kind === 'folder' && !showFolders) continue;
          if (r.kind === 'symbol' && !showSymbols) continue;
          out.push({ kind: 'recent', selection: r });
        }
      }
      // We don't list the whole tree linearly; use the side panel instead.
      return out;
    }

    if (showFolders && matchedFolders.length > 0) {
      out.push({ kind: 'header', label: 'Folders' });
      for (const n of matchedFolders) {
        out.push({ kind: 'folder', node: n });
      }
    }
    if (showFiles && matchedFiles.length > 0) {
      out.push({ kind: 'header', label: 'Files' });
      for (const n of matchedFiles) {
        out.push({ kind: 'file', node: n });
      }
    }
    if (showSymbols && symbolMatches.length > 0) {
      out.push({ kind: 'header', label: 'Symbols' });
      for (const s of symbolMatches) {
        out.push({ kind: 'symbol', match: s });
      }
    }
    return out;
  }, [queryLower, tab, allow, matchedFiles, matchedFolders, symbolMatches, recent]);

  // Keyboard navigation skips header rows.
  const pickableIndices = useMemo(() => visible
    .map((v, i) => v.kind === 'header' ? -1 : i)
    .filter((i) => i >= 0), [visible]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query, tab]);

  const moveActive = (delta: number) => {
    if (pickableIndices.length === 0) return;
    const cur = pickableIndices.indexOf(activeIdx);
    const next = cur < 0
      ? (delta > 0 ? pickableIndices[0] : pickableIndices[pickableIndices.length - 1])
      : pickableIndices[(cur + delta + pickableIndices.length) % pickableIndices.length];
    setActiveIdx(next);
    // Scroll active into view.
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-anchor-row="${next}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    });
  };

  const choose = (sel: AnchorSelection) => {
    pushRecent(sel, planUid);
    setRecent(readRecent(planUid));
    onPick(sel);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveActive(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const item = visible[activeIdx];
      if (!item || item.kind === 'header') return;
      choose(visibleToSelection(item, projectRoot));
    } else if (e.key === 'Tab') {
      e.preventDefault();
      cycleTab(e.shiftKey ? -1 : 1);
    }
  };

  const tabs: AnchorTab[] = ['all'];
  if (allow.file !== false) tabs.push('files');
  if (allow.folder !== false) tabs.push('folders');
  if (allow.symbol !== false) tabs.push('symbols');
  tabs.push('recent');

  const cycleTab = (delta: number) => {
    const idx = tabs.indexOf(tab);
    const next = (idx + delta + tabs.length) % tabs.length;
    setTab(tabs[next]);
  };

  // Click-outside to close (modal backdrop).
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-start justify-center pt-20 px-4 bg-black/70 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKey}
        className="w-full max-w-3xl max-h-[70vh] flex flex-col rounded-2xl border border-white/[0.1] bg-[#0d0e16] shadow-2xl shadow-black/80 overflow-hidden"
      >
        {/* Header / search bar */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.08]">
          <Search size={18} className="text-foreground-subtle shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`${title} — type to search files / folders / symbols`}
            className="flex-1 bg-transparent text-[16px] text-foreground placeholder:text-foreground-subtle focus:outline-none"
          />
          {searching && <span className="text-[12px] text-foreground-subtle">Searching…</span>}
          <button
            onClick={onClose}
            className="p-1.5 rounded text-foreground-subtle hover:text-foreground hover:bg-white/[0.06]"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-white/[0.06] text-[12.5px]">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                tab === t
                  ? 'bg-accent/15 text-accent border border-accent/30'
                  : 'text-foreground-muted hover:text-foreground hover:bg-white/[0.04] border border-transparent'
              }`}
            >
              {t === 'all' ? 'All' : t === 'recent' ? 'Recent' : capitalize(t)}
            </button>
          ))}
          <div className="flex-1" />
          <span className="text-[11px] text-foreground-subtle">
            ↑↓ navigate · ↵ pick · Tab cycle · Esc close
          </span>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* When there's no query, show browse panes (tree + symbols).
              When the user is searching, show the result list. */}
          {!queryLower ? (
            <BrowsePanes
              fileTree={fileTree}
              allow={allow}
              selectedFile={selectedFile}
              onSelectFile={setSelectedFile}
              fileSymbols={fileSymbols}
              recent={recent}
              tab={tab}
              choose={choose}
              projectRoot={projectRoot}
            />
          ) : (
            <SearchResults
              visible={visible}
              activeIdx={activeIdx}
              onHover={setActiveIdx}
              choose={choose}
              projectRoot={projectRoot}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Visible row types
// ---------------------------------------------------------------------------

type VisibleItem =
  | { kind: 'header'; label: string }
  | { kind: 'file'; node: FileTreeNode }
  | { kind: 'folder'; node: FileTreeNode }
  | { kind: 'symbol'; match: SymbolMatch }
  | { kind: 'recent'; selection: AnchorSelection };

function visibleToSelection(item: VisibleItem, projectRoot: string | null): AnchorSelection {
  if (item.kind === 'file') {
    const rel = relativise(item.node.path, projectRoot);
    return { kind: 'file', value: rel, label: item.node.name };
  }
  if (item.kind === 'folder') {
    const rel = relativise(item.node.path, projectRoot);
    return { kind: 'folder', value: rel.endsWith('/') ? rel : `${rel}/`, label: `${item.node.name}/` };
  }
  if (item.kind === 'symbol') {
    return {
      kind: 'symbol',
      value: item.match.name,
      label: item.match.name,
      filePath: item.match.relativePath,
      symbolKind: item.match.kind,
    };
  }
  if (item.kind === 'recent') {
    return item.selection;
  }
  // 'header' — never passed as a pickable; satisfy the type-checker
  // with a defensive default that callers can ignore.
  return { kind: 'file', value: '', label: '' };
}

function relativise(abs: string, projectRoot: string | null): string {
  if (!projectRoot) return abs;
  if (abs === projectRoot) return '';
  if (abs.startsWith(projectRoot + '/')) return abs.slice(projectRoot.length + 1);
  return abs;
}

// ---------------------------------------------------------------------------
// Search results panel
// ---------------------------------------------------------------------------

function SearchResults({
  visible, activeIdx, onHover, choose, projectRoot,
}: {
  visible: VisibleItem[];
  activeIdx: number;
  onHover: (i: number) => void;
  choose: (sel: AnchorSelection) => void;
  projectRoot: string | null;
}) {
  if (visible.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-foreground-subtle text-[13px] p-8">
        No matches — try a different word or check that a project is open.
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto">
      {visible.map((item, i) => {
        if (item.kind === 'header') {
          return (
            <div
              key={`h-${i}`}
              className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-[0.1em] font-semibold text-foreground-subtle"
            >
              {item.label}
            </div>
          );
        }
        return (
          <button
            key={`r-${i}`}
            data-anchor-row={i}
            onMouseEnter={() => onHover(i)}
            onClick={() => choose(visibleToSelection(item, projectRoot))}
            className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors ${
              activeIdx === i ? 'bg-accent/10' : 'hover:bg-white/[0.04]'
            }`}
          >
            <RowIcon item={item} />
            <RowLabel item={item} />
          </button>
        );
      })}
    </div>
  );
}

function RowIcon({ item }: { item: VisibleItem }) {
  if (item.kind === 'file') return <FileText size={15} className="text-foreground-subtle shrink-0" />;
  if (item.kind === 'folder') return <Folder size={15} className="text-amber-300 shrink-0" />;
  if (item.kind === 'symbol') return <Hash size={15} className="text-cyan-300 shrink-0" />;
  if (item.kind === 'recent') {
    if (item.selection.kind === 'file') return <FileText size={15} className="text-foreground-subtle shrink-0" />;
    if (item.selection.kind === 'folder') return <Folder size={15} className="text-amber-300 shrink-0" />;
    if (item.selection.kind === 'symbol') return <Hash size={15} className="text-cyan-300 shrink-0" />;
  }
  return null;
}

function RowLabel({ item }: { item: VisibleItem }) {
  if (item.kind === 'file' || item.kind === 'folder') {
    return (
      <div className="flex-1 min-w-0">
        <div className="text-[14px] text-foreground truncate">{item.node.name}</div>
        <div className="text-[12px] font-mono text-foreground-subtle truncate">{item.node.path}</div>
      </div>
    );
  }
  if (item.kind === 'symbol') {
    return (
      <>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-mono text-foreground truncate">{item.match.name}</div>
          <div className="text-[12px] font-mono text-foreground-subtle truncate">{item.match.relativePath}</div>
        </div>
        <span className="text-[10.5px] uppercase tracking-wider px-2 py-0.5 rounded border border-white/[0.08] bg-white/[0.02] text-foreground-subtle shrink-0">
          {item.match.kind}
        </span>
      </>
    );
  }
  if (item.kind === 'recent') {
    return (
      <>
        <Clock size={11} className="text-foreground-subtle shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[14px] text-foreground truncate">{item.selection.label}</div>
          <div className="text-[12px] font-mono text-foreground-subtle truncate">
            {item.selection.filePath ?? item.selection.value}
          </div>
        </div>
        <span className="text-[10.5px] uppercase tracking-wider px-2 py-0.5 rounded border border-white/[0.08] bg-white/[0.02] text-foreground-subtle shrink-0">
          {item.selection.kind}
        </span>
      </>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Browse panes (no query — tree on the left, symbols on the right)
// ---------------------------------------------------------------------------

function BrowsePanes({
  fileTree, allow, selectedFile, onSelectFile, fileSymbols, recent, tab, choose, projectRoot,
}: {
  fileTree: FileTreeNode[];
  allow: AnchorPickerProps['allow'];
  selectedFile: FileTreeNode | null;
  onSelectFile: (n: FileTreeNode | null) => void;
  fileSymbols: SymbolMatch[];
  recent: AnchorSelection[];
  tab: AnchorTab;
  choose: (sel: AnchorSelection) => void;
  projectRoot: string | null;
}) {
  const showRecent = tab === 'all' || tab === 'recent';
  const showSymbolsPane = allow?.symbol !== false;

  return (
    <>
      {/* Left: file tree */}
      <div className="flex-1 min-w-0 overflow-y-auto border-r border-white/[0.06] py-2">
        {showRecent && recent.length > 0 && (
          <div className="pb-2 mb-2 border-b border-white/[0.04]">
            <div className="px-4 pt-2 pb-1 text-[11px] uppercase tracking-[0.1em] font-semibold text-foreground-subtle">
              Recent
            </div>
            {recent.slice(0, 6).map((r, i) => (
              <button
                key={`recent-${i}`}
                onClick={() => choose(r)}
                className="w-full text-left px-4 py-1.5 flex items-center gap-2.5 hover:bg-white/[0.04]"
              >
                {r.kind === 'file' && <FileText size={13} className="text-foreground-subtle shrink-0" />}
                {r.kind === 'folder' && <Folder size={13} className="text-amber-300 shrink-0" />}
                {r.kind === 'symbol' && <Hash size={13} className="text-cyan-300 shrink-0" />}
                <span className="text-[13px] text-foreground truncate flex-1">{r.label}</span>
                <span className="text-[11px] font-mono text-foreground-subtle truncate max-w-[40%]">
                  {r.filePath ?? r.value}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="px-4 pt-1 pb-1 text-[11px] uppercase tracking-[0.1em] font-semibold text-foreground-subtle">
          Project
        </div>
        {fileTree.length === 0 ? (
          <p className="px-4 py-3 text-[12.5px] text-foreground-subtle italic">
            No project scanned yet. Open a project from the top bar.
          </p>
        ) : (
          <TreeNodes
            nodes={fileTree}
            depth={0}
            allow={allow}
            selectedFile={selectedFile}
            onSelectFile={onSelectFile}
            choose={choose}
            projectRoot={projectRoot}
          />
        )}
      </div>

      {/* Right: symbols of selected file (collapsed if disallowed) */}
      {showSymbolsPane && (
        <div className="w-[300px] shrink-0 overflow-y-auto py-2">
          <div className="px-4 pt-1 pb-1 text-[11px] uppercase tracking-[0.1em] font-semibold text-foreground-subtle">
            Symbols
          </div>
          {!selectedFile ? (
            <p className="px-4 py-3 text-[12.5px] text-foreground-subtle italic">
              Pick a file on the left to see its symbols.
            </p>
          ) : selectedFile.type !== 'file' ? (
            <p className="px-4 py-3 text-[12.5px] text-foreground-subtle italic">
              {selectedFile.name} is a folder. Pick a file inside it.
            </p>
          ) : fileSymbols.length === 0 ? (
            <p className="px-4 py-3 text-[12.5px] text-foreground-subtle italic">
              No symbols indexed for this file (yet). Use the search box above to find symbols across the project.
            </p>
          ) : (
            <div>
              <div className="px-4 pb-1 text-[11.5px] font-mono text-foreground-subtle truncate">
                {relativise(selectedFile.path, projectRoot)}
              </div>
              {fileSymbols.map((s, i) => (
                <button
                  key={`fs-${i}`}
                  onClick={() => choose({
                    kind: 'symbol',
                    value: s.name,
                    label: s.name,
                    filePath: s.relativePath,
                    symbolKind: s.kind,
                  })}
                  className="w-full text-left px-4 py-1.5 flex items-center gap-2.5 hover:bg-white/[0.04]"
                >
                  <Hash size={13} className="text-cyan-300 shrink-0" />
                  <span className="font-mono text-[13px] text-foreground truncate flex-1">{s.name}</span>
                  <span className="text-[10px] uppercase tracking-wider text-foreground-subtle shrink-0">
                    {s.kind}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function TreeNodes({
  nodes, depth, allow, selectedFile, onSelectFile, choose, projectRoot,
}: {
  nodes: FileTreeNode[];
  depth: number;
  allow: AnchorPickerProps['allow'];
  selectedFile: FileTreeNode | null;
  onSelectFile: (n: FileTreeNode | null) => void;
  choose: (sel: AnchorSelection) => void;
  projectRoot: string | null;
}) {
  return (
    <>
      {nodes.map((node, i) => (
        <TreeNode
          key={`${node.path}-${i}`}
          node={node}
          depth={depth}
          allow={allow}
          selectedFile={selectedFile}
          onSelectFile={onSelectFile}
          choose={choose}
          projectRoot={projectRoot}
        />
      ))}
    </>
  );
}

function TreeNode({
  node, depth, allow, selectedFile, onSelectFile, choose, projectRoot,
}: {
  node: FileTreeNode;
  depth: number;
  allow: AnchorPickerProps['allow'];
  selectedFile: FileTreeNode | null;
  onSelectFile: (n: FileTreeNode | null) => void;
  choose: (sel: AnchorSelection) => void;
  projectRoot: string | null;
}) {
  const isFolder = node.type === 'directory' || node.type === 'package';
  const [open, setOpen] = useState(depth < 1);
  const isActiveFile = selectedFile?.path === node.path;

  const onClick = () => {
    if (isFolder) {
      setOpen((v) => !v);
    } else {
      // File click: select to show its symbols on the right pane.
      onSelectFile(node);
    }
  };

  const onPickThis = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isFolder) {
      choose({
        kind: 'folder',
        value: relativise(node.path, projectRoot) + (relativise(node.path, projectRoot).endsWith('/') ? '' : '/'),
        label: `${node.name}/`,
      });
    } else {
      choose({
        kind: 'file',
        value: relativise(node.path, projectRoot),
        label: node.name,
      });
    }
  };

  // Hide kinds the caller disallowed (folders only for folder picker etc.)
  if (isFolder && allow?.folder === false && allow?.symbol === false) {
    // Folders kept as navigation aid even if not pickable, unless we
    // also disallow symbols (because then the user can only pick
    // files — folders still help navigation).
  }

  return (
    <>
      <div
        className={`group flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-white/[0.04] ${
          isActiveFile ? 'bg-accent/10' : ''
        }`}
        style={{ paddingLeft: `${12 + depth * 14}px` }}
        onClick={onClick}
      >
        {isFolder ? (
          <button onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }} className="text-foreground-subtle">
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="w-3" />
        )}
        {isFolder ? (
          <Folder size={13} className="text-amber-300 shrink-0" />
        ) : (
          <FileText size={13} className="text-foreground-subtle shrink-0" />
        )}
        <span className="text-[13px] text-foreground truncate flex-1">{node.name}</span>
        {((isFolder && allow?.folder !== false) || (!isFolder && allow?.file !== false)) && (
          <button
            onClick={onPickThis}
            className="opacity-0 group-hover:opacity-100 text-[11px] px-2 py-0.5 rounded bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25"
          >
            Pick
          </button>
        )}
        {!isFolder && typeof node.symbolCount === 'number' && node.symbolCount > 0 && (
          <span className="text-[10.5px] text-foreground-subtle shrink-0">{node.symbolCount}</span>
        )}
      </div>
      {isFolder && open && node.children && node.children.length > 0 && (
        <TreeNodes
          nodes={node.children}
          depth={depth + 1}
          allow={allow}
          selectedFile={selectedFile}
          onSelectFile={onSelectFile}
          choose={choose}
          projectRoot={projectRoot}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flattenTree(nodes: FileTreeNode[], out: FileTreeNode[] = []): FileTreeNode[] {
  if (!Array.isArray(nodes)) return out;
  for (const n of nodes) {
    out.push(n);
    if (n.children) flattenTree(n.children, out);
  }
  return out;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
