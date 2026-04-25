import { useCallback, useEffect, useState } from 'react';
import { FolderOpen, GitBranch, Cpu, Eye, ArrowRight, Pin, PinOff, X, Clock } from 'lucide-react';
import { getAPI } from '../bridge';
import { useProjectStore } from '../stores/project-store';

interface RecentProject {
  path: string;
  displayName: string;
  branch: string | null;
  pinned: boolean;
  lastOpenedAt: number;
  firstOpenedAt: number;
}

const steps = [
  {
    icon: FolderOpen,
    title: 'Open a project',
    description: 'Point CodeTrellis at any codebase — monorepos, single packages, TypeScript, JavaScript, Python, Rust, and more',
    color: 'from-blue-500/20 to-blue-600/5',
    iconColor: 'text-blue-400 drop-shadow-[0_0_6px_rgba(59,130,246,0.5)]',
    borderColor: 'border-blue-500/20',
  },
  {
    icon: GitBranch,
    title: 'See the architecture',
    description: 'Visualize how files connect through imports — see which packages depend on what, trace the dependency graph',
    color: 'from-violet-500/20 to-violet-600/5',
    iconColor: 'text-violet-400 drop-shadow-[0_0_6px_rgba(139,92,246,0.5)]',
    borderColor: 'border-violet-500/20',
  },
  {
    icon: Cpu,
    title: 'Connect a coding agent',
    description: 'Any MCP-capable agent (Claude Code, Codex, Cursor, ...) can plug in. CodeTrellis tracks plans, changes, and drift in real time',
    color: 'from-green-500/20 to-green-600/5',
    iconColor: 'text-green-400 drop-shadow-[0_0_6px_rgba(34,197,94,0.5)]',
    borderColor: 'border-green-500/20',
  },
  {
    icon: Eye,
    title: 'Track changes',
    description: 'See which files changed, what was added or removed, and the blast radius of every edit across your codebase',
    color: 'from-amber-500/20 to-amber-600/5',
    iconColor: 'text-amber-400 drop-shadow-[0_0_6px_rgba(245,158,11,0.5)]',
    borderColor: 'border-amber-500/20',
  },
];

