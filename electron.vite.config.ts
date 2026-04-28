import path from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * electron-vite — unified config for the three Electron build
 * targets (main / preload / renderer). Replaces the previous
 * `vite.{main,preload,renderer}.config.ts` trio + Forge's
 * `plugin-vite`. Output lands at `out/{main,preload,renderer}` for
 * electron-builder to package from.
 *
 * Keeping the renderer's html-as-entry pattern (vs Vite's default
 * tsx-as-entry) by setting `root: src/frontend` + `base: './'`. The
 * latter is critical: under `file://` in the packaged app, an
 * absolute `/assets/...` reference would resolve to `file:///assets`
 * and 404. `./` makes assets relative to the document URL.
 */
export default defineConfig({
  main: {
    plugins: [
      // sql.js + web-tree-sitter ship Emscripten UMD bundles that
      // break when bundled (`Cannot set properties of undefined
      // (setting 'exports')`); they're loaded via dynamic require
      // at runtime from `process.resourcesPath` (see
      // services/database.ts and services/ast-parser.ts). Mark them
      // external so Vite leaves the require in place.
      externalizeDepsPlugin({
        exclude: [], // keep the default external set + nothing extra
      }),
    ],
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, 'src/shared'),
      },
    },
    build: {
      outDir: 'out/main',
      lib: {
        entry: 'src/electron/main.ts',
        formats: ['cjs'],
      },
      rollupOptions: {
        external: ['electron', 'sql.js', 'web-tree-sitter'],
      },
      minify: false,
      commonjsOptions: {
        transformMixedEsModules: true,
      },
    },
  },

  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, 'src/shared'),
      },
    },
    build: {
      outDir: 'out/preload',
      lib: {
        entry: 'src/electron/preload.ts',
        formats: ['cjs'],
      },
      rollupOptions: {
        external: ['electron'],
      },
    },
  },

  renderer: {
    root: path.resolve(__dirname, 'src/frontend'),
    base: './',
    publicDir: path.resolve(__dirname, 'resources'),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, 'src/shared'),
      },
    },
    build: {
      outDir: path.resolve(__dirname, 'out/renderer'),
      emptyOutDir: true,
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, 'src/frontend/index.html'),
        },
      },
    },
  },
});
