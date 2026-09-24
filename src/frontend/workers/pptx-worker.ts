/// <reference lib="webworker" />
/**
 * Phase 31 §7.6 — a PowerPoint deck read in a worker, with caps: the
 * fallback for when the conversion engine cannot draw its slides.
 *
 * What comes back is words and one picture: each slide's title and text in
 * presentation order, and the thumbnail PowerPoint saves inside the file
 * (the first slide, small). Nothing is laid out and nothing is drawn — the
 * page labels this as a fallback. Every part read is inflated under the
 * budget (zip-reader.ts).
 */
import { CapError, listEntries, readEntry, readText, type InflateBudget } from './zip-reader';
import { slideOrder, slideText, thumbnailPart, type SlideText } from '../../shared/lib/pptx-xml';

export interface PptxRequest { buffer: ArrayBuffer }
export type PptxReply =
  | { ok: true; slides: SlideText[]; slidesOmitted: number; thumbnail: { contentType: string; bytes: Uint8Array } | null }
  | { ok: false; reason: string };

const MAX_PART_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 60 * 1024 * 1024;
const MAX_SLIDES = 500;
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const THUMBNAIL_TYPES: Record<string, string> = { jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png' };

async function read(buffer: ArrayBuffer): Promise<PptxReply> {
  const view = new DataView(buffer);
  const entries = listEntries(view);
  const names = entries.map((e) => e.name);
  if (!names.includes('ppt/presentation.xml')) {
    return { ok: false, reason: 'This is not a PowerPoint deck (.pptx) — it has no presentation part.' };
  }
  const budget: InflateBudget = { maxPart: MAX_PART_BYTES, maxTotal: MAX_TOTAL_BYTES, used: 0 };
  const order = slideOrder(
    await readText(view, entries, 'ppt/presentation.xml', budget),
    await readText(view, entries, 'ppt/_rels/presentation.xml.rels', budget),
    names,
  );

  const slides: SlideText[] = [];
  for (const [i, part] of order.slice(0, MAX_SLIDES).entries()) {
    const xml = await readText(view, entries, part, budget);
    slides.push(xml ? slideText(i + 1, xml) : { n: i + 1, title: null, paragraphs: [] });
  }

  let thumbnail: { contentType: string; bytes: Uint8Array } | null = null;
  const thumbName = thumbnailPart(await readText(view, entries, '_rels/.rels', budget));
  const thumbEntry = thumbName ? entries.find((e) => e.name === thumbName) : undefined;
  const thumbType = thumbName ? THUMBNAIL_TYPES[thumbName.split('.').pop()!.toLowerCase()] : undefined;
  if (thumbEntry && thumbType) {
    const bytes = await readEntry(view, thumbEntry, { maxPart: MAX_THUMBNAIL_BYTES, maxTotal: MAX_THUMBNAIL_BYTES, used: 0 })
      .catch(() => null);
    if (bytes) thumbnail = { contentType: thumbType, bytes };
  }
  return { ok: true, slides, slidesOmitted: Math.max(0, order.length - MAX_SLIDES), thumbnail };
}

self.onmessage = async (e: MessageEvent<PptxRequest>) => {
  let reply: PptxReply;
  try {
    reply = await read(e.data.buffer);
  } catch (err) {
    reply = { ok: false, reason: err instanceof CapError ? err.message : `The deck could not be read (${(err as Error).message}).` };
  }
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(reply);
};
