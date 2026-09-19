import { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, Check, Sparkles, Plug } from 'lucide-react';
import { GUIDE_SECTIONS, GUIDE_GROUPS, type GuideSection } from './guide-content';

/**
 * The in-app guide — rail on the left, one topic at a time on the right.
 *
 * It replaces a three-step "copy the MCP config" wizard that described five
 * tools, one of which (`report_plan`) has never existed, and said nothing
 * about plans, channels, system docs, review, budgets, tickets, terminals
 * or the phone. A linear carousel is the wrong shape for that much surface:
 * people arrive wanting one answer, not a tour.
 *
 * Every topic carries prompts you can copy straight into a connected agent.
 * That is deliberate. Describing a feature leaves the reader to work out
 * how to reach it; handing them the sentence turns reading into doing, and
 * it is how they find out the thing on the page is real.
 *
 * It also absorbed `LearnTrellis`, a nine-step first-run carousel. The
 * content was good and the shape was not: a carousel is read once and then
 * unreachable, and its copy had already gone stale ("the MCP server exposes
 * 30+ tools" — it is 174). What it said that the guide did not now lives in
 * the relevant topics.
 */

/**
 * Set once the guide has been shown unprompted, so it does not ambush
 * someone on every launch. Named for the guide rather than the carousel it
 * replaced; a profile that had seen the old one gets this once, which is
 * right — it is not the same content.
 */
export const GUIDE_SEEN_KEY = 'codetrellis:guide:seen';

export function GuideModal() {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState(GUIDE_SECTIONS[0].id);
  const [mcpConfig, setMcpConfig] = useState('');

  useEffect(() => {
    const handler = (e: Event) => {
      const wanted = (e as CustomEvent<{ section?: string } | undefined>).detail?.section;
      if (wanted && GUIDE_SECTIONS.some((s) => s.id === wanted)) setActiveId(wanted);
      setOpen(true);
    };
    window.addEventListener('open-mcp-guide', handler);
    return () => window.removeEventListener('open-mcp-guide', handler);
  }, []);

  useEffect(() => {
    if (!open) return;
    fetch('/api/mcp/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => cfg && setMcpConfig(JSON.stringify(cfg, null, 2)))
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const active = useMemo(
    () => GUIDE_SECTIONS.find((s) => s.id === activeId) ?? GUIDE_SECTIONS[0],
    [activeId],
  );

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-6"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-5xl h-[80vh] flex rounded-xl border border-white/[0.08] bg-surface-solid/95 shadow-[0_0_40px_rgba(0,0,0,0.6)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="CodeTrellis guide"
      >
        {/* Rail */}
        <nav className="w-56 shrink-0 border-r border-white/[0.06] bg-white/[0.015] overflow-y-auto py-3">
          {GUIDE_GROUPS.map((group) => {
            const inGroup = GUIDE_SECTIONS.filter((s) => s.group === group);
            if (inGroup.length === 0) return null;
            return (
              <div key={group} className="mb-3">
                <div className="px-3 pb-1 text-[9.5px] uppercase tracking-[0.12em] text-foreground-subtle">
                  {group}
                </div>
                {inGroup.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setActiveId(s.id)}
                    className={`w-full text-left px-3 py-1.5 text-[12px] transition-colors ${
                      s.id === activeId
                        ? 'bg-accent/10 text-accent border-l-2 border-accent'
                        : 'text-foreground-muted hover:text-foreground hover:bg-white/[0.03] border-l-2 border-transparent'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>

        {/* Main */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3 border-b border-white/[0.06]">
            <div className="min-w-0">
              <div className="text-[9.5px] uppercase tracking-[0.12em] text-foreground-subtle">
                {active.group}
              </div>
              <h2 className="text-[16px] font-semibold text-foreground mt-0.5">{active.title}</h2>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-foreground-subtle hover:text-foreground p-1 rounded hover:bg-white/[0.05] shrink-0"
              aria-label="Close guide"
            >
              <X size={15} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            <p className="text-[12.5px] leading-relaxed text-foreground-muted">{active.blurb}</p>

            {active.points && active.points.length > 0 && (
              <ul className="space-y-1.5">
                {active.points.map((p, i) => (
                  <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-foreground-muted">
                    <span className="text-accent/60 shrink-0">—</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            )}

            {active.id === 'connect-agent' && (
              <McpConfigBlock config={mcpConfig} />
            )}

            {active.asks && active.asks.length > 0 && (
              <div className="space-y-2 pt-1">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-foreground-subtle">
                  <Sparkles size={11} className="text-accent" />
                  Ask your agent
                </div>
                {active.asks.map((ask, i) => (
                  <AskCard key={i} prompt={ask.prompt} note={ask.note} />
                ))}
              </div>
            )}

            {active.tools && active.tools.length > 0 && (
              <div className="pt-1">
                <div className="text-[10px] uppercase tracking-[0.12em] text-foreground-subtle mb-1.5">
                  Behind this
                </div>
                <div className="flex flex-wrap gap-1">
                  {active.tools.map((t) => (
                    <code
                      key={t}
                      className="px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06] text-[10.5px] font-mono text-foreground-subtle"
                    >
                      {t}
                    </code>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** A prompt the reader can put straight into their agent. */
function AskCard({ prompt, note }: { prompt: string; note?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    navigator.clipboard.writeText(prompt).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => { /* clipboard blocked — the text is on screen to select */ },
    );
  }, [prompt]);

  return (
    <div className="rounded-lg border border-accent/20 bg-accent/[0.04] p-2.5">
      <div className="flex items-start gap-2">
        <p className="flex-1 text-[12px] leading-relaxed text-foreground">&ldquo;{prompt}&rdquo;</p>
        <button
          onClick={copy}
          className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md border border-white/[0.08] text-[10.5px] text-foreground-muted hover:text-foreground hover:bg-white/[0.05] transition-colors"
          title="Copy this prompt"
        >
          {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {note && (
        <p className="mt-1.5 text-[10.5px] leading-snug text-foreground-subtle">{note}</p>
      )}
    </div>
  );
}

/** The connect-an-agent config, kept where the instructions are. */
function McpConfigBlock({ config }: { config: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="rounded-lg border border-white/[0.08] bg-black/25 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/[0.06]">
        <span className="flex items-center gap-1.5 text-[10.5px] text-foreground-muted">
          <Plug size={11} className="text-accent" />
          MCP server config
        </span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(config).then(
              () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
              () => {},
            );
          }}
          disabled={!config}
          className="flex items-center gap-1 px-2 py-0.5 rounded-md border border-white/[0.08] text-[10.5px] text-foreground-muted hover:text-foreground hover:bg-white/[0.05] disabled:opacity-40"
        >
          {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="px-3 py-2 text-[10.5px] font-mono text-foreground-muted overflow-x-auto">
        {config || 'Loading…'}
      </pre>
    </div>
  );
}
