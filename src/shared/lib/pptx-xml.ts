/**
 * Phase 31 §7.6 — a PowerPoint deck's words, in slide order, without a
 * renderer: the fallback when the conversion engine cannot show the slides.
 *
 * Plain string work over the parts, no DOM (it runs in a worker, which has
 * no DOMParser). Slide N means what PowerPoint means by it: the order of
 * `sldIdLst` in presentation.xml, not the number in the part's file name —
 * the two drift apart as soon as a slide is moved.
 */
import { decodeXml } from './xlsx-xml';

export interface SlideText {
  /** 1-based, in presentation order. */
  n: number;
  title: string | null;
  /** Every other paragraph with text, in document order: body and shapes; a table row is one line. */
  paragraphs: string[];
}

/** The slide parts in presentation order, as zip paths (`ppt/slides/slide3.xml`). */
export function slideOrder(presentationXml: string | null, relsXml: string | null, partNames: string[]): string[] {
  const present = new Set(partNames);
  const targets = new Map<string, string>();
  for (const m of (relsXml ?? '').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = m[0].match(/\bId="([^"]+)"/)?.[1];
    const target = m[0].match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) targets.set(id, resolvePart('ppt/', decodeXml(target)));
  }
  const ordered: string[] = [];
  const list = presentationXml?.match(/<p:sldIdLst\b[^>]*>([\s\S]*?)<\/p:sldIdLst>/)?.[1] ?? '';
  for (const m of list.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)) {
    const part = targets.get(m[1]);
    if (part && present.has(part) && !ordered.includes(part)) ordered.push(part);
  }
  if (ordered.length > 0) return ordered;
  // No usable order: the file names' numbers are the best there is.
  return partNames
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]));
}

function resolvePart(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').filter(Boolean);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

function paragraphText(p: string): string {
  const runs: string[] = [];
  for (const m of p.matchAll(/<a:t>([^<]*)<\/a:t>|<a:t\s[^>]*>([^<]*)<\/a:t>|<a:br\b[^>]*\/>/g)) {
    runs.push(m[0].startsWith('<a:br') ? ' ' : decodeXml(m[1] ?? m[2] ?? ''));
  }
  return runs.join('').replace(/\s+/g, ' ').trim();
}

/** A slide's title (its title placeholder) and the rest of its words. */
export function slideText(n: number, slideXml: string): SlideText {
  let title: string | null = null;
  const paragraphs: string[] = [];
  // Shapes, pictures' captions and table frames, in the order they are drawn.
  for (const m of slideXml.matchAll(/<p:(sp|graphicFrame)\b[\s\S]*?<\/p:\1>/g)) {
    const shape = m[0];
    const isTitle = /<p:ph\b[^>]*\btype="(title|ctrTitle)"/.test(shape);
    const paragraphsOf = (xml: string) => Array.from(xml.matchAll(/<a:p\/>|<a:p(?:\s[^>]*[^/])?>[\s\S]*?<\/a:p>/g))
      .map((p) => paragraphText(p[0]))
      .filter(Boolean);
    // A table reads as rows, one line each, its cells in order: "EMEA · 107 · 120".
    const rows = Array.from(shape.matchAll(/<a:tr(?:\s[^>]*)?>[\s\S]*?<\/a:tr>/g));
    const texts = rows.length > 0
      ? rows
        .map((r) => Array.from(r[0].matchAll(/<a:tc(?:\s[^>]*)?\/>|<a:tc(?:\s[^>]*[^/])?>[\s\S]*?<\/a:tc>/g)).map((c) => paragraphsOf(c[0]).join(' ')).join(' · '))
        .filter((line) => line.replace(/[\s·]/g, '') !== '')
      : paragraphsOf(shape);
    if (isTitle && title === null && texts.length > 0) title = texts.join(' ');
    else paragraphs.push(...texts);
  }
  return { n, title, paragraphs };
}

/** The deck's thumbnail part, from the package relationships (`docProps/thumbnail.jpeg`). */
export function thumbnailPart(packageRelsXml: string | null): string | null {
  for (const m of (packageRelsXml ?? '').matchAll(/<Relationship\b[^>]*>/g)) {
    if (!/\bType="[^"]*\/metadata\/thumbnail"/.test(m[0])) continue;
    const target = m[0].match(/\bTarget="([^"]+)"/)?.[1];
    if (target) return resolvePart('', decodeXml(target));
  }
  return null;
}
