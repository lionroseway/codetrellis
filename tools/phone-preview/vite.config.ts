/**
 * The phone's screens, rendered in a browser (Phase 32 A4.5a).
 *
 * The companion app is React Native and had no way to be seen outside a
 * device: its screens were typechecked and linted, never looked at (the Wave 1
 * review's point 4). This renders the real screen components from `mobile/`
 * through react-native-web, with the native pieces replaced:
 *
 *  - `react-native` is react-native-web;
 *  - `expo-router` and the other `expo-*` and native modules are small stubs
 *    (`stubs/`), enough for a screen to render and navigate;
 *  - `mobile/lib/rpc.ts` answers from fixtures the test puts on the page, so
 *    a screen shows a known state rather than a desktop's.
 *
 * It is a way to see and photograph screens, not a web build of the app: the
 * WebRTC mesh, the camera and push never run here. `tests/phone/` drives it.
 */

import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const here = __dirname;
const repo = path.resolve(here, '../..');
const mobile = path.join(repo, 'mobile');
const stub = (name: string) => path.join(here, 'stubs', name);

/** Modules a screen imports that cannot run in a browser, and their stand-ins. */
const STUBS: Record<string, string> = {
  'expo-router': stub('expo-router.tsx'),
  'expo-haptics': stub('empty.ts'),
  'expo-clipboard': stub('expo-clipboard.ts'),
  'expo-secure-store': stub('expo-secure-store.ts'),
  'expo-notifications': stub('empty.ts'),
  'expo-constants': stub('expo-constants.ts'),
  'expo-status-bar': stub('expo-status-bar.tsx'),
  'expo-camera': stub('empty.ts'),
  'react-native-webview': stub('webview.tsx'),
  'react-native-safe-area-context': stub('safe-area.tsx'),
  'react-native-webrtc': stub('empty.ts'),
  'react-native-zeroconf': stub('empty.ts'),
};

/** The phone's own modules that talk to the desktop: answered from fixtures instead. */
const LOCAL_STUBS: Record<string, string> = {
  [path.join(mobile, 'lib/rpc.ts')]: stub('rpc.ts'),
  [path.join(mobile, 'lib/webrtc.ts')]: stub('empty.ts'),
};

function phoneStubs(): Plugin {
  return {
    name: 'phone-stubs',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (STUBS[source]) return STUBS[source];
      if (!importer || !source.startsWith('.')) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (resolved && LOCAL_STUBS[resolved.id]) return LOCAL_STUBS[resolved.id];
      return null;
    },
  };
}

export default defineConfig({
  root: here,
  plugins: [phoneStubs(), react()],
  resolve: {
    alias: [
      { find: /^react-native$/, replacement: 'react-native-web' },
      // One React for the page: the screens under mobile/ would otherwise find mobile's own copy.
      { find: /^react$/, replacement: path.join(repo, 'node_modules/react') },
      { find: /^react\/(.*)$/, replacement: path.join(repo, 'node_modules/react/$1') },
      { find: /^react-dom$/, replacement: path.join(repo, 'node_modules/react-dom') },
      { find: /^react-dom\/(.*)$/, replacement: path.join(repo, 'node_modules/react-dom/$1') },
    ],
    extensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'],
  },
  define: {
    __DEV__: 'false',
    'process.env.EXPO_OS': JSON.stringify('web'),
    'process.env.NODE_ENV': JSON.stringify('production'),
    global: 'globalThis',
  },
  server: { fs: { allow: [repo] } },
  optimizeDeps: {
    esbuildOptions: { loader: { '.js': 'jsx' } },
  },
});
