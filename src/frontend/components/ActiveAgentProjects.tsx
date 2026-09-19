import { useEffect, useState } from 'react';
import { GitBranch, ArrowRight, Sparkles } from 'lucide-react';

/**
 * "Claude Code is working in ~/foo — open it?" — Phase 29.
 *
 * See [docs/PHASE-29-SURFACING-WHAT-WE-COLLECT.md](../../../docs/PHASE-29-SURFACING-WHAT-WE-COLLECT.md).
 *
 * `/api/auto-detect` has always been able to answer this. It reads
 * `~/.claude/sessions`, checks each session's pid is **actually alive**,
 * dedupes by working directory and reads the branch from `.git/HEAD` —
 * and nothing has ever called it.
 *
 * It is the highest polish-per-hour item in the register for a simple
 * reason: the product's whole premise is watching what an agent is doing
 * to a codebase, and the first screen could not tell you an agent was
 * already running. Opening to "Claude Code is working in `billing` on
 * `feat/ledger`" is the difference between a tool you point at something
 * and a tool that was already paying attention.
 *
 * ## Why there is no dismiss button
 *
 * The register sketched one. It is not needed: this screen only exists
 * while no project is open, so opening *anything* dismisses it — which
 * is the action the suggestion is asking for anyway. A dismiss control
 * would add persisted state to remove a row the next click removes.
 *
 * ## Why it polls
 *
 * An agent can start while this screen is open — that is arguably the
 * commonest case, since a developer launches the agent and then goes
 * looking for the visualiser. A one-shot fetch would show an empty
 * screen through exactly the moment the suggestion is most useful.
 * Five seconds against a local endpoint that stats a directory is
 * cheap, and the interval is cleared on unmount.
 */

export interface DetectedSession {
  projectPath: string;
  sessionId: string;
  name: string;
  branch: string | null;
}

const POLL_MS = 5_000;

export function useActiveAgentProjects(): DetectedSession[] {
  const [sessions, setSessions] = useState<DetectedSession[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch('/api/auto-detect');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setSessions(Array.isArray(data?.sessions) ? data.sessions : []);
        }
      } catch {
        // Silent. A suggestion that cannot be made is simply absent —
        // it must never become an error on a welcome screen.
      }
    };

    void load();
    const id = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return sessions;
}

interface Props {
  sessions: DetectedSession[];
  onOpen: (projectPath: string) => void;
}

export function ActiveAgentProjects({ sessions, onOpen }: Props) {
  if (sessions.length === 0) return null;

  return (
    <div className="w-full max-w-lg mb-6">
      <div className="flex items-center gap-1.5 mb-2 px-1">
        <span className="relative flex w-1.5 h-1.5">
          <span className="absolute inline-flex w-full h-full rounded-full bg-success opacity-60 animate-ping" />
          <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-success" />
        </span>
        <span className="text-[10px] font-semibold text-foreground-subtle uppercase tracking-[0.12em]">
          {sessions.length === 1 ? 'An agent is working here' : 'Agents are working here'}
        </span>
      </div>

      <div className="space-y-1">
        {sessions.map((session) => (
          <button
            key={session.sessionId}
            onClick={() => onOpen(session.projectPath)}
            className="group w-full flex items-center gap-3 p-3 rounded-xl bg-gradient-to-r from-green-500/[0.10] to-green-600/[0.02] border border-green-500/20 hover:border-green-500/40 hover:from-green-500/[0.14] transition-all text-left"
          >
            <div className="w-8 h-8 rounded-lg bg-surface-solid/80 border border-border flex items-center justify-center shrink-0">
              <Sparkles size={14} className="text-amber-300 drop-shadow-[0_0_6px_rgba(252,211,77,0.4)]" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-[12.5px] text-foreground font-medium truncate">{session.name}</span>
                {session.branch && (
                  <span className="flex items-center gap-1 text-[10px] text-foreground-subtle shrink-0">
                    <GitBranch size={9} />
                    {session.branch}
                  </span>
                )}
              </div>
              <div className="text-[10.5px] text-foreground-subtle/70 font-mono truncate">
                {session.projectPath}
              </div>
            </div>

            <ArrowRight
              size={14}
              className="text-foreground-subtle/40 group-hover:text-accent group-hover:translate-x-0.5 transition-all shrink-0"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
