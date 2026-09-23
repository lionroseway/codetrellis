/**
 * Phase 15 §15.D — attachment helpers shared across V2 surfaces
 * (canvas drag-drop, attachments panel, paste handlers, code-block
 * picker). Centralised so kind detection + base64 conversion live in
 * one place.
 */

import type { AttachmentKind } from '@shared/types';
import { artefactSrcUrl } from './artefact-src';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v']);
const CODE_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'rs', 'go', 'java', 'kt', 'rb', 'php',
  'c', 'cpp', 'h', 'hpp', 'cs', 'swift',
  'sh', 'bash', 'zsh', 'fish',
  'sql', 'graphql', 'proto',
  'css', 'scss', 'less', 'html', 'vue', 'svelte',
  'json', 'yaml', 'yml', 'toml', 'xml',
  'md',
]);

/**
 * Classify a path / mime / File object into an `AttachmentKind`.
 * Used by drag-drop and file picker to decide whether to upload as
 * image / video / file_ref / code_block.
 */
export function classifyAttachment(input: { path?: string; mime?: string; size?: number }): AttachmentKind {
  const mime = input.mime?.toLowerCase() ?? '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';

  const ext = input.path ? extOf(input.path) : '';
  if (ext && IMAGE_EXTS.has(ext)) return 'image';
  if (ext && VIDEO_EXTS.has(ext)) return 'video';
  // For code-shaped files we still attach as file_ref (path) by default;
  // the user can promote to code_block via the picker. Auto-promoting
  // would force a snapshot read which we want explicit.
  return 'file_ref';
}

function extOf(p: string): string {
  const m = p.match(/\.([a-z0-9]{1,8})$/i);
  return m ? m[1].toLowerCase() : '';
}

/**
 * Convert a `File` or `Blob` to a base64 string suitable for the
 * `data_base64` field on `add_item_attachment`. Strips the `data:`
 * URL prefix.
 */
export async function fileToBase64(file: File | Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Make a project-relative path from an absolute one if it's inside
 * the project. Otherwise return the absolute path unchanged (the
 * attachment will reference an external file — UX-allowed but the
 * project repo can't carry it on `git pull`).
 */
export function relativeIfPossible(abs: string, projectRoot?: string): string {
  if (!projectRoot) return abs;
  const normRoot = projectRoot.endsWith('/') ? projectRoot : `${projectRoot}/`;
  if (abs.startsWith(normRoot)) return abs.slice(normRoot.length);
  return abs;
}

/**
 * Returns true when the renderer can preview the attachment as an
 * inline `<img>` / `<video>`. Used by the rail to decide between
 * thumbnail and chip rendering.
 */
export function isInlinePreviewable(kind: AttachmentKind): boolean {
  return kind === 'image' || kind === 'video';
}

/**
 * URL the frontend uses to fetch the bytes of an inline attachment.
 *
 * Was always `/api/attachments/<uid>/file`, which in a packaged build is a
 * `file://` URL that loads nothing — the previews in ContextRail did not
 * show there. Now the same transport as the artefact viewer (§7.1).
 */
export function attachmentSrcUrl(uid: string): string {
  return artefactSrcUrl(uid);
}

/**
 * Standard Electron file-picker filter sets we reuse.
 */
export const FILE_FILTERS = {
  any: undefined,
  images: [{ name: 'Images', extensions: Array.from(IMAGE_EXTS) }],
  videos: [{ name: 'Videos', extensions: Array.from(VIDEO_EXTS) }],
  imagesOrVideos: [
    { name: 'Images', extensions: Array.from(IMAGE_EXTS) },
    { name: 'Videos', extensions: Array.from(VIDEO_EXTS) },
  ],
  code: [{ name: 'Code', extensions: Array.from(CODE_EXTS) }],
} as const;
