import { Fragment, type ReactNode } from 'react';

/**
 * Minimal markdown renderer for spec docs.
 *
 * Handles: headings (# ## ### #### ##### ######), unordered lists, ordered
 * lists, fenced code blocks, blockquotes, horizontal rules, and inline
 * styles (bold, italic, code, links). Good enough for spec docs; swap in
 * react-markdown later if we need GFM, tables, footnotes, etc.
 */
export function Markdown({ source }: { source: string }) {
  const blocks = parseBlocks(source || '');
  return <div className="markdown-body space-y-3 text-[12.5px] text-foreground leading-relaxed">{blocks}</div>;
}

type BlockNode =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'code'; lang: string; lines: string[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'hr' };

function parseBlocks(source: string): ReactNode[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: BlockNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) {
      i += 1;
      continue;
    }

    // Fenced code block
    const fenceMatch = line.match(/^```(\w*)\s*$/);
    if (fenceMatch) {
      const lang = fenceMatch[1] || '';
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      i += 1; // skip closing fence
      blocks.push({ kind: 'code', lang, lines: codeLines });
      continue;
    }

    // Horizontal rule
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push({ kind: 'hr' });
      i += 1;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      blocks.push({ kind: 'heading', level: headingMatch[1].length, text: headingMatch[2] });
      i += 1;
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({ kind: 'quote', lines: quoteLines });
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i += 1;
      }
      blocks.push({ kind: 'ul', items });
      continue;
    }

    // Ordered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
        i += 1;
      }
      blocks.push({ kind: 'ol', items });
      continue;
    }

    // Paragraph (one or more consecutive non-blank lines)
    const paraLines: string[] = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6}\s|>\s?|```|\s*[-*+]\s|\s*\d+[.)]\s|\s*-{3,}\s*$|\s*\*{3,}\s*$)/.test(lines[i])) {
      paraLines.push(lines[i]);
      i += 1;
    }
    if (paraLines.length > 0) {
      blocks.push({ kind: 'paragraph', lines: paraLines });
    }
  }

  return blocks.map((block, idx) => renderBlock(block, idx));
}

function renderBlock(block: BlockNode, key: number): ReactNode {
  switch (block.kind) {
    case 'heading': {
      const sizeClass = ['text-[18px] font-semibold', 'text-[16px] font-semibold', 'text-[14px] font-semibold', 'text-[13px] font-semibold uppercase tracking-wide text-foreground-muted', 'text-[12px] font-semibold uppercase tracking-wide text-foreground-muted', 'text-[11px] font-semibold uppercase tracking-wide text-foreground-muted'][Math.min(block.level - 1, 5)];
      const Tag = (`h${Math.min(block.level, 6)}`) as 'h1';
      return <Tag key={key} className={`${sizeClass} mt-4 mb-1`}>{renderInline(block.text)}</Tag>;
    }
    case 'paragraph':
      return <p key={key}>{renderInline(block.lines.join(' '))}</p>;
    case 'ul':
      return (
        <ul key={key} className="list-disc pl-5 space-y-1">
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol key={key} className="list-decimal pl-5 space-y-1">
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ol>
      );
    case 'code':
      return (
        <pre key={key} className="rounded-lg border border-white/[0.06] bg-black/30 p-3 overflow-x-auto text-[11.5px] font-mono leading-relaxed">
          <code>{block.lines.join('\n')}</code>
        </pre>
      );
    case 'quote':
      return (
        <blockquote key={key} className="border-l-2 border-accent/40 pl-3 text-foreground-muted italic">
          {block.lines.map((line, i) => (
            <p key={i}>{renderInline(line)}</p>
          ))}
        </blockquote>
      );
    case 'hr':
      return <hr key={key} className="border-white/[0.06]" />;
  }
}

function renderInline(text: string): ReactNode[] {
  // Tokenize inline markdown: code, bold, italic, link.
  const nodes: ReactNode[] = [];
  let cursor = 0;
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)|(\[[^\]]+\]\([^)]+\))/g;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      nodes.push(<Fragment key={key++}>{text.slice(cursor, match.index)}</Fragment>);
    }
    const token = match[0];
    if (token.startsWith('`')) {
      nodes.push(<code key={key++} className="rounded bg-white/[0.06] px-1 py-0.5 text-[11.5px] font-mono text-amber-200/90">{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={key++} className="font-semibold text-foreground">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*') || token.startsWith('_')) {
      nodes.push(<em key={key++} className="italic">{token.slice(1, -1)}</em>);
    } else if (token.startsWith('[')) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        nodes.push(
          <a key={key++} href={linkMatch[2]} target="_blank" rel="noreferrer" className="text-accent hover:underline">
            {linkMatch[1]}
          </a>
        );
      }
    }
    cursor = match.index + token.length;
  }

  if (cursor < text.length) {
    nodes.push(<Fragment key={key++}>{text.slice(cursor)}</Fragment>);
  }
  return nodes;
}
