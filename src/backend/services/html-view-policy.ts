/**
 * Phase 31 §7.3 — what the sandboxed HTML view may load, and with what
 * headers. Pure: Electron main (src/electron/html-view.ts) applies it.
 *
 * HTML is the one format that is a program. A test report or an analyst's
 * export is shown in its own WebContentsView — sandboxed, no preload, its own
 * in-memory session — and that view can reach exactly one thing: the
 * `ct-html://<attachment uid>/…` scheme, which serves files from the
 * report's own folder and nowhere else.
 */

import path from 'node:path';
import type { ReadStream } from 'node:fs';
import { openReadStreamWithin } from './confined-fs';

/** What a report's folder may serve, by extension. Everything else is a 404. */
const ASSET_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  json: 'application/json', txt: 'text/plain; charset=utf-8', map: 'application/json',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  mp4: 'video/mp4', webm: 'video/webm',
};

export function htmlAssetType(rel: string): string | null {
  return ASSET_TYPES[path.extname(rel).slice(1).toLowerCase()] ?? null;
}

/**
 * The file a `ct-html` URL path names, relative to the project root, or
 * null when it would leave the report's folder. `reportRel` is the recorded
 * report's own path (`reports/e2e/index.html`); the URL path is resolved
 * against that file's folder. Lexical only — the caller opens the result
 * through confined-fs, which refuses a link at any component.
 */
export function reportAssetPath(reportRel: string, urlPath: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(urlPath); } catch { return null; }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const folder = path.posix.dirname(reportRel.split(path.sep).join('/'));
  const wanted = decoded.replace(/^\/+/, '') || path.posix.basename(reportRel);
  const rel = path.posix.normalize(path.posix.join(folder, wanted));
  if (rel === '..' || rel.startsWith('../') || path.posix.isAbsolute(rel)) return null;
  if (folder !== '.' && !rel.startsWith(`${folder}/`)) return null;
  return rel;
}

/**
 * The Content-Security-Policy every ct-html response carries. No
 * connect-src at all: a page — even with its scripts running — cannot fetch,
 * post or open a socket. Scripts are the report's own files and inline
 * blocks, and only when the person turned them on for this artefact.
 */
export function htmlViewCsp(scripts: boolean): string {
  return [
    "default-src 'none'",
    "img-src ct-html: data: blob:",
    "style-src ct-html: 'unsafe-inline'",
    "font-src ct-html: data:",
    "media-src ct-html: data: blob:",
    scripts ? "script-src ct-html: 'unsafe-inline'" : "script-src 'none'",
    scripts ? "worker-src blob: ct-html:" : "worker-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

/**
 * Where the view may go: another page of the same report (a coverage
 * report's file pages), never out of it. Same scheme, same attachment.
 */
export function isSameReport(current: string, target: string): boolean {
  try {
    const a = new URL(current);
    const b = new URL(target);
    return a.protocol === 'ct-html:' && b.protocol === 'ct-html:' && a.host === b.host;
  } catch {
    return false;
  }
}

export interface ReportFileResponse {
  status: number;
  headers: Record<string, string>;
  stream: ReadStream | null;
  error?: string;
}

/**
 * One file of a report whose own location is already known and trusted
 * (`root` is a trusted project root, `rel` the recorded HTML file). The path
 * is resolved against the report's folder, then opened through confined-fs,
 * which refuses a link at any component.
 */
export function serveReportFile(report: { root: string; rel: string }, urlPath: string, scripts: boolean): ReportFileResponse {
  const notFound: ReportFileResponse = { status: 404, headers: {}, stream: null, error: 'Not part of this report' };
  if (!/\.html?$/i.test(report.rel)) return notFound;
  const rel = reportAssetPath(report.rel, urlPath);
  const type = rel ? htmlAssetType(rel) : null;
  if (!rel || !type) return notFound;
  let opened: ReturnType<typeof openReadStreamWithin>;
  try {
    opened = openReadStreamWithin(report.root, rel, {}, 'report file');
  } catch {
    return notFound;
  }
  return {
    status: 200,
    stream: opened.stream,
    headers: {
      'Content-Type': type,
      'Content-Length': String(opened.size),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': htmlViewCsp(scripts),
    },
  };
}
