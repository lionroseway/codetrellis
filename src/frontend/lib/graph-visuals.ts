export type GraphDirection = 'inbound' | 'outbound';

export interface GraphNodeVisualData {
  label?: string;
  fullPath?: string;
  language?: string;
  symbolCount?: number;
  connectionCount?: number;
  isHub?: boolean;
  isFocused?: boolean;
  direction?: GraphDirection;
  exports?: string[];
  changeStatus?: string;
  ghost?: boolean;
  taskDescription?: string;
  taskNumber?: number;
  done?: boolean;
  frozen?: boolean;
  nodeType?: string;
  childCount?: number;
  topFiles?: string[];
  expanded?: boolean;
  symbolKind?: string;
  mode?: string;
  gitStates?: string[];
  [key: string]: unknown;
}

export interface LanguageVisual {
  accent: string;
  glow: string;
  bg: string;
  badge: string;
  shortLabel: string;
}

export interface ChangeVisual {
  symbol: string;
  tone: string;
  glow: string;
}

const DEFAULT_LANGUAGE: LanguageVisual = {
  accent: '#94a3b8',
  glow: 'rgba(148, 163, 184, 0.28)',
  bg: 'rgba(148, 163, 184, 0.14)',
  badge: 'border-white/10 bg-white/6 text-zinc-200',
  shortLabel: 'FILE',
};

const LANGUAGE_VISUALS: Record<string, LanguageVisual> = {
  typescript: {
    accent: '#3b82f6',
    glow: 'rgba(59, 130, 246, 0.32)',
    bg: 'rgba(59, 130, 246, 0.14)',
    badge: 'border-blue-400/25 bg-blue-500/10 text-blue-100',
    shortLabel: 'TS',
  },
  javascript: {
    accent: '#eab308',
    glow: 'rgba(234, 179, 8, 0.28)',
    bg: 'rgba(234, 179, 8, 0.12)',
    badge: 'border-yellow-400/25 bg-yellow-500/10 text-yellow-100',
    shortLabel: 'JS',
  },
  python: {
    accent: '#22c55e',
    glow: 'rgba(34, 197, 94, 0.28)',
    bg: 'rgba(34, 197, 94, 0.12)',
    badge: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100',
    shortLabel: 'PY',
  },
  rust: {
    accent: '#f97316',
    glow: 'rgba(249, 115, 22, 0.3)',
    bg: 'rgba(249, 115, 22, 0.12)',
    badge: 'border-orange-400/25 bg-orange-500/10 text-orange-100',
    shortLabel: 'RS',
  },
  go: {
    accent: '#06b6d4',
    glow: 'rgba(6, 182, 212, 0.28)',
    bg: 'rgba(6, 182, 212, 0.12)',
    badge: 'border-cyan-400/25 bg-cyan-500/10 text-cyan-100',
    shortLabel: 'GO',
  },
  css: {
    accent: '#a855f7',
    glow: 'rgba(168, 85, 247, 0.28)',
    bg: 'rgba(168, 85, 247, 0.12)',
    badge: 'border-fuchsia-400/25 bg-fuchsia-500/10 text-fuchsia-100',
    shortLabel: 'CSS',
  },
  json: {
    accent: '#38bdf8',
    glow: 'rgba(56, 189, 248, 0.24)',
    bg: 'rgba(56, 189, 248, 0.1)',
    badge: 'border-sky-400/25 bg-sky-500/10 text-sky-100',
    shortLabel: 'JSON',
  },
  markdown: {
    accent: '#f472b6',
    glow: 'rgba(244, 114, 182, 0.24)',
    bg: 'rgba(244, 114, 182, 0.1)',
    badge: 'border-pink-400/25 bg-pink-500/10 text-pink-100',
    shortLabel: 'MD',
  },
};

const CHANGE_VISUALS: Record<string, ChangeVisual> = {
  added: { symbol: '+', tone: 'border-emerald-400/25 bg-emerald-500/15 text-emerald-100', glow: 'rgba(34, 197, 94, 0.34)' },
  planned_add: { symbol: '+', tone: 'border-emerald-300/30 bg-emerald-500/12 text-emerald-100', glow: 'rgba(34, 197, 94, 0.38)' },
  modified: { symbol: '~', tone: 'border-amber-400/25 bg-amber-500/15 text-amber-100', glow: 'rgba(245, 158, 11, 0.32)' },
  planned_modify: { symbol: '~', tone: 'border-orange-300/30 bg-orange-500/12 text-orange-100', glow: 'rgba(249, 115, 22, 0.34)' },
  removed: { symbol: '-', tone: 'border-red-400/25 bg-red-500/15 text-red-100', glow: 'rgba(239, 68, 68, 0.34)' },
  planned_remove: { symbol: '-', tone: 'border-red-300/30 bg-red-500/12 text-red-100', glow: 'rgba(239, 68, 68, 0.38)' },
  in_progress_task: { symbol: '>', tone: 'border-blue-400/25 bg-blue-500/15 text-blue-100', glow: 'rgba(59, 130, 246, 0.36)' },
  active: { symbol: '*', tone: 'border-blue-300/30 bg-blue-500/12 text-blue-100', glow: 'rgba(96, 165, 250, 0.34)' },
  affected: { symbol: '!', tone: 'border-violet-400/25 bg-violet-500/15 text-violet-100', glow: 'rgba(139, 92, 246, 0.32)' },
  unexpected_live: { symbol: '!', tone: 'border-fuchsia-300/30 bg-fuchsia-500/14 text-fuchsia-100', glow: 'rgba(217, 70, 239, 0.34)' },
};

export function getLanguageVisual(language?: string): LanguageVisual {
  return LANGUAGE_VISUALS[language || ''] || DEFAULT_LANGUAGE;
}

export function getChangeVisual(changeStatus?: string): ChangeVisual | null {
  if (!changeStatus) return null;
  return CHANGE_VISUALS[changeStatus] || null;
}

export function getNodeDimensions(data: GraphNodeVisualData): { width: number; height: number } {
  if (data.nodeType === 'symbol') return { width: 190, height: 60 };
  if (data.nodeType === 'directory') return { width: 230, height: 78 };
  if (data.nodeType === 'package') {
    return data.isFocused ? { width: 320, height: 190 } : { width: 260, height: 136 };
  }

  const connectionCount = data.connectionCount || 0;

  if (data.isFocused) {
    return {
      width: 280 + Math.min(connectionCount, 8) * 6,
      height: 190 + Math.min((data.exports?.length || 0), 6) * 10,
    };
  }

  if (data.isHub) {
    return {
      width: 220 + Math.min(connectionCount, 6) * 5,
      height: 112 + Math.min((data.exports?.length || 0), 4) * 8,
    };
  }

  if (data.ghost) return { width: 210, height: 92 };

  return {
    width: 164 + Math.min(connectionCount, 6) * 6,
    height: 70,
  };
}

export function getLanguageLabel(language?: string): string {
  return getLanguageVisual(language).shortLabel;
}
