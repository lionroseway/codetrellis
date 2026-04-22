const STATUS_STYLES: Record<string, string> = {
  draft: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20',
  review: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  approved: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  in_progress: 'text-accent bg-accent/10 border-accent/20',
  completed: 'text-green-400 bg-green-500/10 border-green-500/20',
  archived: 'text-zinc-500 bg-zinc-600/10 border-zinc-600/20',
  pending: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20',
  assigned: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  done: 'text-green-400 bg-green-500/10 border-green-500/20',
  blocked: 'text-red-400 bg-red-500/10 border-red-500/20',
  skipped: 'text-zinc-500 bg-zinc-600/10 border-zinc-600/20',
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.draft;
  return (
    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${style}`}>
      {status.replace('_', ' ')}
    </span>
  );
}
