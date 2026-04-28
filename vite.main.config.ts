import { defineConfig } from 'vite';
import path from 'node:path';

/**
 * Vite config for the Electron main process bundle.
 *
 * Two key choices:
 *
 * 1. **Externalize `electron` only.** We never want to bundle the
 *    Electron runtime into our own code; everything else gets
 *    bundled so we don't have to ship `node_modules/` separately.
 *    (Forge's vite plugin generates a stripped-down package.json
 *    in the asar with no dependencies, so any externalized npm
 *    package would `Cannot find module …` at runtime.)
 *
 * 2. **Disable minification.** sql.js ships an Emscripten-generated
 *    UMD bundle that uses `module.exports = …` guarded by a
 *    `typeof module !== 'undefined'` check; aggressive minification
 *    can rewrite that shape into something that throws at runtime
 *    (`Cannot set properties of undefined (setting 'exports')`).
 *    Keeping the source readable also gives us legible stack traces
 *    in the rare cases this hits production.
 *
 * The bundle ends up ~1MB and includes Express, sql.js, chokidar,
 * web-tree-sitter, yaml, etc. Acceptable.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  build: {
    rollupOptions: {
      // `electron` is always external — never bundle the runtime.
      // sql.js + web-tree-sitter are externalized so we can load
      // them dynamically at runtime: in dev from node_modules
      // (Node resolves normally), in production from
      // `process.resourcesPath` where Forge's `extraResource`
      // dropped them. Bundling sql.js fails because its
      // Emscripten UMD wrapper expects `module`/`exports` to be
      // live, which Vite's IIFE wrapping breaks
      // ("Cannot set properties of undefined (setting 'exports')").
      external: ['electron', 'sql.js', 'web-tree-sitter'],
    },
    minify: false,
    commonjsOptions: {
      // Make Rollup statically resolve our internal lazy
      // `require('./services/foo')` calls and bundle them. Without
      // this, the requires are emitted unchanged and fail at
      // runtime in the packaged app because the relative paths
      // resolve from `.vite/build/main.js` rather than the source
      // tree (MODULE_NOT_FOUND).
      transformMixedEsModules: true,
    },
  },
});
