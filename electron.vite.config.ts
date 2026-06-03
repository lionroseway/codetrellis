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
        // Bundle the werift WebRTC stack so its internal
        // `require('lib/binary-stream')` calls (which rely on
        // src/node_modules/ inside @shinyoshiaki/binary-data)
        // get resolved at build time — electron-builder prunes
        // nested node_modules, breaking runtime resolution.
        exclude: [
          'werift',
          '@shinyoshiaki/binary-data',
          '@shinyoshiaki/ice',
        ],
      }),
    ],
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, 'src/shared'),
        // @shinyoshiaki/binary-data uses a nested src/node_modules/
        // directory with bare-specifier requires (e.g. require('lib/binary-stream')).
        // Vite can't resolve these automatically, so we alias them explicitly.
        'lib/binary-stream': path.resolve(__dirname, 'node_modules/@shinyoshiaki/binary-data/src/node_modules/lib/binary-stream.js'),
        'lib/encode': path.resolve(__dirname, 'node_modules/@shinyoshiaki/binary-data/src/node_modules/lib/encode.js'),
        'lib/decode': path.resolve(__dirname, 'node_modules/@shinyoshiaki/binary-data/src/node_modules/lib/decode.js'),
        'lib/encoding-length': path.resolve(__dirname, 'node_modules/@shinyoshiaki/binary-data/src/node_modules/lib/encoding-length.js'),
        'lib/transaction': path.resolve(__dirname, 'node_modules/@shinyoshiaki/binary-data/src/node_modules/lib/transaction.js'),
        'lib/not-enough-data-error': path.resolve(__dirname, 'node_modules/@shinyoshiaki/binary-data/src/node_modules/lib/not-enough-data-error.js'),
        'types/array': path.resolve(__dirname, 'node_modules/@shinyoshiaki/binary-data/src/node_modules/types/array.js'),
        'types/buffer': path.resolve(__dirname, 'node_modules/@shinyoshiaki/binary-data/src/node_modules/types/buffer.js'),
        'types/bool': path.resolve(__dirname, 'node_modules/@shinyoshiaki/binary-data/src/node_modules/types/bool.js'),
        'types/reserved': path.resolve(__dirname, 'node_modules/@shinyoshiaki/binary-data/src/node_modules/types/reserved.js'),
        'types/string': path.resolve(__dirname, 'node_modules/@shinyoshiaki/binary-data/src/node_modules/types/string.js'),
        'types/numbers': path.resolve(__dirname, 'node_modules/@shinyoshiaki/binary-data/src/node_modules/types/numbers.js'),
        'types/when': path.resolve(__dirname, 'node_modules/@shinyoshiaki/binary-data/src/node_modules/types/when.js'),
        'types/select': path.resolve(__dirname, 'node_modules/@shinyoshiaki/binary-data/src/node_modules/types/select.js'),
        'internal/buffer-list': path.resolve(__dirname, 'node_modules/@shinyoshiaki/binary-data/src/node_modules/internal/buffer-list.js'),
        'internal/meta': path.resolve(__dirname, 'node_modules/@shinyoshiaki/binary-data/src/node_modules/internal/meta.js'),
        'internal/symbols': path.resolve(__dirname, 'node_modules/@shinyoshiaki/binary-data/src/node_modules/internal/symbols.js'),
        'internal/linked-list': path.resolve(__dirname, 'node_modules/@shinyoshiaki/binary-data/src/node_modules/internal/linked-list.js'),
        'lib/util': path.resolve(__dirname, 'node_modules/@shinyoshiaki/binary-data/src/node_modules/lib/util.js'),
      },
    },
    build: {
      outDir: 'out/main',
      lib: {
        entry: 'src/electron/main.ts',
        formats: ['cjs'],
      },
      rollupOptions: {
        external: ['electron', 'sql.js', 'web-tree-sitter', 'better-sqlite3'],
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
