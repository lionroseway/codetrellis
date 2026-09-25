/**
 * Hash a file inside a root, streaming (Phase 31 §4.4).
 *
 * Streams through `openReadStreamWithin`, so the file hashed is the file
 * that passed the containment check — no link followed, no swap between
 * the check and the read — and a large file never sits in memory.
 */

import { createHash } from 'node:crypto';
import { openReadStreamWithin } from '../services/confined-fs';

export interface FileHash {
  sha256: string;
  size: number;
  mtimeMs: number;
}

export function sha256FileWithin(root: string, rel: string): Promise<FileHash> {
  const { stream, size, mtimeMs } = openReadStreamWithin(root, rel, {}, 'artefact');
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve({ sha256: hash.digest('hex'), size, mtimeMs }));
  });
}
