import { useState, useEffect } from 'react';
import { X, Copy, Check, Plug, Terminal, ExternalLink } from 'lucide-react';

const STEPS = [
  {
    title: 'Copy the MCP config',
    description: 'Click the button below to copy the CodeTrellis MCP server config to your clipboard.',
    action: 'copy',
  },
  {
    title: 'Add to your agent settings',
    description: 'Paste the config into your AI agent\'s MCP settings file.',
    details: [
      { agent: 'Claude Code', path: '~/.claude/settings.json → mcpServers' },
      { agent: 'Cursor', path: 'Settings → MCP Servers' },
      { agent: 'Custom agent', path: 'Add to your MCP client config' },
    ],
  },
  {
    title: 'Start using',
    description: 'Your agent can now query your codebase architecture, report plans, and check conformity through CodeTrellis.',
    tools: [
      { name: 'search_symbols', desc: 'Find functions, classes, interfaces by name' },
      { name: 'get_dependencies', desc: 'See what a file imports and what imports it' },
      { name: 'check_architecture', desc: 'Query the full dependency graph' },
      { name: 'report_plan', desc: 'Report intended plan (shown in UI)' },
      { name: 'check_conformity', desc: 'Verify imports won\'t create circular deps' },
    ],
  },
];

export function McpGuideModal() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mcpConfig, setMcpConfig] = useState('');

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('open-mcp-guide', handler);
    return () => window.removeEventListener('open-mcp-guide', handler);
  }, []);

  useEffect(() => {
    if (open) {
      fetch('/api/mcp/config')
        .then((r) => r.json())
        .then((config) => setMcpConfig(JSON.stringify(config, null, 2)))
        .catch(() => setMcpConfig('{"codetrellis":{"type":"sse","url":"http://127.0.0.1:19432/sse"}}'));
    }
  }, [open]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(mcpConfig);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)}>
      <div className="bg-surface-solid/95 backdrop-blur-xl border border-white/[0.08] rounded-2xl shadow-[0_0_40px_rgba(0,0,0,0.5)] w-[560px] max-h-[600px] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <div className="flex items-center gap-2">
            <Plug size={16} className="text-accent" />
            <h2 className="text-sm font-semibold text-foreground">Connect an AI Agent</h2>
          </div>
          <button onClick={() => setOpen(false)} className="text-foreground-subtle hover:text-foreground">
            <X size={14} />
          </button>
        </div>

        {/* Steps */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {STEPS.map((step, i) => (
            <div key={i} className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-[11px] font-bold text-accent">{i + 1}</span>
              </div>
              <div className="flex-1">
                <h3 className="text-xs font-semibold text-foreground mb-1">{step.title}</h3>
                <p className="text-[11px] text-foreground-muted mb-2">{step.description}</p>

                {step.action === 'copy' && (
                  <div className="space-y-2">
                    <pre className="text-[10px] font-mono bg-background border border-border rounded-lg p-3 text-foreground-muted overflow-x-auto">
                      {mcpConfig}
                    </pre>
                    <button
                      onClick={handleCopy}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-md bg-accent hover:bg-accent-hover text-white transition-colors font-medium"
                    >
                      {copied ? <Check size={12} /> : <Copy size={12} />}
                      {copied ? 'Copied!' : 'Copy Config'}
                    </button>
                  </div>
                )}

                {step.details && (
                  <div className="space-y-1.5">
                    {step.details.map((d) => (
                      <div key={d.agent} className="flex items-center gap-2 text-[11px]">
                        <Terminal size={11} className="text-foreground-subtle shrink-0" />
                        <span className="text-foreground font-medium">{d.agent}:</span>
                        <code className="text-foreground-muted font-mono">{d.path}</code>
                      </div>
                    ))}
                  </div>
                )}

                {step.tools && (
                  <div className="space-y-1">
                    {step.tools.map((t) => (
                      <div key={t.name} className="flex items-start gap-2 text-[11px] py-0.5">
                        <code className="text-accent font-mono shrink-0">{t.name}</code>
                        <span className="text-foreground-muted">{t.desc}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border-subtle">
          <a
            href="https://codetrellis.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[11px] text-foreground-subtle hover:text-foreground transition-colors"
          >
            <ExternalLink size={10} />
            codetrellis.dev
          </a>
          <button
            onClick={() => setOpen(false)}
            className="px-4 py-1.5 text-[11px] rounded-md bg-background border border-border text-foreground-muted hover:text-foreground hover:bg-surface-hover transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
