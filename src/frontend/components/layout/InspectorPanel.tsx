import { useEffect, useState } from 'react';
import { ArrowRight, ArrowLeft, Braces, Box, Layers, LetterText, List, Hash, MousePointerClick } from 'lucide-react';
import { useUiStore } from '../../stores/ui-store';
import { useProjectStore } from '../../stores/project-store';

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
  const width = useUiStore((s) => s.inspectorWidth);
  const selectedNodeId = useUiStore((s) => s.selectedNodeId);
  const root = useProjectStore((s) => s.root);

  const [symbols, setSymbols] = useState<SymbolInfo[]>([]);
  const [deps, setDeps] = useState<FileDeps | null>(null);

  useEffect(() => {
    if (!selectedNodeId || !root) { setSymbols([]); setDeps(null); return; }
    const absPath = selectedNodeId.startsWith('/') ? selectedNodeId : `${root}/${selectedNodeId}`;

    fetch(`/api/symbols/file?path=${encodeURIComponent(absPath)}`)
      .then((r) => r.json()).then(setSymbols).catch(() => setSymbols([]));

    fetch(`/api/dependencies/file?path=${encodeURIComponent(absPath)}`)
      .then((r) => r.json()).then(setDeps).catch(() => setDeps(null));
  }, [selectedNodeId, root]);

  if (!visible) return null;

  return (
    <div className="glass-panel flex flex-col border-l h-full overflow-hidden">
      <div className="flex items-center px-3 py-2.5 border-b border-border-subtle">
        <span className="text-[10px] font-semibold text-foreground-subtle uppercase tracking-[0.1em]">Inspector</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {selectedNodeId ? (
          <div className="space-y-4">
            <div>
              <span className="text-[9px] text-foreground-subtle uppercase tracking-wider font-medium">File</span>
              <p className="text-[11px] text-foreground font-mono mt-1 break-all leading-relaxed bg-surface rounded-md px-2 py-1.5 border border-border-subtle">
                {selectedNodeId}
              </p>
            </div>

            {symbols.length > 0 && (
              <div>
                <span className="text-[9px] text-foreground-subtle uppercase tracking-wider font-medium">
                  Symbols <span className="text-accent">({symbols.length})</span>
                </span>
                <div className="mt-1.5 space-y-0.5">
                  {symbols.map((sym) => {
                    const Icon = KIND_ICON_MAP[sym.kind] || Hash;
                    const color = KIND_COLORS[sym.kind] || 'text-zinc-400';
                    return (
                      <div key={`${sym.kind}:${sym.name}:${sym.startLine}`} className="flex items-center gap-1.5 py-1 px-2 rounded-md hover:bg-surface-hover transition-colors">
                        <Icon size={11} className={`${color} shrink-0 drop-shadow-[0_0_3px_currentColor]`} />
                        <span className="text-[11px] text-foreground truncate">{sym.name}</span>
                        <span className="text-[9px] text-foreground-subtle ml-auto font-mono">:{sym.startLine}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {deps && deps.imports.length > 0 && (
              <div>
                <span className="text-[9px] text-foreground-subtle uppercase tracking-wider font-medium">
                  Imports <span className="text-accent">({deps.imports.length})</span>
                </span>
                <div className="mt-1.5 space-y-0.5">
                  {deps.imports.map((imp) => (
                    <div key={imp.relativePath} className="flex items-center gap-1.5 py-1 px-2 rounded-md hover:bg-surface-hover transition-colors">
                      <ArrowRight size={10} className="text-accent shrink-0" />
                      <span className="text-[11px] text-foreground-muted font-mono truncate">{imp.relativePath}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {deps && deps.importedBy.length > 0 && (
              <div>
                <span className="text-[9px] text-foreground-subtle uppercase tracking-wider font-medium">
                  Imported By <span className="text-warning">({deps.importedBy.length})</span>
                </span>
                <div className="mt-1.5 space-y-0.5">
                  {deps.importedBy.map((imp) => (
                    <div key={imp.relativePath} className="flex items-center gap-1.5 py-1 px-2 rounded-md hover:bg-surface-hover transition-colors">
                      <ArrowLeft size={10} className="text-warning shrink-0" />
                      <span className="text-[11px] text-foreground-muted font-mono truncate">{imp.relativePath}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-foreground-subtle text-xs gap-3 text-center">
            <div className="w-10 h-10 rounded-xl bg-surface border border-border flex items-center justify-center">
              <MousePointerClick size={16} className="text-foreground-subtle" />
            </div>
            <span className="text-[11px]">Click a node to inspect</span>
          </div>
        )}
      </div>
    </div>
  );
}
