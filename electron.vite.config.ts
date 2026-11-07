import path from 'node:path';
import { execFileSync } from 'node:child_process';
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
/**
 * Build metadata for `src/shared/build-info.ts`, computed here because
 * every packaged build passes through this file — whichever npm script or
 * CI job started it. An npm hook or a committed generated file can be
 * skipped or go stale; this cannot. Version is deliberately absent: the
 * app imports it from package.json, the same file electron-builder uses.
 */
function buildStamp() {
  const git = (...args: string[]): string => {
    try {
      return execFileSync('git', args, {
        cwd: __dirname,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return '';
    }
  };
  const commit = git('rev-parse', 'HEAD');
  // Needs full history — a shallow CI checkout counts 1. The workflows
  // check out with `fetch-depth: 0` for this.
  const count = Number(git('rev-list', '--count', 'HEAD'));
  return {
    buildTime: new Date().toISOString(),
    buildNumber: Number.isFinite(count) ? count : 0,
    commit,
    commitShort: commit.slice(0, 7),
    branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    dirty: git('status', '--porcelain') !== '',
  };
}

export default defineConfig({
  main: {
    define: {
      __CODETRELLIS_BUILD__: JSON.stringify(buildStamp()),
    },
    plugins: [
      // sql.js + web-tree-sitter ship Emscripten UMD bundles that
      // break when bundled (`Cannot set properties of undefined
      // (setting 'exports')`); they're loaded via dynamic require
      // at runtime from `process.resourcesPath` (see
      // services/database.ts and services/ast-parser.ts). Mark them
      // external so Vite leaves the require in place.
      externalizeDepsPlugin({
        // Bundle the werift WebRTC stack into the main code. Up to werift
        // 0.25.0 this was forced: @shinyoshiaki/binary-data resolved bare
        // `require('lib/binary-stream')` calls from a nested node_modules
        // that electron-builder prunes. werift 0.25.1 ported that package
        // into werift-common and dropped the dependency, and the aliases
        // that resolved those requires went with it. werift stays bundled
        // so the packaged app's layout, and
        // the CLI's vendored copy (tools/cli-package/build.ts), are
        // unchanged.
        exclude: ['werift'],
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
    // Lazy-loaded by the artefact viewer, or imported only by its workers,
    // which Vite's startup scan does not follow. Bundled up front so the
    // first PDF or Word document opened in dev doesn't make Vite
    // re-optimise and reload the page. Keep in step with vite.web.config.ts,
    // which serves `npm run dev` and the browser suite.
    optimizeDeps: {
      include: ['pdfjs-dist/legacy/build/pdf.mjs', 'mammoth'],
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
