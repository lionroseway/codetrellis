import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';
import path from 'node:path';

/**
 * The material reader's worker thread (Phase 31 §5.1) as ONE self-contained
 * ES module, `out/reader/material-reader.mjs`, shipped beside the asar
 * (`extraResources`) as the engine child is.
 *
 * It is bundled on its own because what it carries is not in the packaged
 * node_modules: pdf.js is left out of the asar (it is the renderer's, and
 * bundled there), and a worker thread loads its script from disk by path.
 * ES module output, because pdf.js is one and reads `import.meta.url`.
 *
 * Node built-ins only; `@napi-rs/canvas`, which pdf.js reaches for only to
 * draw, is left out and its absence is a warning pdf.js already handles.
 */
export default defineConfig({
  build: {
    outDir: 'out/reader',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    sourcemap: false,
    ssr: path.resolve(__dirname, 'src/backend/services/material-reader/child.ts'),
    rollupOptions: {
      external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`), '@napi-rs/canvas'],
      output: {
        format: 'es',
        entryFileNames: 'material-reader.mjs',
        inlineDynamicImports: true,
      },
    },
  },
  ssr: {
    noExternal: true,
  },
});
