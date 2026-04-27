import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

/**
 * Vite config for the Electron renderer (used by Forge's vite plugin).
 *
 * Key constraint: Forge expects the renderer build output at
 * `<repo>/.vite/renderer/<name>/`. When we set `root: 'src/frontend'`
 * Vite resolves `outDir` relative to that root and the build ends up
 * at `src/frontend/.vite/renderer/main_window/` instead — Forge's
 * packaging step then copies an empty directory into the `.app`,
 * producing a window that loads nothing.
 *
 * Fix: use absolute paths for both `root` and `build.outDir` so Vite
 * writes exactly where Forge expects. `base: './'` is essential too —
 * without it, the production build emits absolute paths in the html
 * (`/assets/...`) which fail when loaded over `file://` from the
 * packaged Resources directory.
 *
 * `publicDir` lets `<link href="/icon.png">` in `src/frontend/index.html`
 * resolve to `resources/icon.png` so the favicon ships in the bundle.
 */
export default defineConfig({
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
    outDir: path.resolve(__dirname, '.vite/renderer/main_window'),
    emptyOutDir: true,
  },
});
