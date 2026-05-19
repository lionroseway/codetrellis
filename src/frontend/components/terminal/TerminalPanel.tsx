/**
 * Phase 17.B / Terminal — Integrated terminal panel.
 *
 * Bottom-drawer panel with tabbed terminals. Each terminal connects
 * to a backend PTY via WebSocket. Supports agent presets (claude,
 * codex, aider) and prompt injection for the "Explain with agent" flow.
 *
 * Uses @xterm/xterm for the terminal emulator.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Terminal as TerminalIcon,
  Plus,
  X,
  ChevronUp,
  ChevronDown,
  Sparkles,
  SquareTerminal,
} from 'lucide-react';
import { TerminalInstance } from './TerminalInstance';
import { useTerminalStore } from '../../stores/terminal-store';
import { useProjectStore } from '../../stores/project-store';

export type AgentPreset = 'claude' | 'codex' | 'aider' | 'shell';

const PRESET_META: Record<AgentPreset, { label: string; color: string; accent: string; bg: string }> = {
  claude: { label: 'Claude', color: 'text-orange-300', accent: 'bg-orange-400', bg: 'bg-orange-400/10' },
  codex: { label: 'Codex', color: 'text-green-400', accent: 'bg-green-400', bg: 'bg-green-400/10' },
  aider: { label: 'Aider', color: 'text-purple-400', accent: 'bg-purple-400', bg: 'bg-purple-400/10' },
  shell: { label: 'Shell', color: 'text-blue-400', accent: 'bg-blue-400', bg: 'bg-blue-400/10' },
};

export function TerminalPanel() {
  const {
    sessions,
    activeSessionId,
    isOpen,
    setActiveSession,
    createSession,
    killSession,
    togglePanel,
    setOpen,
  } = useTerminalStore();

  const [showPresetMenu, setShowPresetMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close preset menu on outside click
  useEffect(() => {
    if (!showPresetMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowPresetMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPresetMenu]);

  const projectRoot = useProjectStore((s) => s.root);

  const handleNewTerminal = useCallback(async (preset: AgentPreset) => {
    setShowPresetMenu(false);
    await createSession(preset, { cwd: projectRoot ?? undefined });
    if (!isOpen) setOpen(true);
  }, [createSession, isOpen, setOpen, projectRoot]);

  return (
    <div className={`border-t border-white/[0.06] bg-[#0a0b14] flex flex-col ${
      isOpen ? 'h-[40vh] min-h-[200px]' : 'h-[30px]'
    } transition-all duration-200`}>
      {/* Tab bar — always visible */}
      <div className="flex items-center gap-0.5 px-2 h-[30px] shrink-0 border-b border-white/[0.04] bg-[#080916]">
        <button
          onClick={togglePanel}
          className="flex items-center gap-1.5 px-2 py-1 text-[11.5px] text-foreground-subtle hover:text-foreground transition-colors rounded"
          title={isOpen ? 'Collapse terminal (⌘`)' : 'Open terminal (⌘`)'}
        >
          <SquareTerminal size={13} />
          <span className="font-medium">Terminal</span>
          {sessions.length > 0 && (
            <span className="text-[10px] text-foreground-subtle/60 tabular-nums">{sessions.length}</span>
          )}
          {isOpen ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
        </button>

        {sessions.length > 0 && <div className="h-4 w-px bg-white/[0.06] mx-1" />}

        {/* Tabs */}
        {sessions.map((s) => {
          const meta = PRESET_META[s.preset as AgentPreset] ?? PRESET_META.shell;
          const isActive = s.id === activeSessionId;
          return (
            <div
              key={s.id}
              className={`group flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded cursor-pointer transition-colors relative overflow-hidden ${
                isActive
                  ? `${meta.bg} text-foreground`
                  : 'text-foreground-subtle hover:text-foreground hover:bg-white/[0.03]'
              }`}
              onClick={() => {
                setActiveSession(s.id);
                if (!isOpen) setOpen(true);
              }}
            >
              {/* Color accent bar */}
              {isActive && (
                <div className={`absolute left-0 top-[3px] bottom-[3px] w-[2px] rounded-r ${meta.accent}`} />
              )}
              {s.preset !== 'shell' ? (
                <Sparkles size={10} className={meta.color} />
              ) : (
                <TerminalIcon size={10} className={meta.color} />
              )}
              <span className="truncate max-w-[100px]">{s.title}</span>
              {!s.alive && (
                <span className="text-[9px] text-red-400/80 uppercase tracking-wider font-medium">exited</span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); killSession(s.id); }}
                className="opacity-0 group-hover:opacity-100 text-foreground-subtle hover:text-red-400 transition-all ml-0.5"
              >
                <X size={10} />
              </button>
            </div>
          );
        })}

        {/* New terminal button */}
        <div className="relative ml-1" ref={menuRef}>
          <button
            onClick={() => setShowPresetMenu((p) => !p)}
            className="flex items-center gap-1 px-2 py-1 text-[11px] text-foreground-subtle hover:text-foreground hover:bg-white/[0.04] rounded transition-colors"
            title="New terminal"
          >
            <Plus size={11} />
          </button>
          {showPresetMenu && (
            <div className="absolute left-0 bottom-full mb-1 z-50 min-w-[140px] rounded-lg border border-white/[0.10] bg-[#0c0e1a]/98 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] py-1">
              {(Object.entries(PRESET_META) as Array<[AgentPreset, typeof PRESET_META.shell]>).map(
                ([preset, meta]) => (
                  <button
                    key={preset}
                    onClick={() => handleNewTerminal(preset)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-foreground-muted hover:text-foreground hover:bg-white/[0.04] text-left"
                  >
                    <span className={`w-2 h-2 rounded-full ${meta.accent}`} />
                    {preset !== 'shell' ? (
                      <Sparkles size={11} className={meta.color} />
                    ) : (
                      <TerminalIcon size={11} className={meta.color} />
                    )}
                    {meta.label}
                  </button>
                ),
              )}
            </div>
          )}
        </div>

        <div className="flex-1" />
      </div>

      {/* Terminal content */}
      {isOpen && (
        <div className="flex-1 min-h-0 relative">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`absolute inset-0 ${s.id === activeSessionId ? 'visible' : 'invisible'}`}
            >
              <TerminalInstance sessionId={s.id} isVisible={s.id === activeSessionId} />
            </div>
          ))}
          {sessions.length === 0 && (
            <div className="flex items-center justify-center h-full text-foreground-subtle text-[13px]">
              <button
                onClick={() => handleNewTerminal('shell')}
                className="flex items-center gap-2 px-4 py-2 rounded-md border border-white/[0.08] hover:bg-white/[0.04] transition-colors"
              >
                <Plus size={13} /> New terminal
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
