/**
 * ContributionPanel — Phase 7.2.
 *
 * Shows a collapsible list of items the contributor has promoted to
 * the contributions staging area. Appears in the plan workspace when
 * the current branch has staged contributions.
 */

import { useEffect, useState } from 'react';
import { GitPullRequest, Package, Check, RefreshCw } from 'lucide-react';
import { useProjectStore } from '../../../stores/project-store';

interface Contribution {
  uid: string;
  branch: string;
  kind: 'item' | 'attachment';
  title: string;
  description?: string;
  filePath: string;
  promotedAt: string;
}

interface ContributionSummary {
  branch: string;
  total: number;
  items: Contribution[];
}

export function ContributionPanel() {
  const projectPath = useProjectStore((s) => s.root);
  const [summary, setSummary] = useState<ContributionSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchContributions = async () => {
    if (!projectPath) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/contributions?project=${encodeURIComponent(projectPath)}`);
      if (res.ok) setSummary(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => {
    fetchContributions();
  }, [projectPath]);

  if (!summary || summary.total === 0) return null;

  return (
    <div className="border-b border-zinc-800/60">
      <div className="flex items-center gap-2 px-3 py-2 bg-indigo-950/20 border-b border-indigo-900/30">
        <GitPullRequest size={13} className="text-indigo-400" />
        <span className="text-xs font-medium text-indigo-300">
          Contributions staged ({summary.total})
        </span>
        <span className="text-[10px] text-zinc-500 ml-1">
          branch: {summary.branch}
        </span>
        <div className="flex-1" />
        <button
          onClick={fetchContributions}
          className="p-0.5 text-zinc-500 hover:text-zinc-300 rounded"
          disabled={loading}
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="max-h-32 overflow-y-auto">
        {summary.items.map((item) => (
          <div
            key={item.uid}
            className="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-zinc-800/30 last:border-b-0"
          >
            <Package size={11} className="text-zinc-500 shrink-0" />
            <span className="text-zinc-300 truncate flex-1">{item.title}</span>
            <span className="text-[9px] text-zinc-600 shrink-0">
              {item.kind}
            </span>
            <Check size={10} className="text-emerald-500 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
