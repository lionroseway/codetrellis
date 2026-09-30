/**
 * Phase 32 B7.1 — sections of a spec page, addressed by their heading.
 *
 * A task can say it relies on a whole page or on one section of it. A
 * section is a markdown heading and everything under it until the next
 * heading at the same level or above; it is addressed by its slug, so
 * "## Fields" is `fields` and "### Currency (ISO 4217)" is
 * `currency-iso-4217`. Two headings with the same text get `-2`, `-3`, as
 * GitHub does, so every section has one address. Headings inside fenced
 * code are not headings.
 */

export interface SpecSection {
  slug: string;
  title: string;
  level: number;
  /** Line index of the heading. */
  line: number;
  /** Line index after the section's last line. */
  end: number;
}

/** "Currency (ISO 4217)" → "currency-iso-4217". */
export function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_~[\]()<>]/g, ' ')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/[\s-]+/g, '-');
}

/** Every heading in a markdown body, in order, with its slug and extent. */
export function specSections(body: string): SpecSection[] {
  const lines = (body ?? '').split('\n');
  const found: Array<Omit<SpecSection, 'slug' | 'end'> & { base: string }> = [];
  let fence: string | null = null;
  lines.forEach((line, i) => {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      return;
    }
    if (fence) return;
    const h = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) found.push({ title: h[2].trim(), level: h[1].length, line: i, base: headingSlug(h[2]) });
  });
  const seen = new Map<string, number>();
  return found.map((h, k) => {
    const n = (seen.get(h.base) ?? 0) + 1;
    seen.set(h.base, n);
    const next = found.slice(k + 1).find((o) => o.level <= h.level);
    return { slug: n === 1 ? h.base : `${h.base}-${n}`, title: h.title, level: h.level, line: h.line, end: next ? next.line : lines.length };
  });
}

/** The section a slug names, or undefined when the page has no such heading. */
export function findSection(body: string, slug: string): SpecSection | undefined {
  return specSections(body).find((s) => s.slug === slug);
}

/** A section's text, its heading included. */
export function sectionText(body: string, slug: string): string | undefined {
  const s = findSection(body, slug);
  if (!s) return undefined;
  return (body ?? '').split('\n').slice(s.line, s.end).join('\n');
}

/**
 * Phase 32 B7.2 — the page as it would read with a section's text replaced
 * (heading included), or the whole body when no section is named. Undefined
 * when the section is not on the page.
 */
export function withSectionText(body: string, slug: string | null | undefined, text: string): string | undefined {
  if (!slug) return text;
  const s = findSection(body, slug);
  if (!s) return undefined;
  const lines = (body ?? '').split('\n');
  const replacement = text.replace(/\n+$/, '').split('\n');
  // Keep one blank line before the next section when the old text had one.
  const hadGap = s.end < lines.length && lines[s.end - 1] === '';
  const tail = hadGap && replacement[replacement.length - 1] !== '' ? [''] : [];
  return [...lines.slice(0, s.line), ...replacement, ...tail, ...lines.slice(s.end)].join('\n');
}
