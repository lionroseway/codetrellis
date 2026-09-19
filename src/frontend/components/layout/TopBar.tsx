import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FolderOpen, Plug, Plus, X, GitBranch, RefreshCw, AlertCircle, Camera, GitCompare, Settings as SettingsIcon, GraduationCap, BookOpen, Zap, FileCode } from 'lucide-react';
import { useProjectStore, type ProjectTab } from '../../stores/project-store';
import { useGraphStore } from '../../stores/graph-store';
import { useUiStore } from '../../stores/ui-store';
import { getAPI } from '../../bridge';
import type { ViewDepth, PowerStatus } from '../../../shared/types';
import { ConnectedAgents } from './ConnectedAgents';
import { DeviceIndicator } from '../pairing/DeviceIndicator';
import { SettingsModal } from '../settings/SettingsModal';

async function captureBaselineFromBranch(projectPath: string, branch: string): Promise<boolean> {
  try {
    const tipRes = await fetch(`/api/git/branch-tip?path=${encodeURIComponent(projectPath)}&branch=${encodeURIComponent(branch)}`);
    const tipData = await tipRes.json();
    if (!tipData?.commitHash) return false;

    const captureRes = await fetch('/api/baseline/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath, commitHash: tipData.commitHash }),
    });
    const snapshot = await captureRes.json();
    if (!snapshot?.data) return false;

    const graphStore = useGraphStore.getState();
    graphStore.setBaselineMode('pinned');
    graphStore.setBaselineReference({
      commitHash: snapshot.commitHash ?? tipData.commitHash,
      shortCommitHash: snapshot.shortCommitHash ?? tipData.shortCommitHash,
    });
    graphStore.setCurrentSnapshot({
      id: snapshot.id,
      name: snapshot.name,
      commitHash: snapshot.commitHash,
      shortCommitHash: snapshot.shortCommitHash,
      edges: snapshot.data.edges,
      files: snapshot.data.files,
    });
    return true;
  } catch {
    return false;
  }
}

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

  const tabId = store.addTab(projectPath, null);
  store.setScanStatus('scanning');
  try {
    const result = await api.scanProject(projectPath);
    store.applyScanResult(result);
  // The branch is read AFTER the scan, not before.
  //
  // `/api/git/branch` goes through `requireProjectPath`, which refuses a
  // path that is not a trusted root — and a folder being opened for the
  // first time is not one until `scanProject` registers it. Asking first
  // got a 403, the caller read `undefined` off the error body, and the
  // new tab was created with no branch label until something else
  // happened to rescan. Loopback is not an authorisation boundary, so
  // the route's refusal is right; the order of the two calls was wrong.
    try {
      const branchRes = await fetch(`/api/git/branch?path=${encodeURIComponent(projectPath)}`);
      if (branchRes.ok) {
        const branchData = (await branchRes.json()) as { branch?: string | null };
        store.setTabBranch(tabId, branchData.branch ?? null);
      }
    } catch { /* a missing branch label is not worth failing an open over */ }
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
    store.applyScanResult(result);
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
            <div className="text-[9px] text-foreground-subtle px-1 mb-0.5 leading-snug">
              Click a branch to pin it as the diff baseline.
            </div>
            {/* Always show current branch */}
            {gitInfo.currentBranch && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  captureBaselineFromBranch(projectPath, gitInfo.currentBranch!);
                }}
                className="group w-full flex items-center gap-1.5 px-2 py-1 text-[11px] rounded text-accent hover:bg-accent/10 transition-colors text-left"
                title="Pin baseline to current branch's HEAD"
              >
                <GitBranch size={10} />
                <span className="truncate">{gitInfo.currentBranch}</span>
                <span className="text-[8px] text-accent ml-auto">current</span>
                <Camera size={9} className="opacity-0 group-hover:opacity-70" />
              </button>
            )}
            {/* Show other branches — clickable to pin as baseline */}
            {gitInfo.branches
              .filter((b) => b !== gitInfo.currentBranch)
              .map((b) => (
                <button
                  key={b}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(false);
                    captureBaselineFromBranch(projectPath, b);
                  }}
                  className="group w-full flex items-center gap-1.5 px-2 py-1 text-[11px] rounded text-foreground-muted hover:text-foreground hover:bg-surface-hover transition-colors text-left"
                  title={`Pin baseline to ${b}'s HEAD — see diff against this branch`}
                >
                  <GitBranch size={10} />
                  <span className="truncate">{b}</span>
                  <GitCompare size={9} className="ml-auto opacity-0 group-hover:opacity-70" />
                </button>
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
                    getAPI().scanProject(wt.path)
                      .then((result) => store.applyScanResult(result))
                      .catch((err) => store.setError(String(err)));
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

/**
 * Toggle the Docs surface (CDev Phase 3.4). Lights up when docs mode
 * is active; clicking returns to graph mode. Hidden when no project
 * is open since docs live under <projectRoot>/.codetrellis/docs/.
 */
function DocsToggle() {
  const root = useProjectStore((s) => s.root);
  const workspaceMode = useUiStore((s) => s.workspaceMode);
  const setWorkspaceMode = useUiStore((s) => s.setWorkspaceMode);
  if (!root) return null;

  const active = workspaceMode === 'docs';
  return (
    <button
      type="button"
      onClick={() => setWorkspaceMode(active ? 'graph' : 'docs')}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-lg border transition-all shrink-0 ${
        active
          ? 'border-accent/60 text-accent bg-accent/10 shadow-[0_0_10px_rgba(59,130,246,0.15)]'
          : 'border-border text-foreground-muted hover:text-foreground hover:border-border-glow hover:shadow-[0_0_8px_rgba(59,130,246,0.1)]'
      }`}
      title={active ? 'Back to graph' : 'System documentation'}
    >
      <BookOpen size={12} />
      Docs
    </button>
  );
}

/**
 * Phase 26 — the code-first mode toggle.
 *
 * A peer of the graph rather than a panel inside it: switching here
 * unmounts the graph entirely, so its layout cost is not paid by someone
 * who only wants to read code. On a large repository that is the
 * difference between a usable app and a slow one.
 */
function CodeModeToggle() {
  const root = useProjectStore((s) => s.root);
  const workspaceMode = useUiStore((s) => s.workspaceMode);
  const setWorkspaceMode = useUiStore((s) => s.setWorkspaceMode);
  if (!root) return null;

  const active = workspaceMode === 'code';
  return (
    <button
      type="button"
      onClick={() => setWorkspaceMode(active ? 'graph' : 'code')}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-lg border transition-all shrink-0 ${
        active
          ? 'border-accent/60 text-accent bg-accent/10 shadow-[0_0_10px_rgba(59,130,246,0.15)]'
          : 'border-border text-foreground-muted hover:text-foreground hover:border-border-glow hover:shadow-[0_0_8px_rgba(59,130,246,0.1)]'
      }`}
      title={active ? 'Back to the graph' : 'Read code, diffs and history without the graph (⌘⇧C)'}
    >
      <FileCode size={12} />
      Code
    </button>
  );
}

