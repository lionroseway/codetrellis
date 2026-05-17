import { useState } from 'react';
import { Activity, Database, Cpu, Copy, Check, SquareTerminal } from 'lucide-react';
import { useProjectStore } from '../../stores/project-store';
import { useAgentStore } from '../../stores/agent-store';
import { useTerminalStore } from '../../stores/terminal-store';

export function StatusBar() {
  const scanStatus = useProjectStore((s) => s.scanStatus);
  const root = useProjectStore((s) => s.root);
  const agentStatus = useAgentStore((s) => s.status);
  const eventCount = useAgentStore((s) => s.events.length);
  const [copied, setCopied] = useState(false);

  const handleCopyMcpConfig = async () => {
    try {
      const res = await fetch('/api/mcp/config');
      const config = await res.json();
      await navigator.clipboard.writeText(JSON.stringify(config, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      await navigator.clipboard.writeText('{"codetrellis":{"type":"sse","url":"http://127.0.0.1:19432/sse"}}');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="glass-panel flex items-center h-6 px-3 border-t text-[10px] text-foreground-subtle gap-4 shrink-0">
      <span className="flex items-center gap-1.5">
        <span
          className={`w-1.5 h-1.5 rounded-full transition-all ${
            scanStatus === 'ready' ? 'bg-success shadow-[0_0_4px_rgba(34,197,94,0.5)]' :
            scanStatus === 'scanning' ? 'bg-warning shadow-[0_0_4px_rgba(245,158,11,0.5)] animate-pulse' :
            scanStatus === 'error' ? 'bg-danger shadow-[0_0_4px_rgba(239,68,68,0.5)]' : 'bg-foreground-subtle'
          }`}
        />
        {scanStatus === 'idle' && 'No project'}
        {scanStatus === 'scanning' && 'Scanning...'}
        {scanStatus === 'ready' && 'Ready'}
        {scanStatus === 'error' && 'Error'}
      </span>

      {root && <span className="font-mono truncate max-w-64 opacity-50">{root}</span>}

      <div className="flex-1" />

      {eventCount > 0 && (
        <span className="flex items-center gap-1 text-accent">
          <Activity size={9} />
          {eventCount}
        </span>
      )}

      <button
        onClick={() => useTerminalStore.getState().togglePanel()}
        className="flex items-center gap-1 hover:text-foreground transition-all"
        title="Toggle terminal (Cmd+`)"
      >
        <SquareTerminal size={9} />
        Terminal
      </button>

      <button onClick={handleCopyMcpConfig} className="flex items-center gap-1 hover:text-foreground transition-all" title="Copy MCP config">
        <Database size={9} />
        MCP :19432
        {copied ? <Check size={9} className="text-success" /> : <Copy size={8} className="opacity-50" />}
      </button>

      <span className="flex items-center gap-1.5">
        <Cpu size={9} className={agentStatus === 'active' ? 'text-success' : ''} />
        <span className={`w-1 h-1 rounded-full ${agentStatus === 'active' ? 'bg-success shadow-[0_0_4px_rgba(34,197,94,0.6)] animate-pulse' : 'bg-foreground-subtle'}`} />
        {agentStatus === 'active' ? 'Connected' : 'Watching'}
      </span>
    </div>
  );
}
