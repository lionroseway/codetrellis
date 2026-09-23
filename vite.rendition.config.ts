import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';
import path from 'node:path';

/**
 * The conversion engine's own process (Phase 31 §7.6) as ONE self-contained
 * CommonJS file, `out/rendition/engine-child.cjs`.
 *
 * Built on its own for the reason the MCP connector is (see
 * vite.connector.config.ts): electron-builder copies it beside the asar
 * (`extraResources`), where the app's binary runs it in Node mode under the
 * permission model — which may read only this file and the engine. As a
 * second main entry, rollup could hoist something it shares with main.ts
 * into a chunk inside the asar, outside what the child is allowed to read.
 *
 * Node built-ins only.
 */
export default defineConfig({
  build: {
    outDir: 'out/rendition',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    sourcemap: false,
    ssr: path.resolve(__dirname, 'src/backend/services/rendition/child/main.ts'),
    rollupOptions: {
      external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
      output: {
        format: 'cjs',
        entryFileNames: 'engine-child.cjs',
        inlineDynamicImports: true,
      },
    },
  },
  ssr: {
    noExternal: true,
  },
});
