import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import {
  ArrowRight, ArrowLeft, Braces, Box, Layers, LetterText, List, Hash,
  MousePointerClick, FileCode, Folder, Package, ChevronRight, Code2,
  Maximize2, Minimize2, GitCompare,
} from 'lucide-react';
import { useUiStore, type SelectedNodeKind, type SelectedNodeMeta } from '../../stores/ui-store';
import { useProjectStore } from '../../stores/project-store';
import { usePlanStore } from '../../stores/plan-store';
import { CodePreview, type FileContent } from '../inspector/CodePreview';
/**
 * Phase 26 — the diff editor is lazy.
 *
 * CodeMirror costs ~700 kB of the bundle, and a user who never opens a
 * diff should never pay for it. That is the same argument this phase
 * makes about the graph, so applying it to our own dependency is the
 * consistent thing to do rather than the clever one.
 */
const CodeDiffView = lazy(() =>
  import('../inspector/CodeDiffView').then((m) => ({ default: m.CodeDiffView })),
);
import type { FileOverlay } from '../../lib/plan-overlay';
import { revealPlanItem } from '../../lib/open-plan-item';

interface SymbolInfo {
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  modifiers: string[];
}

interface FileDeps {
  imports: Array<{ path: string; relativePath: string; specifiers: string[] }>;
  importedBy: Array<{ path: string; relativePath: string; specifiers: string[] }>;
}

const KIND_ICON_MAP: Record<string, typeof Braces> = {
  function: Braces, class: Box, method: Braces, interface: Layers, type: LetterText, enum: List, variable: Hash,
};

const KIND_COLORS: Record<string, string> = {
  function: 'text-green-400', class: 'text-blue-400', method: 'text-blue-300',
  interface: 'text-purple-400', type: 'text-purple-300', enum: 'text-yellow-400', variable: 'text-zinc-400',
};

export function InspectorPanel() {
  const visible = useUiStore((s) => s.inspectorVisible);
  const expanded = useUiStore((s) => s.inspectorExpanded);
  const toggleExpanded = useUiStore((s) => s.toggleInspectorExpanded);
  const selectedNodeId = useUiStore((s) => s.selectedNodeId);
  const selectedNodeKind = useUiStore((s) => s.selectedNodeKind);
  const selectedNodeMeta = useUiStore((s) => s.selectedNodeMeta);
  const setSelectedNode = useUiStore((s) => s.setSelectedNode);

  if (!visible) return null;

  return (
    <div className="glass-panel flex flex-col border-l h-full overflow-hidden">
      <div className="flex items-center px-3 py-2.5 border-b border-border-subtle">
        <span className="text-[10px] font-semibold text-foreground-subtle uppercase tracking-[0.1em] flex-1">
          Inspector
        </span>
        <button
          onClick={toggleExpanded}
          className="p-1 rounded text-foreground-subtle hover:text-foreground hover:bg-surface-hover transition-colors"
          title={expanded ? 'Collapse panel' : 'Expand panel'}
        >
          {expanded ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!selectedNodeId ? (
          <EmptyState />
        ) : (
          <InspectorContent
            nodeId={selectedNodeId}
            kind={selectedNodeKind}
            meta={selectedNodeMeta}
            onSelect={setSelectedNode}
          />
        )}
      </div>
    </div>
  );
}

