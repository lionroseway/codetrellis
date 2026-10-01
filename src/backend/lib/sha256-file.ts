/**
 * Hash a file inside a root, streaming (Phase 31 §4.4).
 *
 * Streams through `openReadStreamWithin`, so the file hashed is the file
 * that passed the containment check — no link followed, no swap between
 * the check and the read — and a large file never sits in memory.
 */

import { createHash } from 'node:crypto';
import { openReadStreamWithin, resolveWithin } from '../services/confined-fs';
import { isPlaceholder, NotOnDeviceError } from '../services/cloud-files';

export interface FileHash {
  sha256: string;
  size: number;
  mtimeMs: number;
}

/**
 * A file a sync client has not brought down is not hashed: reading it would
 * download it (Phase 32 C3.4b). The caller is told it is not on this device.
 */
export function sha256FileWithin(root: string, rel: string): Promise<FileHash> {
  if (isPlaceholder(resolveWithin(root, rel, 'artefact'))) return Promise.reject(new NotOnDeviceError(rel));
  const { stream, size, mtimeMs } = openReadStreamWithin(root, rel, {}, 'artefact');
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve({ sha256: hash.digest('hex'), size, mtimeMs }));
  });
}