export function WelcomeScreen() {
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const [loadingRecents, setLoadingRecents] = useState(true);

  useEffect(() => {
    fetch('/api/recent-projects')
      .then((r) => r.json())
      .then((data) => {
        setRecents(Array.isArray(data?.projects) ? data.projects : []);
      })
      .catch(() => setRecents([]))
      .finally(() => setLoadingRecents(false));
  }, []);

  const openAtPath = useCallback(async (projectPath: string) => {
    const api = getAPI();
    const store = useProjectStore.getState();

    let branch: string | null = null;
    try {
      const branchRes = await fetch(`/api/git/branch?path=${encodeURIComponent(projectPath)}`);
      const branchData = await branchRes.json();
      branch = branchData.branch;
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
  }, []);

  const handleOpen = async () => {
    const api = getAPI();
    const projectPath = await api.openProjectDialog();
    if (!projectPath) return;
    await openAtPath(projectPath);
  };

  const handleRemove = async (projectPath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRecents((prev) => prev.filter((p) => p.path !== projectPath));
    await fetch('/api/recent-projects', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath }),
    }).catch(() => {});
  };

  const handlePin = async (projectPath: string, pinned: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    setRecents((prev) => {
      const next = prev.map((p) => p.path === projectPath ? { ...p, pinned } : p);
      next.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.lastOpenedAt - a.lastOpenedAt;
      });
      return next;
    });
    await fetch('/api/recent-projects/pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath, pinned }),
    }).catch(() => {});
  };

  const hasRecents = recents.length > 0;

  return (
    <div className="w-full h-full relative overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#0a0b10] via-[#0d1020] to-[#0a0b10]" />

      {/* Subtle grid */}
      <div className="absolute inset-0 opacity-[0.03]" style={{
        backgroundImage: 'radial-gradient(circle, rgba(59,130,246,0.3) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }} />

      {/* Ambient glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-blue-500/[0.04] blur-[100px]" />
      <div className="absolute bottom-1/4 right-1/4 w-[300px] h-[300px] rounded-full bg-violet-500/[0.03] blur-[80px]" />

      {/* Content */}
      <div className="relative flex flex-col items-center justify-center min-h-full max-w-2xl mx-auto px-8 py-10">
        {/* Logo */}
        <div className="relative mb-6">
          <div className="absolute inset-0 w-20 h-20 rounded-2xl bg-blue-500/10 blur-xl" />
          <img src="/icon.png" alt="CodeTrellis" className="relative w-16 h-16 drop-shadow-[0_0_20px_rgba(59,130,246,0.3)]" />
        </div>

        <h1 className="text-2xl font-bold text-foreground tracking-tight mb-1">CodeTrellis</h1>
        <p className="text-[13px] text-foreground-muted mb-8 text-center leading-relaxed">
          Visualize your codebase architecture and monitor<br />AI coding agents in real-time
        </p>

        {hasRecents && (
          <div className="w-full max-w-lg mb-6">
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-[10px] font-semibold text-foreground-subtle uppercase tracking-[0.12em]">
                Recent projects
              </span>
              <button
                onClick={handleOpen}
                className="flex items-center gap-1.5 text-[11px] text-foreground-subtle hover:text-accent transition-colors"
              >
                <FolderOpen size={11} />
                Open another
              </button>
            </div>
            <div className="space-y-1">
              {recents.map((project) => (
                <RecentProjectRow
                  key={project.path}
                  project={project}
                  onOpen={() => openAtPath(project.path)}
                  onPin={(e) => handlePin(project.path, !project.pinned, e)}
                  onRemove={(e) => handleRemove(project.path, e)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Steps — full presentation when no recents, compact list when recents exist */}
        {!hasRecents && !loadingRecents && (
          <div className="w-full max-w-lg space-y-2.5 mb-8">
            {steps.map((step, i) => (
              <div
                key={i}
                className={`flex items-start gap-3.5 p-3.5 rounded-xl bg-gradient-to-r ${step.color} border ${step.borderColor} backdrop-blur-sm transition-all hover:scale-[1.01] hover:shadow-lg`}
              >
                <div className="w-9 h-9 rounded-lg bg-surface-solid/80 border border-border flex items-center justify-center shrink-0">
                  <step.icon size={16} className={step.iconColor} />
                </div>
                <div>
                  <h3 className="text-[12px] font-semibold text-foreground">{step.title}</h3>
                  <p className="text-[11px] text-foreground-muted mt-0.5 leading-relaxed">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* CTA — only show as the primary action when there are no recents */}
        {!hasRecents && (
          <button
            onClick={handleOpen}
            className="flex items-center gap-2.5 px-6 py-3 rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-all shadow-[0_0_20px_rgba(59,130,246,0.3)] hover:shadow-[0_0_30px_rgba(59,130,246,0.5)] hover:scale-105"
          >
            <FolderOpen size={16} />
            Open Project
            <ArrowRight size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function RecentProjectRow({
  project,
  onOpen,
  onPin,
  onRemove,
}: {
  project: RecentProject;
  onOpen: () => void;
  onPin: (e: React.MouseEvent) => void;
  onRemove: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onOpen}
      className="group w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.05] hover:border-accent/30 transition-all text-left"
    >
      <FolderOpen size={14} className="text-foreground-subtle shrink-0 group-hover:text-accent transition-colors" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[12.5px] font-medium text-foreground truncate">{project.displayName}</span>
          {project.branch && (
            <span className="flex items-center gap-1 text-[10px] text-foreground-subtle shrink-0">
              <GitBranch size={9} />
              {project.branch}
            </span>
          )}
        </div>
        <div className="text-[10.5px] text-foreground-subtle truncate font-mono">{project.path}</div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <span className="hidden group-hover:flex items-center gap-1 text-[10px] text-foreground-subtle mr-1">
          <Clock size={9} />
          {formatRelativeTime(project.lastOpenedAt)}
        </span>
        <button
          onClick={onPin}
          className={`p-1.5 rounded-md transition-all ${project.pinned ? 'text-accent' : 'text-foreground-subtle opacity-0 group-hover:opacity-100 hover:text-foreground'}`}
          title={project.pinned ? 'Unpin' : 'Pin to top'}
        >
          {project.pinned ? <Pin size={11} /> : <PinOff size={11} />}
        </button>
        <button
          onClick={onRemove}
          className="p-1.5 rounded-md text-foreground-subtle opacity-0 group-hover:opacity-100 hover:text-red-300 transition-all"
          title="Remove from recents"
        >
          <X size={11} />
        </button>
      </div>
    </button>
  );
}

function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
