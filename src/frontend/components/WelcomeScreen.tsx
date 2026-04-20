import { FolderOpen, GitBranch, Cpu, Eye, ArrowRight } from 'lucide-react';
import { getAPI } from '../bridge';
import { useProjectStore } from '../stores/project-store';

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
    title: 'Monitor your AI agent',
    description: 'CodeTrellis detects Claude Code sessions automatically and shows every action the agent takes in real-time',
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
  const handleOpen = async () => {
    const api = getAPI();
    const projectPath = await api.openProjectDialog();
    if (!projectPath) return;

    const store = useProjectStore.getState();

    // Fetch branch
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
  };

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
      <div className="relative flex flex-col items-center justify-center h-full max-w-lg mx-auto px-8">
        {/* Logo */}
        <div className="relative mb-6">
          <div className="absolute inset-0 w-20 h-20 rounded-2xl bg-blue-500/10 blur-xl" />
          <img src="/icon.png" alt="CodeTrellis" className="relative w-16 h-16 drop-shadow-[0_0_20px_rgba(59,130,246,0.3)]" />
        </div>

        <h1 className="text-2xl font-bold text-foreground tracking-tight mb-1">CodeTrellis</h1>
        <p className="text-[13px] text-foreground-muted mb-10 text-center leading-relaxed">
          Visualize your codebase architecture and monitor<br />AI coding agents in real-time
        </p>

        {/* Steps */}
        <div className="w-full space-y-2.5 mb-10">
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

        {/* CTA */}
        <button
          onClick={handleOpen}
          className="flex items-center gap-2.5 px-6 py-3 rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-all shadow-[0_0_20px_rgba(59,130,246,0.3)] hover:shadow-[0_0_30px_rgba(59,130,246,0.5)] hover:scale-105"
        >
          <FolderOpen size={16} />
          Open Project
          <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}
