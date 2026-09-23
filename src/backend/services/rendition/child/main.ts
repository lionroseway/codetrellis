/**
 * Phase 31 §7.6 — the conversion engine's own process.
 *
 * Runs outside the app's process, on the app's own binary in Node mode,
 * launched by `engine-host.ts` under Node's permission model. It is handed
 * bytes over IPC and hands a PDF back; it is never given a path.
 *
 * Built on its own (`vite.rendition.config.ts`) into one CommonJS file and
 * shipped beside the asar, as the MCP connector is, so nothing it needs can
 * be hoisted into a chunk inside the archive.
 *
 * The engine itself lives in a directory described by `engine.json`:
 *   { "name", "version", "adapter": "adapter.cjs", "files": { rel: sha256 } }
 * The host verifies those hashes before it starts this process. The adapter
 * exports `create({ dir })`, resolving to `{ convert(bytes, ext) → bytes }`.
 */

import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';

interface Adapter {
  create(opts: { dir: string }): Promise<{ convert(bytes: Uint8Array, ext: string): Promise<Uint8Array> }>;
}

type Inbound = { type: 'convert'; id: number; bytes: Uint8Array; ext: string };

/**
 * No module that can reach the network, or start another process, can be
 * loaded here. The engine needs neither; where the runtime can deny them
 * (the permission model: child processes always, the network from Node 25),
 * the host also does. This stops the adapter or the engine's glue from
 * picking them up on a runtime that cannot.
 */
const REFUSED = new Set([
  'net', 'tls', 'http', 'https', 'http2', 'dns', 'dgram', 'child_process', 'cluster', 'inspector',
]);

function lockDown(): void {
  const mod = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
  const load = mod._load;
  mod._load = function (request: string, ...rest: unknown[]) {
    if (REFUSED.has(request.replace(/^node:/, ''))) {
      throw new Error(`The conversion engine may not load ${request}`);
    }
    return load.call(this, request, ...rest);
  };
  for (const name of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest']) {
    try { delete (globalThis as Record<string, unknown>)[name]; } catch { /* not configurable */ }
  }
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir || !process.send) throw new Error('engine-child: no engine directory, or no IPC channel');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'engine.json'), 'utf-8')) as { adapter: string; version: string };

  lockDown();
  const adapter = Module.createRequire(path.join(dir, 'engine.json'))(path.join(dir, manifest.adapter)) as Adapter;
  const engine = await adapter.create({ dir });

  process.on('message', (raw) => {
    const msg = raw as Inbound;
    if (msg?.type !== 'convert') return;
    engine.convert(msg.bytes, msg.ext).then(
      (pdf) => process.send?.({ type: 'result', id: msg.id, pdf }),
      (err: unknown) => process.send?.({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) }),
    );
  });
  // The app going away takes this with it.
  process.on('disconnect', () => process.exit(0));
  process.send({ type: 'ready', version: manifest.version });
}

main().catch((err: unknown) => {
  process.stderr.write(`engine-child: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
