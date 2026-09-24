/**
 * Phase 31 §5.1 — the reader's own process: one request, one reply, exit.
 *
 * Started per read by reader-host.ts with its own heap ceiling and, when
 * packaged, under the permission model with nothing granted but this
 * script: it is handed bytes over IPC, never a path, and can open no file,
 * start no process and reach no network.
 */
import { readMaterialBytes, type ReadRequest } from './read';

process.once('message', (req: ReadRequest) => {
  readMaterialBytes(req)
    .catch((err: unknown) => ({ ok: false as const, reason: `The file could not be read (${(err as Error).message})` }))
    .then((reply) => process.send?.(reply, () => process.exit(0)));
});
