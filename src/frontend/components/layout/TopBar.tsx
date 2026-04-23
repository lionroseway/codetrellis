import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FolderOpen, Cpu, Plug, Plus, X, GitBranch, RefreshCw, AlertCircle } from 'lucide-react';
import { useProjectStore, type ProjectTab } from '../../stores/project-store';
import { useAgentStore } from '../../stores/agent-store';
import { useGraphStore } from '../../stores/graph-store';
import { getAPI } from '../../bridge';
import type { ViewDepth } from '../../../shared/types';

const depthOptions: { value: ViewDepth; label: string }[] = [
  { value: 'package', label: 'Clusters' },
  { value: 'file', label: 'Files' },
  { value: 'symbol', label: 'Symbols' },
];

async function openProject() {
  const api = getAPI();
  const projectPath = await api.openProjectDialog();
  if (!projectPath) return;

  const store = useProjectStore.getState();

  let branch: string | null = null;
  try {
    const branchRes = await fetch(`/api/git/branch?path=${encodeURIComponent(projectPath)}`);
    branch = (await branchRes.json()).branch;
  } catch { /* ignore */ }

  store.addTab(projectPath, branch);
  store.setScanStatus('scanning');
  try {
    const result = await api.scanProject(projectPath);
    store.setMonorepoConfig(result.monorepoConfig);
    store.setFileTree(result.fileTree);
    store.setScanStatus('ready');
  } catch (err) {
    store.setError(String(err));
  }
}

async function rescanActiveTab() {
  const store = useProjectStore.getState();
  const activeTab = store.tabs.find((t) => t.id === store.activeTabId);
  if (!activeTab) return;

  let branch: string | null = null;
  try {
    const branchRes = await fetch(`/api/git/branch?path=${encodeURIComponent(activeTab.root)}`);
    branch = (await branchRes.json()).branch;
  } catch { /* ignore */ }

  const tabs = store.tabs.map((t) => t.id === activeTab.id ? { ...t, branch } : t);
  useProjectStore.setState({ tabs });

  store.setScanStatus('scanning');
  try {
    const api = getAPI();
    const result = await api.scanProject(activeTab.root);
    store.setMonorepoConfig(result.monorepoConfig);
    store.setFileTree(result.fileTree);
    store.setScanStatus('ready');
  } catch (err) {
    store.setError(String(err));
  }
}

function BranchPopover({ projectPath }: { projectPath: string }) {
  const [open, setOpen] = useState(false);
  const [gitInfo, setGitInfo] = useState<{
    currentBranch: string | null;
    branches: string[];
    worktrees: Array<{ path: string; branch: string | null }>;
    hasCommits: boolean;
  } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Fetch branch on mount so it shows immediately
  useEffect(() => {
    fetch(`/api/git/info?path=${encodeURIComponent(projectPath)}`)
      .then((r) => r.json())
      .then(setGitInfo)
      .catch(() => {});
  }, [open, projectPath]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      // Close if clicking outside both the button and the portal popover
      const popover = document.querySelector('[data-branch-popover]');
      if (
        ref.current && !ref.current.contains(target) &&
        (!popover || !popover.contains(target))
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Get button position for portal
  const btnRef = useRef<HTMLButtonElement>(null);
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPopoverPos({ top: rect.bottom + 4, left: rect.left });
    }
  }, [open]);

  return (
    <div ref={ref}>
      <button
        ref={btnRef}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-accent/10 border border-accent/20 text-accent hover:bg-accent/20 shrink-0 transition-all"
        title="Branch info — click to see branches and worktrees"
      >
        <GitBranch size={10} />
        {gitInfo?.currentBranch || '...'}
        {gitInfo && !gitInfo.hasCommits && <AlertCircle size={8} className="text-warning" />}
      </button>

      {open && gitInfo && createPortal(
        <div
          data-branch-popover
          style={{ position: 'fixed', top: popoverPos.top, left: popoverPos.left, zIndex: 9999 }}
          className="w-56 bg-surface-solid/95 backdrop-blur-xl border border-white/[0.08] rounded-lg shadow-[0_0_20px_rgba(0,0,0,0.5)] py-1"
        >
          {!gitInfo.hasCommits && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] text-warning border-b border-white/[0.06]">
              <AlertCircle size={10} />
              No commits yet
            </div>
          )}

          <div className="px-2 py-1">
            <span className="text-[9px] text-foreground-subtle uppercase tracking-wider px-1">Branches</span>
            {/* Always show current branch */}
            {gitInfo.currentBranch && (
              <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] rounded text-accent">
                <GitBranch size={10} />
                <span className="truncate">{gitInfo.currentBranch}</span>
                <span className="text-[8px] text-accent ml-auto">current</span>
              </div>
            )}
            {/* Show other branches */}
            {gitInfo.branches
              .filter((b) => b !== gitInfo.currentBranch)
              .map((b) => (
                <div key={b} className="flex items-center gap-1.5 px-2 py-1 text-[11px] rounded text-foreground-muted">
                  <GitBranch size={10} />
                  <span className="truncate">{b}</span>
                </div>
              ))}
          </div>

          {gitInfo.worktrees.length > 0 && (
            <div className="px-2 py-1 border-t border-white/[0.06]">
              <span className="text-[9px] text-foreground-subtle uppercase tracking-wider px-1">Worktrees</span>
              {gitInfo.worktrees.map((wt, i) => (
                <button
                  key={i}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(false);
                    // Open worktree as a new tab
                    const store = useProjectStore.getState();
                    store.addTab(wt.path, wt.branch);
                    store.setScanStatus('scanning');
                    getAPI().scanProject(wt.path).then((result) => {
                      store.setMonorepoConfig(result.monorepoConfig);
                      store.setFileTree(result.fileTree);
                      store.setScanStatus('ready');
                    }).catch((err) => store.setError(String(err)));
                  }}
                  className="w-full flex items-center gap-1.5 px-2 py-1 text-[11px] text-foreground-muted hover:text-foreground hover:bg-surface-hover rounded transition-colors text-left"
                >
                  <FolderOpen size={10} />
                  <span className="truncate">{wt.branch || wt.path.split('/').pop()}</span>
                </button>
              ))}
            </div>
          )}

          {gitInfo.branches.length === 0 && gitInfo.worktrees.length === 0 && (
            <div className="px-3 py-2 text-[10px] text-foreground-subtle">
              No branches or worktrees found
            </div>
          )}

          <div className="border-t border-white/[0.06] px-2 py-1">
            <button
              onClick={(e) => { e.stopPropagation(); setOpen(false); rescanActiveTab(); }}
              className="w-full flex items-center gap-1.5 px-2 py-1 text-[11px] text-foreground-muted hover:text-foreground hover:bg-surface-hover rounded transition-colors"
            >
              <RefreshCw size={10} />
              Rescan project
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function TabItem({ tab, isActive }: { tab: ProjectTab; isActive: boolean }) {
  const setActiveTab = useProjectStore((s) => s.setActiveTab);
  const removeTab = useProjectStore((s) => s.removeTab);

  return (
    <div
      onClick={() => setActiveTab(tab.id)}
      className={`group flex items-center gap-1.5 px-3 py-1 text-[11px] rounded-md transition-all max-w-[220px] cursor-pointer ${
        isActive
          ? 'bg-surface-active text-foreground border border-border shadow-[0_0_8px_rgba(59,130,246,0.1)]'
          : 'text-foreground-muted hover:text-foreground hover:bg-surface-hover border border-transparent'
      }`}
    >
      <span className="truncate font-medium">{tab.name}</span>
      {isActive ? (
        <BranchPopover projectPath={tab.root} />
      ) : (
        tab.branch && (
          <span className="flex items-center gap-0.5 text-[9px] text-foreground-subtle shrink-0">
            <GitBranch size={9} />
            {tab.branch}
          </span>
        )
      )}
      {tab.scanStatus === 'scanning' && (
        <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse shadow-[0_0_4px_rgba(59,130,246,0.5)] shrink-0" />
      )}
      <span
        onClick={(e) => { e.stopPropagation(); removeTab(tab.id); }}
        className="ml-auto shrink-0 opacity-0 group-hover:opacity-100 hover:text-danger transition-all"
      >
        <X size={10} />
      </span>
    </div>
  );
}

