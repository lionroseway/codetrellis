import { useState, useEffect, useRef, useCallback } from 'react';
import { Folder, ChevronUp, X } from 'lucide-react';

interface DirEntry {
  name: string;
  path: string;
}

export function FolderPickerModal() {
  const [open, setOpen] = useState(false);
  const [pathValue, setPathValue] = useState('');
  const [dirs, setDirs] = useState<DirEntry[]>([]);
  const [currentDir, setCurrentDir] = useState('');
  const [parentDir, setParentDir] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const browse = useCallback(async (dirPath?: string) => {
    try {
      const url = dirPath
        ? `/api/fs/browse?path=${encodeURIComponent(dirPath)}`
        : '/api/fs/browse';
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      setDirs(data.dirs);
      setCurrentDir(data.current);
      setParentDir(data.parent);
      setPathValue(data.current);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const handler = () => {
      setOpen(true);
      browse();
    };
    window.addEventListener('open-folder-picker', handler);
    return () => window.removeEventListener('open-folder-picker', handler);
  }, [browse]);

  const done = (path: string | null) => {
    window.dispatchEvent(new CustomEvent('folder-picked', { detail: { path } }));
    setOpen(false);
    setPathValue('');
    setDirs([]);
  };

  const handlePathSubmit = () => {
    const v = pathValue.trim();
    if (v) done(v);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => done(null)}>
      <div className="bg-surface-solid/95 backdrop-blur-xl border border-white/[0.08] rounded-2xl shadow-[0_0_40px_rgba(0,0,0,0.5)] w-[520px] max-h-[480px] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-4 pt-4 pb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Open Project</h2>
          <button onClick={() => done(null)} className="text-foreground-subtle hover:text-foreground">
            <X size={14} />
          </button>
        </div>

        {/* Path input + go up */}
        <div className="px-4 pb-2 flex gap-2">
          <button
            onClick={() => parentDir !== currentDir && browse(parentDir)}
            className="px-2 py-1.5 text-xs bg-background border border-border rounded-md hover:bg-surface-hover transition-colors text-foreground-muted shrink-0"
          >
            <ChevronUp size={14} />
          </button>
          <input
            ref={inputRef}
            type="text"
            value={pathValue}
            onChange={(e) => setPathValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handlePathSubmit();
              if (e.key === 'Escape') done(null);
            }}
            className="flex-1 px-3 py-1.5 text-xs font-mono bg-background border border-border rounded-md text-foreground focus:outline-none focus:border-accent"
            autoFocus
          />
          <button
            onClick={() => browse(pathValue)}
            className="px-3 py-1.5 text-xs bg-background border border-border rounded-md hover:bg-surface-hover transition-colors text-foreground-muted shrink-0"
          >
            Go
          </button>
        </div>

        {/* Directory list */}
        <div className="flex-1 overflow-y-auto px-2 min-h-0 border-t border-border-subtle">
          {dirs.map((dir) => (
            <button
              key={dir.path}
              onClick={() => browse(dir.path)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs rounded-md hover:bg-surface-hover transition-colors text-foreground-muted hover:text-foreground text-left"
            >
              <Folder size={13} className="text-foreground-subtle shrink-0" />
              <span className="truncate">{dir.name}</span>
            </button>
          ))}
          {dirs.length === 0 && (
            <div className="py-4 text-center text-xs text-foreground-subtle">No subdirectories</div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button onClick={() => done(null)} className="px-4 py-1.5 text-xs rounded-md border border-border text-foreground-muted hover:bg-surface-hover transition-colors">
            Cancel
          </button>
          <button
            onClick={handlePathSubmit}
            disabled={!pathValue.trim()}
            className="px-4 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover transition-colors font-medium disabled:opacity-40"
          >
            Open
          </button>
        </div>
      </div>
    </div>
  );
}