function InspectorContent({
  nodeId,
  kind,
  meta,
  onSelect,
}: {
  nodeId: string;
  kind: SelectedNodeKind;
  meta: SelectedNodeMeta;
  onSelect: (id: string | null, kind?: SelectedNodeKind, meta?: SelectedNodeMeta) => void;
}) {
  // Cluster view: show summary + file list
  if (kind === 'cluster') {
    return <ClusterView nodeId={nodeId} meta={meta} onOpenFile={(p) => onSelect(p, 'file')} />;
  }
  // Symbol view: show symbol meta + the slice of code around it
  if (kind === 'symbol') {
    return <SymbolView meta={meta} onSelectFile={(p) => onSelect(p, 'file')} />;
  }
  // Default: file view
  return <FileView nodeId={nodeId} onSelectFile={(p) => onSelect(p, 'file')} />;
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-foreground-subtle text-xs gap-3 text-center px-4">
      <div className="w-10 h-10 rounded-xl bg-surface border border-border flex items-center justify-center">
        <MousePointerClick size={16} className="text-foreground-subtle" />
      </div>
      <span className="text-[11px]">Click a cluster, file, or symbol to inspect</span>
    </div>
  );
}

function Breadcrumb({ items }: { items: Array<{ icon: React.ReactNode; label: string; onClick?: () => void }> }) {
  return (
    <div className="flex items-center gap-1 text-[10px] text-foreground-subtle mb-2 flex-wrap">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRight size={9} className="text-foreground-subtle/60 shrink-0" />}
          {item.onClick ? (
            <button
              onClick={item.onClick}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-surface-hover hover:text-foreground transition-colors"
            >
              {item.icon}
              <span className="truncate max-w-[140px]">{item.label}</span>
            </button>
          ) : (
            <span className="flex items-center gap-1 px-1.5 py-0.5 text-foreground">
              {item.icon}
              <span className="truncate max-w-[180px]">{item.label}</span>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ===========================================================================
// Cluster view
// ===========================================================================

function ClusterView({
  nodeId,
  meta,
  onOpenFile,
}: {
  nodeId: string;
  meta: SelectedNodeMeta;
  onOpenFile: (path: string) => void;
}) {
  const files = meta.files || [];

  return (
    <div className="p-3 space-y-3">
      <Breadcrumb items={[{ icon: <Package size={10} className="text-accent" />, label: meta.label || nodeId }]} />

      <div>
        <div className="flex items-center gap-2 mb-1">
          <Package size={14} className="text-accent shrink-0 drop-shadow-[0_0_4px_rgba(59,130,246,0.4)]" />
          <h2 className="text-[13px] font-semibold text-foreground">{meta.label || nodeId}</h2>
        </div>
        {meta.description && (
          <p className="text-[10.5px] text-foreground-muted leading-relaxed">{meta.description}</p>
        )}
        <div className="text-[10px] text-foreground-subtle mt-1.5">{files.length} file{files.length === 1 ? '' : 's'}</div>
      </div>

      <div>
        <span className="text-[9px] text-foreground-subtle uppercase tracking-wider font-medium">Files</span>
        <div className="mt-1.5 space-y-0.5">
          {files.length === 0 && (
            <div className="text-[10.5px] text-foreground-subtle py-2">No files attached to this cluster</div>
          )}
          {files.map((relPath) => (
            <button
              key={relPath}
              onClick={() => onOpenFile(relPath)}
              className="w-full text-left flex items-center gap-1.5 py-1 px-2 rounded-md hover:bg-surface-hover transition-colors group"
            >
              <FileCode size={11} className="text-blue-400 shrink-0" />
              <span className="text-[11px] text-foreground-muted font-mono truncate group-hover:text-foreground">
                {relPath.split('/').pop()}
              </span>
              <span className="ml-auto text-[9px] text-foreground-subtle/60 truncate max-w-[120px]">
                {relPath.replace(/\/[^/]+$/, '')}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// File view
// ===========================================================================

function FileView({ nodeId, onSelectFile }: { nodeId: string; onSelectFile: (path: string) => void }) {
  const root = useProjectStore((s) => s.root);
  const driftComparePlanUid = useUiStore((s) => s.driftComparePlanUid);
  const activePlanUid = usePlanStore((s) => s.activePlanUid);
  const effectivePlanUid = driftComparePlanUid ?? activePlanUid ?? null;

  const [symbols, setSymbols] = useState<SymbolInfo[]>([]);
  const [deps, setDeps] = useState<FileDeps | null>(null);
  const [content, setContent] = useState<FileContent | null>(null);
  const [codeMode, setCodeMode] = useState<'read' | 'diff'>('read');
  const [overlay, setOverlay] = useState<FileOverlay | null>(null);
  // Compared against the last commit by default: `scanProject` re-pins
  // the baseline on every run, so baseline → live is empty right after a
  // scan (see PHASE-26 §4).
  const [diffBefore] = useState('commit:HEAD');
  const [showCode, setShowCode] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);

  const absPath = useMemo(() => {
    if (!nodeId) return null;
    if (nodeId.startsWith('/')) return nodeId;
    return root ? `${root}/${nodeId}` : nodeId;
  }, [nodeId, root]);

  useEffect(() => {
    if (!absPath) { setSymbols([]); setDeps(null); setContent(null); setOverlay(null); return; }
    setShowCode(false);
    setContent(null);
    setContentError(null);
    setOverlay(null);

    // Phase 26 — what the plan wants from this file. Fetched with the
    // file rather than on demand, because the count feeds a chip the
    // user sees before opening the source.
    if (root) {
      fetch(
        `/api/file/overlay?path=${encodeURIComponent(absPath)}&project=${encodeURIComponent(root)}`,
      )
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => setOverlay(data && !data.error ? data : null))
        .catch(() => setOverlay(null));
    }

    fetch(`/api/symbols/file?path=${encodeURIComponent(absPath)}`)
      .then((r) => r.json()).then(setSymbols).catch(() => setSymbols([]));

    fetch(`/api/dependencies/file?path=${encodeURIComponent(absPath)}`)
      .then((r) => r.json()).then(setDeps).catch(() => setDeps(null));
  }, [absPath]);

  // Re-fetch file content (and embedded drift) whenever the file or the
  // selected drift comparison plan changes — but only if the user has chosen
  // to view the source.
  useEffect(() => {
    if (!showCode || !absPath) return;
    setContentError(null);
    const projectQuery = root ? `&project=${encodeURIComponent(root)}` : '';
    const planQuery = effectivePlanUid ? `&plan=${encodeURIComponent(effectivePlanUid)}` : '';
    fetch(`/api/file/content?path=${encodeURIComponent(absPath)}${projectQuery}${planQuery}`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.error) { setContentError(data.error); return; }
        setContent(data);
      })
      .catch((err) => setContentError(String(err)));
  }, [showCode, absPath, root, effectivePlanUid]);

  const loadCode = () => setShowCode(true);

  const fileName = nodeId.split('/').pop() || nodeId;

  return (
    <div className="p-3 space-y-3">
      <Breadcrumb items={[{ icon: <FileCode size={10} className="text-blue-400" />, label: fileName }]} />

      <div>
        <div className="flex items-center gap-2 mb-1">
          <FileCode size={14} className="text-blue-400 shrink-0" />
          <h2 className="text-[13px] font-semibold text-foreground truncate">{fileName}</h2>
        </div>
        <p className="text-[10.5px] text-foreground-subtle font-mono break-all">{nodeId}</p>
      </div>

      <button
        onClick={loadCode}
        className={`w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[11px] transition-colors ${
          showCode
            ? 'bg-accent/10 border-accent/30 text-accent'
            : 'bg-white/[0.02] border-white/[0.06] text-foreground-muted hover:bg-white/[0.05] hover:text-foreground hover:border-white/[0.12]'
        }`}
      >
        <Code2 size={11} />
        {showCode ? (content ? 'Hide source' : 'Loading…') : 'View source'}
      </button>

      {showCode && (
        <>
          {/* Phase 26 — reading the file, and diffing it, are the same
              surface. The toggle sits with the code rather than in a
              separate route, because "what does this look like now" and
              "what changed" are one question asked twice. */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setCodeMode('read')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors ${
                codeMode === 'read'
                  ? 'bg-accent/10 text-accent'
                  : 'text-foreground-subtle hover:text-foreground'
              }`}
            >
              <Code2 size={10} /> Source
            </button>
            <button
              onClick={() => setCodeMode('diff')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors ${
                codeMode === 'diff'
                  ? 'bg-accent/10 text-accent'
                  : 'text-foreground-subtle hover:text-foreground'
              }`}
            >
              <GitCompare size={10} /> Diff
            </button>
            {overlay && overlay.itemCount > 0 && (
              <span className="ml-auto text-[9.5px] text-accent">
                {overlay.itemCount} plan item{overlay.itemCount === 1 ? '' : 's'} target this file
              </span>
            )}
          </div>

          {codeMode === 'read' ? (
            <CodePreview
              content={content}
              error={contentError}
              overlay={overlay}
              onClose={() => setShowCode(false)}
              onOpenItem={(itemUid, planUid) => { void revealPlanItem(planUid, itemUid); }}
            />
          ) : root ? (
            <Suspense
              fallback={
                <div className="px-3 py-4 text-[10.5px] text-foreground-subtle">Loading the diff editor…</div>
              }
            >
              <CodeDiffView
                projectPath={root}
                relativePath={nodeId.startsWith('/') ? nodeId.slice(root.length + 1) : nodeId}
                before={diffBefore}
                after="live"
              />
            </Suspense>
          ) : null}
        </>
      )}

      {symbols.length > 0 && (
        <Section label="Symbols" count={symbols.length} accentClass="text-accent">
          <div className="mt-1.5 space-y-0.5">
            {symbols.map((sym) => {
              const Icon = KIND_ICON_MAP[sym.kind] || Hash;
              const color = KIND_COLORS[sym.kind] || 'text-zinc-400';
              return (
                <div
                  key={`${sym.kind}:${sym.name}:${sym.startLine}`}
                  className="flex items-center gap-1.5 py-1 px-2 rounded-md hover:bg-surface-hover transition-colors"
                >
                  <Icon size={11} className={`${color} shrink-0 drop-shadow-[0_0_3px_currentColor]`} />
                  <span className="text-[11px] text-foreground truncate">{sym.name}</span>
                  <span className="text-[9px] text-foreground-subtle ml-auto font-mono">:{sym.startLine}</span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {deps && deps.imports.length > 0 && (
        <Section label="Imports" count={deps.imports.length} accentClass="text-accent">
          <div className="mt-1.5 space-y-0.5">
            {deps.imports.map((imp) => (
              <button
                key={imp.relativePath}
                onClick={() => onSelectFile(imp.relativePath)}
                className="w-full text-left flex items-center gap-1.5 py-1 px-2 rounded-md hover:bg-surface-hover transition-colors group"
              >
                <ArrowRight size={10} className="text-accent shrink-0" />
                <span className="text-[11px] text-foreground-muted font-mono truncate group-hover:text-foreground">{imp.relativePath}</span>
              </button>
            ))}
          </div>
        </Section>
      )}

      {deps && deps.importedBy.length > 0 && (
        <Section label="Imported by" count={deps.importedBy.length} accentClass="text-warning">
          <div className="mt-1.5 space-y-0.5">
            {deps.importedBy.map((imp) => (
              <button
                key={imp.relativePath}
                onClick={() => onSelectFile(imp.relativePath)}
                className="w-full text-left flex items-center gap-1.5 py-1 px-2 rounded-md hover:bg-surface-hover transition-colors group"
              >
                <ArrowLeft size={10} className="text-warning shrink-0" />
                <span className="text-[11px] text-foreground-muted font-mono truncate group-hover:text-foreground">{imp.relativePath}</span>
              </button>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

// ===========================================================================
// Symbol view
// ===========================================================================

function SymbolView({
  meta,
  onSelectFile,
}: {
  meta: SelectedNodeMeta;
  onSelectFile: (path: string) => void;
}) {
  const root = useProjectStore((s) => s.root);
  const driftComparePlanUid = useUiStore((s) => s.driftComparePlanUid);
  const activePlanUid = usePlanStore((s) => s.activePlanUid);
  const effectivePlanUid = driftComparePlanUid ?? activePlanUid ?? null;
  const parentPath = meta.parentFilePath;
  const symbolName = meta.symbolName;
  const symbolKind = meta.symbolKind;
  const [symbols, setSymbols] = useState<SymbolInfo[]>([]);
  const [content, setContent] = useState<FileContent | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);

  const absPath = useMemo(() => {
    if (!parentPath) return null;
    if (parentPath.startsWith('/')) return parentPath;
    return root ? `${root}/${parentPath}` : parentPath;
  }, [parentPath, root]);

  // Find the symbol's line range so we can fetch only the relevant slice
  useEffect(() => {
    if (!absPath) return;
    fetch(`/api/symbols/file?path=${encodeURIComponent(absPath)}`)
      .then((r) => r.json())
      .then((all: SymbolInfo[]) => setSymbols(Array.isArray(all) ? all : []))
      .catch(() => setSymbols([]));
  }, [absPath]);

  const target = useMemo(
    () => symbols.find((s) => s.name === symbolName && (!symbolKind || s.kind === symbolKind)),
    [symbols, symbolName, symbolKind],
  );

  useEffect(() => {
    if (!absPath || !target) return;
    setContent(null);
    setContentError(null);
    const start = Math.max(1, target.startLine - 2);
    const end = target.endLine + 2;
    const projectQuery = root ? `&project=${encodeURIComponent(root)}` : '';
    const planQuery = effectivePlanUid ? `&plan=${encodeURIComponent(effectivePlanUid)}` : '';
    fetch(`/api/file/content?path=${encodeURIComponent(absPath)}&start=${start}&end=${end}${projectQuery}${planQuery}`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.error) { setContentError(data.error); return; }
        setContent(data);
      })
      .catch((err) => setContentError(String(err)));
  }, [absPath, target, root, effectivePlanUid]);

  const Icon = symbolKind ? (KIND_ICON_MAP[symbolKind] || Hash) : Hash;
  const color = symbolKind ? (KIND_COLORS[symbolKind] || 'text-zinc-400') : 'text-zinc-400';

  return (
    <div className="p-3 space-y-3">
      <Breadcrumb
        items={[
          parentPath
            ? { icon: <FileCode size={10} className="text-blue-400" />, label: parentPath.split('/').pop() || parentPath, onClick: () => onSelectFile(parentPath) }
            : { icon: <Folder size={10} />, label: '?' },
          { icon: <Icon size={10} className={color} />, label: symbolName || meta.label || '?' },
        ]}
      />

      <div>
        <div className="flex items-center gap-2 mb-1">
          <Icon size={14} className={`${color} shrink-0 drop-shadow-[0_0_3px_currentColor]`} />
          <h2 className="text-[13px] font-semibold text-foreground truncate">{symbolName || meta.label || '?'}</h2>
        </div>
        {symbolKind && (
          <p className="text-[10px] text-foreground-subtle uppercase tracking-wider">{symbolKind}{target ? ` · lines ${target.startLine}–${target.endLine}` : ''}</p>
        )}
      </div>

      <div>
        <span className="text-[9px] text-foreground-subtle uppercase tracking-wider font-medium">Source</span>
        <CodePreview content={content} error={contentError} highlightLine={target?.startLine} />
      </div>
    </div>
  );
}

// ===========================================================================
// Shared components
// ===========================================================================

function Section({
  label,
  count,
  accentClass,
  children,
}: {
  label: string;
  count: number;
  accentClass: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className="text-[9px] text-foreground-subtle uppercase tracking-wider font-medium">
        {label} <span className={accentClass}>({count})</span>
      </span>
      {children}
    </div>
  );
}