export function TopBar() {
  const tabs = useProjectStore((s) => s.tabs);
  const activeTabId = useProjectStore((s) => s.activeTabId);
  const root = useProjectStore((s) => s.root);
  const agentStatus = useAgentStore((s) => s.status);
  const viewDepth = useGraphStore((s) => s.viewDepth);
  const setViewDepth = useGraphStore((s) => s.setViewDepth);

  return (
    <div className="glass-panel flex items-center h-11 px-3 border-b gap-2 shrink-0 overflow-visible relative z-40">
      <img src="/icon.png" alt="" className="w-5 h-5 shrink-0" />

      <div className="flex items-center gap-1 min-w-0 overflow-x-auto flex-1">
        {tabs.map((tab) => (
          <TabItem key={tab.id} tab={tab} isActive={tab.id === activeTabId} />
        ))}
        <button
          onClick={openProject}
          className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-md text-foreground-subtle hover:text-foreground hover:bg-surface-hover transition-all shrink-0"
          title="Open project"
        >
          <Plus size={12} />
          {tabs.length === 0 && <span>Open Project</span>}
        </button>
      </div>

      {root && (
        <button
          onClick={rescanActiveTab}
          className="flex items-center gap-1 px-2 py-1.5 text-[11px] rounded-lg text-foreground-subtle hover:text-foreground hover:bg-surface-hover transition-all shrink-0"
          title="Rescan project"
        >
          <RefreshCw size={12} />
        </button>
      )}

      <div className="flex items-center bg-surface rounded-lg p-0.5 gap-0.5 border border-border shrink-0">
        {depthOptions.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setViewDepth(opt.value)}
            className={`px-3 py-1 text-[11px] font-medium rounded-md transition-all ${
              viewDepth === opt.value
                ? 'bg-accent text-white shadow-[0_0_12px_rgba(59,130,246,0.3)]'
                : 'text-foreground-muted hover:text-foreground hover:bg-surface-hover'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <button
        onClick={() => window.dispatchEvent(new CustomEvent('open-mcp-guide'))}
        className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-lg border border-border text-foreground-muted hover:text-foreground hover:border-border-glow hover:shadow-[0_0_8px_rgba(59,130,246,0.1)] transition-all shrink-0"
      >
        <Plug size={12} />
        Connect Agent
      </button>

      <div className="flex items-center gap-2 text-[11px] text-foreground-muted px-3 py-1.5 rounded-lg bg-surface border border-border shrink-0">
        <Cpu size={12} className={agentStatus === 'active' ? 'text-success drop-shadow-[0_0_4px_rgba(34,197,94,0.5)]' : 'text-foreground-subtle'} />
        <span className={`w-1.5 h-1.5 rounded-full ${agentStatus === 'active' ? 'bg-success shadow-[0_0_6px_rgba(34,197,94,0.5)] animate-pulse' : 'bg-foreground-subtle'}`} />
        <span>{agentStatus === 'active' ? 'Agent active' : 'No agent'}</span>
      </div>
    </div>
  );
}
