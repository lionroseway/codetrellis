/// <reference lib="webworker" />
/**
 * Phase 31 §7.2 — a Word document converted in a worker, with caps.
 *
 * mammoth turns a .docx into plain HTML: headings, paragraphs, lists,
 * tables and images survive; page layout does not. Its output is NOT
 * trusted markup — the page runs it through DOMPurify before any of it
 * reaches the DOM.
 *
 * mammoth inflates the archive itself, without limits. So every entry is
 * first inflated here under the budget and thrown away: inflation is
 * deterministic, so an archive that passes cannot give mammoth more than
 * the budget allowed. Images come back as bytes, never as data: URIs in
 * the HTML, so the page decides what becomes an image source.
 */
import mammoth from 'mammoth';
import { CapError, listEntries, readEntry, type InflateBudget } from '../../shared/lib/zip-reader';

export interface DocxRequest { buffer: ArrayBuffer }
export interface DocxImage { contentType: string; bytes: Uint8Array }
export type DocxReply =
  | { ok: true; html: string; images: DocxImage[]; imagesOmitted: number }
  | { ok: false; reason: string };

const MAX_PART_BYTES = 30 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_IMAGES = 200;
const MAX_HTML_CHARS = 5_000_000;
/** What an `<img>` can show. Anything else (EMF, WMF, TIFF) is left out and counted. */
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp']);

async function convert(buffer: ArrayBuffer): Promise<DocxReply> {
  const view = new DataView(buffer);
  const entries = listEntries(view);
  if (!entries.some((e) => e.name === 'word/document.xml')) {
    return { ok: false, reason: 'This is not a Word document (.docx) — it has no document part.' };
  }
  // Every entry, by position rather than name: two entries can share a name.
  const budget: InflateBudget = { maxPart: MAX_PART_BYTES, maxTotal: MAX_TOTAL_BYTES, used: 0 };
  for (const e of entries) await readEntry(view, e, budget);

  const images: DocxImage[] = [];
  let imagesOmitted = 0;
  const result = await mammoth.convertToHtml({ arrayBuffer: buffer }, {
    // A document can link an image by path instead of embedding it. Never follow one.
    externalFileAccess: false,
    convertImage: mammoth.images.imgElement(async (image) => {
      if (images.length >= MAX_IMAGES || !IMAGE_TYPES.has(image.contentType)) {
        imagesOmitted++;
        return { src: '', 'data-ct-omitted': 'true' } as { src: string };
      }
      images.push({ contentType: image.contentType, bytes: new Uint8Array(await image.readAsArrayBuffer()) });
      return { src: '', 'data-ct-img': String(images.length - 1) } as { src: string };
    }),
  });
  if (result.value.length > MAX_HTML_CHARS) {
    return { ok: false, reason: 'This document is too long to preview here.' };
  }
  return { ok: true, html: result.value, images, imagesOmitted };
}

self.onmessage = async (e: MessageEvent<DocxRequest>) => {
  let reply: DocxReply;
  try {
    reply = await convert(e.data.buffer);
  } catch (err) {
    reply = { ok: false, reason: err instanceof CapError ? err.message : `The document could not be read (${(err as Error).message}).` };
  }
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(reply);
};