export function TopBar() {
  const tabs = useProjectStore((s) => s.tabs);
  const activeTabId = useProjectStore((s) => s.activeTabId);
  const root = useProjectStore((s) => s.root);
  const viewDepth = useGraphStore((s) => s.viewDepth);
  const setViewDepth = useGraphStore((s) => s.setViewDepth);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<'identity' | 'devices'>('identity');
  const updateAvailable = useUpdateAvailable(settingsOpen);

  // Allow MCP to open settings via CustomEvent
  useEffect(() => {
    const handler = () => setSettingsOpen(true);
    window.addEventListener('open-settings', handler);
    return () => window.removeEventListener('open-settings', handler);
  }, []);

  return (
    <div className="glass-panel flex items-center h-11 px-3 border-b gap-2 shrink-0 overflow-visible relative z-40">
      <img src="./icon.png" alt="" className="w-5 h-5 shrink-0" />

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

      <CodeModeToggle />
      <DocsToggle />

      <button
        onClick={() => window.dispatchEvent(new CustomEvent('open-mcp-guide'))}
        className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-lg border border-border text-foreground-muted hover:text-foreground hover:border-border-glow hover:shadow-[0_0_8px_rgba(59,130,246,0.1)] transition-all shrink-0"
      >
        <Plug size={12} />
        Connect Agent
      </button>

      <ConnectedAgents />
      <AwakeIndicator />
      <DeviceIndicator
        onPairDevice={() => { setSettingsSection('devices'); setSettingsOpen(true); }}
      />

      <button
        onClick={() => window.dispatchEvent(new CustomEvent('open-mcp-guide'))}
        className="flex items-center justify-center w-8 h-8 rounded-lg text-foreground-subtle hover:text-foreground hover:bg-surface-hover transition-all shrink-0"
        title="Learn CodeTrellis"
        aria-label="Open onboarding tour"
      >
        <GraduationCap size={14} />
      </button>

      <button
        onClick={() => setSettingsOpen(true)}
        className="relative flex items-center justify-center w-8 h-8 rounded-lg text-foreground-subtle hover:text-foreground hover:bg-surface-hover transition-all shrink-0"
        title={updateAvailable ? 'Settings — update available' : 'Settings'}
      >
        <SettingsIcon size={13} />
        {updateAvailable && (
          <span
            className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-accent shadow-[0_0_4px_rgba(110,231,183,0.6)]"
            aria-label="Update available"
          />
        )}
      </button>

      {settingsOpen && (
        <SettingsModal
          initialSection={settingsSection}
          onClose={() => { setSettingsOpen(false); setSettingsSection('identity'); }}
        />
      )}
    </div>
  );
}

