import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';
import path from 'node:path';
import pkg from './package.json' with { type: 'json' };

/**
 * The stdio MCP connector (`src/backend/mcp/connector/`) as ONE self-contained
 * CommonJS file, `out/connector/mcp-connector.cjs`.
 *
 * Its own build rather than another electron-vite main entry because it must
 * run outside the app: electron-builder copies it beside the asar
 * (`extraResources`), where the app's binary runs it in Node mode. As a second
 * main entry, rollup could hoist anything it shared with main.ts into a chunk
 * inside the asar, and the connector would fail to load in exactly the one
 * place nobody tests by hand.
 *
 * Node built-ins only — no dependencies to bundle, externalize or prune.
 */
export default defineConfig({
  define: {
    __CONNECTOR_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: 'out/connector',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    sourcemap: false,
    ssr: path.resolve(__dirname, 'src/backend/mcp/connector/main.ts'),
    rollupOptions: {
      external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
      output: {
        format: 'cjs',
        entryFileNames: 'mcp-connector.cjs',
        inlineDynamicImports: true,
      },
    },
  },
  ssr: {
    // Bundle everything the connector imports. It imports nothing but its
    // own directory and Node built-ins; this makes that a build failure
    // rather than a runtime MODULE_NOT_FOUND if it ever changes.
    noExternal: true,
  },
});
