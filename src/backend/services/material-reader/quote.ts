/**
 * Phase 31 §5.1 — material content, framed as quoted material.
 *
 * What a file says is data. Each section goes back inside a fence longer
 * than any run of backticks in it, so a cell or a page cannot close the
 * quote and carry on as if it were the tool speaking; the line above each
 * fence says whose words these are.
 */
import type { ReadSection } from './read';

const LANG: Record<string, string> = { csv: 'csv', markdown: 'markdown', text: 'text' };

export function fenceFor(body: string): string {
  let longest = 0;
  for (const m of body.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  return '`'.repeat(Math.max(3, longest + 1));
}

export function quoteMaterial(name: string, format: string, sections: ReadSection[]): string {
  if (sections.length === 0) return `Quoted from ${name}: (nothing in the part asked for)`;
  return sections.map((s) => {
    const fence = fenceFor(s.body);
    return `Quoted from ${name} — ${s.heading}:\n${fence}${LANG[format] ?? 'text'}\n${s.body}\n${fence}`;
  }).join('\n\n');
}