/**
 * Polls `/api/updates/status` to know whether to show the
 * update-available dot on the Settings button. Cheap — the backend
 * caches; this is just reading that cache.
 *
 *   - Fetches once on mount (covers the auto-poll that ran on
 *     backend boot).
 *   - Re-fetches whenever Settings closes (covers the case where
 *     the user clicks "Check now" inside Settings and a new state
 *     comes back).
 *   - Polls every 5 minutes as a soft refresh while the app is
 *     running (the backend's actual remote check is daily; this
 *     just picks up state changes between checks).
 */
function useUpdateAvailable(settingsOpen: boolean): boolean {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/updates/status');
        if (!res.ok) return;
        const data = (await res.json()) as { status?: string };
        if (!cancelled) setAvailable(data.status === 'available');
      } catch {
        // ignore — backend may still be booting
      }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Re-check whenever Settings closes — covers the "user just
  // clicked Check now and a result came back" case.
  useEffect(() => {
    if (settingsOpen) return;
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/updates/status');
        if (!res.ok) return;
        const data = (await res.json()) as { status?: string };
        setAvailable(data.status === 'available');
      } catch {
        // ignore
      }
    }, 200);
    return () => clearTimeout(t);
  }, [settingsOpen]);

  return available;
}

/**
 * AwakeIndicator — session-persistence plan / Track A §4.2.
 *
 * Small Zap icon next to the connection indicators. Glows when the
 * desktop sleep-prevent assertion is currently engaged, with hover
 * tooltip explaining the active reason. Click → opens Settings.
 * Hidden in web mode (no Electron blocker available).
 */
function AwakeIndicator() {
  const [status, setStatus] = useState<PowerStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      fetch('/api/power/status')
        .then((r) => (r.ok ? r.json() : null))
        .then((s: PowerStatus | null) => { if (!cancelled && s) setStatus(s); })
        .catch(() => { /* backend booting / network blip — keep last */ });
    };
    tick();
    const id = window.setInterval(tick, 4000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  if (!status) return null;
  // Web mode = no powerSaveBlocker available; hide the indicator so
  // we don't promise behavior we can't deliver.
  if (status.platform === 'web') return null;

  const active = status.shouldBlock;
  const reasonText =
    status.reason === 'mobile-connected' ? 'Mobile connected'
    : status.reason === 'agent-active' ? 'Agent active'
    : status.reason === 'always' ? 'Always-on'
    : null;
  const title = active && reasonText
    ? `Keeping desktop awake — ${reasonText}`
    : 'Desktop sleep allowed (configure in Settings → Power)';

  return (
    <button
      onClick={() => window.dispatchEvent(new CustomEvent('open-settings'))}
      className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-surface-hover transition-all shrink-0"
      title={title}
      aria-label={title}
    >
      <Zap
        size={13}
        className={active ? 'text-emerald-400 drop-shadow-[0_0_4px_rgba(110,231,183,0.4)]' : 'text-foreground-subtle/60'}
        fill={active ? 'currentColor' : 'none'}
      />
    </button>
  );
}
