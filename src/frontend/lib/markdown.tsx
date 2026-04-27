import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Markdown renderer for spec docs, plan descriptions, agent skill
 * guides, and any other agent-readable content. Uses `react-markdown`
 * + `remark-gfm` so tables, task lists, strikethrough, and autolinks
 * all work.
 *
 * Rationale: plans + tasks + spec docs are stored as markdown so AI
 * agents can read AND write them via MCP without us having to expose
 * a structured field for every concept. The renderer matches the
 * Tailwind dark theme.
 */
export function Markdown({ source }: { source: string }) {
  return (
    <div className="markdown-body space-y-3 text-[12.5px] text-foreground leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="text-[18px] font-semibold mt-4 mb-1">{children}</h1>,
          h2: ({ children }) => <h2 className="text-[16px] font-semibold mt-4 mb-1">{children}</h2>,
          h3: ({ children }) => <h3 className="text-[14px] font-semibold mt-3 mb-1">{children}</h3>,
          h4: ({ children }) => (
            <h4 className="text-[13px] font-semibold uppercase tracking-wide text-foreground-muted mt-3 mb-1">{children}</h4>
          ),
          h5: ({ children }) => (
            <h5 className="text-[12px] font-semibold uppercase tracking-wide text-foreground-muted mt-3 mb-1">{children}</h5>
          ),
          h6: ({ children }) => (
            <h6 className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted mt-3 mb-1">{children}</h6>
          ),
          p: ({ children }) => <p>{children}</p>,
          ul: ({ children }) => <ul className="list-disc pl-5 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-accent/40 pl-3 text-foreground-muted italic">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="border-white/[0.06]" />,
          code: ({ inline, className, children, ...rest }: any) => {
            if (inline) {
              return (
                <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[11.5px] font-mono text-amber-200/90" {...rest}>
                  {children}
                </code>
              );
            }
            return (
              <code className={className || ''} {...rest}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="rounded-lg border border-white/[0.06] bg-black/30 p-3 overflow-x-auto text-[11.5px] font-mono leading-relaxed">
              {children}
            </pre>
          ),
          // GFM tables
          table: ({ children }) => (
            <div className="overflow-x-auto rounded-lg border border-white/[0.06]">
              <table className="w-full text-[11.5px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-white/[0.04] text-foreground-muted">{children}</thead>,
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => <tr className="border-t border-white/[0.04]">{children}</tr>,
          th: ({ children }) => <th className="px-2 py-1 text-left font-semibold">{children}</th>,
          td: ({ children }) => <td className="px-2 py-1 align-top">{children}</td>,
          // GFM task lists — react-markdown emits checkbox inputs
          input: ({ checked, type, ...rest }: any) =>
            type === 'checkbox' ? (
              <input
                type="checkbox"
                checked={!!checked}
                readOnly
                className="mr-1.5 align-middle accent-accent"
                {...rest}
              />
            ) : (
              <input type={type} {...rest} />
            ),
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          del: ({ children }) => <del className="opacity-60">{children}</del>,
        }}
      >
        {source || ''}
      </ReactMarkdown>
    </div>
  );
}
