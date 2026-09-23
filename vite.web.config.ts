import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

/**
 * Read the backend's per-launch capability token (Phase 19 Gate 1.1).
 *
 * WHY THE PROXY HAS TO DO THIS
 *
 * Every local transport now requires a token, and the token lives in a file
 * only a process can read. The dev renderer is a BROWSER — it has no
 * filesystem access, so it cannot fetch its own credential. The Vite dev
 * proxy sits in between, is a process, and can.
 *
 * Read on every request rather than cached at startup: the token is minted
 * per backend launch, and `npm run dev` restarts the backend on every source
 * change while Vite stays up. A cached value would go stale on the first
 * backend reload and every request would 401.
 *
 * Dev only. Nothing in a packaged build goes through Vite — the renderer
 * talks IPC.
 */
function readCapabilityToken(): string | null {
  const dataDir =
    process.env.CODETRELLIS_DATA_DIR?.trim() ||
    path.join(os.homedir(), '.codetrellis');
  try {
    const token = fs.readFileSync(path.join(dataDir, 'capability-token'), 'utf-8').trim();
    return token.length > 0 ? token : null;
  } catch {
    // Backend not up yet, or a different data dir. The request will 401,
    // which is the correct outcome rather than a silent bypass.
    return null;
  }
}


/**
 * Vite config for web mode (browser).
 * Frontend served by Vite dev server, backend runs separately via Express.
 */
export default defineConfig({
  root: 'src/frontend',
  publicDir: path.resolve(__dirname, 'resources'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
    dedupe: ['react', 'react-dom'],
  },
  // Lazy-loaded by the artefact viewer, or imported only by its workers,
  // which Vite's startup scan does not follow. Discovered later, each makes
  // Vite re-optimise and reload EVERY open page — in the browser suite,
  // that is whatever test the other worker is running. Keep in step with
  // the renderer's list in electron.vite.config.ts.
  optimizeDeps: {
    include: ['pdfjs-dist/legacy/build/pdf.mjs', 'mammoth'],
  },
  server: {
    port: 5173,
    headers: {
      // Bust stale Chrome disk cache from the old project name
      'Cache-Control': 'no-store',
    },
    // Only the dev renderer may talk to the dev proxy. Without this, a page
    // on any other origin could use the proxy as a confused deputy: it would
    // attach the capability token on their behalf and forward the request.
    cors: {
      origin: [/^http:\/\/localhost:5173$/, /^http:\/\/127\.0\.0\.1:5173$/],
      credentials: true,
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            const token = readCapabilityToken();
            if (token) proxyReq.setHeader('x-codetrellis-token', token);
          });
        },
      },
      '/terminal-ws': {
        target: 'ws://localhost:3001',
        ws: true,
        configure: (proxy) => {
          // A WebSocket handshake cannot carry a custom header from the
          // browser, but the PROXY can add one on the way out.
          proxy.on('proxyReqWs', (proxyReq) => {
            const token = readCapabilityToken();
            if (token) proxyReq.setHeader('x-codetrellis-token', token);
          });
        },
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
        configure: (proxy) => {
          proxy.on('proxyReqWs', (proxyReq) => {
            const token = readCapabilityToken();
            if (token) proxyReq.setHeader('x-codetrellis-token', token);
          });
        },
      },
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/frontend'),
    emptyOutDir: true,
  },
});
