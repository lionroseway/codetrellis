import path from 'node:path';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { VitePlugin } from '@electron-forge/plugin-vite';

/**
 * Electron Forge config — produces DMG (macOS), Squirrel (Windows
 * EXE), DEB / RPM (Linux), and a cross-platform ZIP fallback.
 *
 * `extraResource` ships the tree-sitter WASM grammars unpacked in
 * the app's `Resources/` directory; `ast-parser.ts` reads them via
 * `process.resourcesPath` in production (vs `__dirname` in dev).
 *
 * Icons live at `resources/icon.{icns,ico,png}` — regenerate via
 * `npm run build:icons` (also runs as the `generateAssets` hook
 * below so packaging from a clean clone Just Works).
 */
const config: ForgeConfig = {
  packagerConfig: {
    name: 'CodeTrellis',
    executableName: 'codetrellis',
    icon: path.resolve(__dirname, 'resources', 'icon'), // packager picks .icns / .ico per platform
    asar: true,
    extraResource: [
      // Tree-sitter WASM grammars — needed at runtime by ast-parser.
      // Land at `<app>/Contents/Resources/tree-sitter/` on macOS,
      // `<app>/resources/tree-sitter/` on Windows + Linux.
      path.resolve(__dirname, 'resources', 'tree-sitter'),
      // Sql.js shipped as a whole runtime resource because bundling
      // its Emscripten UMD wrapper breaks. Lands at
      // `<resources>/sql.js/dist/sql-wasm.js` + `sql-wasm.wasm`.
      // Loaded via dynamic require in services/database.ts.
      path.resolve(__dirname, 'node_modules', 'sql.js'),
      // web-tree-sitter — same story. Lands at
      // `<resources>/web-tree-sitter/{tree-sitter.js,tree-sitter.wasm}`.
      path.resolve(__dirname, 'node_modules', 'web-tree-sitter'),
    ],
  },
  hooks: {
    // Run before packaging:
    //   - regenerate platform icons (icon.icns / icon.ico) from
    //     resources/icon.png so a fresh clone doesn't ship stale ones
    //   - regenerate src/shared/build-info.ts with the current
    //     version + ISO timestamp + git commit so every DMG / EXE
    //     carries accurate metadata
    generateAssets: async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./scripts/build-icons.js');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./scripts/generate-build-info.js');
    },
  },
  makers: [
    // macOS DMG — ships with an Applications shortcut so the
    // install workflow is "open .dmg → drag .app onto Applications".
    // Without `additionalDMGOptions.contents` the maker emits a bare
    // DMG with just the .app, which makes users double-click to run
    // it directly from the mount and skip the install step.
    {
      name: '@electron-forge/maker-dmg',
      config: {
        name: 'CodeTrellis',
        icon: path.resolve(__dirname, 'resources', 'icon.icns'),
        format: 'ULFO', // smallest compressed format on modern macOS
        additionalDMGOptions: {
          window: {
            size: { width: 540, height: 380 },
          },
        },
        contents: ((opts: any) => [
          { x: 130, y: 180, type: 'file' as const, path: opts.appPath },
          { x: 410, y: 180, type: 'link' as const, path: '/Applications' },
        ]) as any,
        // Apple Developer code-signing happens via `osxSign` in
        // packagerConfig when CODESIGN_IDENTITY env var is set;
        // notarization via `osxNotarize`. Both no-op without env.
      },
      platforms: ['darwin'],
    },
    // Windows installer (EXE) via Squirrel
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'codetrellis',
        setupExe: 'CodeTrellis-Setup.exe',
        setupIcon: path.resolve(__dirname, 'resources', 'icon.ico'),
        // certificateFile + certificatePassword via env when set —
        // unsigned installer otherwise (works but Windows SmartScreen
        // will warn until reputation builds or signing kicks in).
      },
      platforms: ['win32'],
    },
    // Linux deb / rpm
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          icon: path.resolve(__dirname, 'resources', 'icon.png'),
          maintainer: 'CodeTrellis Contributors',
          homepage: 'https://codetrellis.dev',
        },
      },
      platforms: ['linux'],
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {
        options: {
          icon: path.resolve(__dirname, 'resources', 'icon.png'),
          homepage: 'https://codetrellis.dev',
        },
      },
      platforms: ['linux'],
    },
    // Cross-platform fallback (zipped .app on macOS, etc.)
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'linux', 'win32'],
    },
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/electron/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/electron/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
  ],
};

// --- Optional code-signing (macOS) ---
//
// When CODESIGN_IDENTITY is set, Forge signs + notarizes via
// electron-osx-sign / electron-notarize. APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD
// + APPLE_TEAM_ID also required for notarization.
if (process.env.CODESIGN_IDENTITY) {
  config.packagerConfig!.osxSign = {
    identity: process.env.CODESIGN_IDENTITY,
  } as any;
  if (process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID) {
    (config.packagerConfig as any).osxNotarize = {
      tool: 'notarytool',
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID,
    };
  }
}

export default config;
