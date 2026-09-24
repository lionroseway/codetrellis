/**
 * Phase 31 §5.1 — a Word document's HTML, from mammoth, as markdown.
 *
 * mammoth has a markdown writer, but it writes a table as one paragraph per
 * cell, and a table is often the part of a board summary an analyst cites.
 * Its HTML is small and regular — headings, paragraphs, lists, tables,
 * emphasis, links, images, line breaks, every text node escaped — so this
 * walks those tags and writes GFM, tables as tables.
 *
 * The output is text for an agent to read. Nothing here is rendered.
 */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

interface ListCtx { ordered: boolean; n: number }
interface TableCtx { rows: string[][]; row: string[] | null; cell: string | null }

export function docxHtmlToMarkdown(html: string): string {
  const out: string[] = [];
  const lists: ListCtx[] = [];
  const tables: TableCtx[] = [];
  let line = '';
  let prefix = '';
  const links: Array<string | null> = [];

  const write = (s: string) => {
    const t = tables[tables.length - 1];
    if (t && t.cell !== null) t.cell += s;
    else line += s;
  };
  const flush = (blank: boolean) => {
    const text = line.replace(/[ \t]+/g, ' ').trim();
    if (text) out.push(prefix + text);
    if (blank && out.length && out[out.length - 1] !== '') out.push('');
    line = '';
    prefix = '';
  };

  for (const m of html.matchAll(/<(\/?)([a-z][a-z0-9]*)\b([^>]*?)\/?>|([^<]+)/gi)) {
    if (m[4] !== undefined) { write(decode(m[4])); continue; }
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3] ?? '';
    const inCell = tables.length > 0 && tables[tables.length - 1].cell !== null;

    switch (tag) {
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
        if (inCell) { if (closing) write(' '); break; }
        if (closing) flush(true);
        else { flush(false); prefix = `${'#'.repeat(Number(tag[1]))} `; }
        break;
      case 'p':
        if (inCell) { if (closing) write(' '); break; }
        if (closing) flush(lists.length === 0);
        else if (lists.length === 0) flush(false);
        break;
      case 'ul': case 'ol':
        if (inCell) break;
        if (closing) { flush(false); lists.pop(); if (lists.length === 0 && out.length && out[out.length - 1] !== '') out.push(''); }
        else { flush(false); lists.push({ ordered: tag === 'ol', n: 0 }); }
        break;
      case 'li': {
        if (inCell) { write(closing ? '; ' : ''); break; }
        if (closing) { flush(false); break; }
        flush(false);
        const l = lists[lists.length - 1];
        const depth = Math.max(0, lists.length - 1);
        prefix = `${'  '.repeat(depth)}${l?.ordered ? `${++l.n}.` : '-'} `;
        break;
      }
      case 'table':
        if (!closing) {
          if (!inCell) flush(true);
          tables.push({ rows: [], row: null, cell: null });
        } else {
          const t = tables.pop();
          if (!t) break;
          if (tables.length > 0) {
            // A table inside a cell reads as its rows, in the cell.
            write(t.rows.map((r) => r.join(', ')).join('; '));
          } else {
            out.push(...gfmTable(t.rows), '');
          }
        }
        break;
      case 'tr': {
        const t = tables[tables.length - 1];
        if (!t) break;
        if (closing) { if (t.row) t.rows.push(t.row); t.row = null; } else t.row = [];
        break;
      }
      case 'td': case 'th': {
        const t = tables[tables.length - 1];
        if (!t) break;
        if (closing) { (t.row ??= []).push((t.cell ?? '').replace(/\s+/g, ' ').trim()); t.cell = null; } else t.cell = '';
        break;
      }
      case 'strong': case 'b': write('**'); break;
      case 'em': case 'i': write('_'); break;
      case 's': case 'del': write('~~'); break;
      case 'br': if (inCell) write(' '); else { flush(false); } break;
      case 'a': {
        if (!closing) {
          const href = attrs.match(/\bhref="([^"]*)"/)?.[1];
          links.push(href ? decode(href) : null);
          if (href) write('[');
        } else {
          const href = links.pop();
          if (href) write(`](${href})`);
        }
        break;
      }
      case 'img': {
        const alt = attrs.match(/\balt="([^"]*)"/)?.[1];
        write(alt ? `[image: ${decode(alt)}]` : '[image]');
        break;
      }
      default:
        break;
    }
  }
  flush(false);
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

function gfmTable(rows: string[][]): string[] {
  if (rows.length === 0) return [];
  const width = Math.max(...rows.map((r) => r.length));
  const cell = (s: string | undefined) => (s ?? '').replace(/\|/g, '\\|');
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => cell(r[i])).join(' | ')} |`;
  return [line(rows[0]), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`, ...rows.slice(1).map(line)];
}
