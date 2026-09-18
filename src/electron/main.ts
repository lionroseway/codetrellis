import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  powerMonitor,
  powerSaveBlocker,
  session,
  type WebContents,
} from 'electron';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  initializeBackend,
  app as expressApp,
  addBroadcastTarget,
} from '../backend/server';
import { setElectronScreenshotCapture } from '../backend/mcp/server';
import { dispatchAuthorised, type IpcRequest } from '../backend/services/ipc-dispatcher';
import * as terminalService from '../backend/services/terminal-service';
import { installFileLogger, getCurrentLogPath } from '../backend/services/logger';
import { getUpdateDownloadState } from '../backend/services/update-download-service';
import {
  startPowerService,
  setAcState,
  onPowerStatusChange,
} from '../backend/services/power-service';
import {
  startPowerSignals,
  stopPowerSignals,
} from '../backend/services/power-signals';
import { getSettings } from '../backend/services/settings-service';

// Mirror console.* to <dataDir>/logs/<YYYY-MM-DD>.log so the
// packaged app produces a discoverable trail when no terminal is
// attached. Must run BEFORE any code that does console.* so we
// don't lose the early boot logs.
installFileLogger();
console.log(`[Electron] App boot — pid ${process.pid}, log file: ${getCurrentLogPath()}`);

// Linux AppImage sandboxing fix.
//
// Modern Ubuntu (24.04+) tightened AppArmor's unprivileged
// user-namespace policy, which breaks Chromium's setuid sandbox
// when launched from an AppImage. The chrome-sandbox binary inside
// the mounted AppImage can't be chmod'd because the mount is
// read-only. The pragmatic fix every Electron AppImage on modern
// Linux ships is to disable the sandbox when running from one.
//
// Scoped narrowly via the `APPIMAGE` env var that the AppImage
// runtime sets, so other Linux installs (e.g. .deb) stay sandboxed.
if (process.platform === 'linux' && process.env.APPIMAGE) {
  app.commandLine.appendSwitch('no-sandbox');
  console.log('[Electron] AppImage detected on Linux — running with --no-sandbox');
}

// electron-vite injects this env var when running `electron-vite dev`.
// In production builds it's undefined; we load index.html from the
// packaged `out/renderer/` directory instead.
declare const __dirname: string;

process.on('uncaughtException', (err) => {
  console.error('[Electron] Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Electron] Unhandled promise rejection:', reason);
});

let mainWindow: BrowserWindow | null = null;
let backendStartError: Error | null = null;
let unregisterBroadcastTarget: (() => void) | null = null;

/**
 * Boot the embedded backend in-process. The renderer reaches the
 * Express app via the IPC handler registered below (faster, no
 * network overhead).
 *
 * We ALSO start the HTTP server on the default port so that:
 *   - Mobile companion devices can reach pairing/peer endpoints
 *     over LAN (the QR code encodes the HTTP address + port).
 *   - The MCP server (port 19432) is exposed for agents.
 *
 * On failure we capture the error so `createWindow()` can still
 * open the window and surface something useful instead of leaving
 * the user staring at a Dock icon.
 */
async function bootstrap(): Promise<boolean> {
  try {
    await initializeBackend();
    console.log('[Electron] Backend initialised in-process');

    // THE PACKAGED APP DOES NOT BIND THE EXPRESS LISTENER (Phase 19).
    //
    // `startServer()` used to run here, with a comment saying it was "for
    // MCP agent connections". It is not: `startMcpServer()` runs inside
    // `initializeBackend()` above and has its own port (19432). Nothing in
    // the packaged app consumed :3001 —
    //
    //   the renderer  talks IPC (electron-ipc-shim globally shims fetch)
    //   MCP           has its own listener
    //   mobile API    has its own listener, and is off by default
    //   pairing       binds an ephemeral port per ceremony
    //
    // So the socket was open, unauthenticated until Gate 1.1, and unused.
    // Not binding it is defence in depth: the capability token already
    // closes the vulnerability, and this means a future regression in the
    // CORS or token logic has nothing listening to regress against.
    //
    // Dev mode is unaffected — `src/backend/index.ts` still calls
    // startServer, because in web mode the browser genuinely needs it.
    console.log('[Electron] Backend running IPC-only — no TCP listener for the API');

    return true;
  } catch (err) {
    backendStartError = err instanceof Error ? err : new Error(String(err));
    console.error('[Electron] Backend failed to initialise:', backendStartError);
    return false;
  }
}

/**
 * Wire the renderer's webContents up as a broadcast target so
 * backend `broadcast()` calls also push to the renderer over IPC.
 * Replaces the WebSocket the renderer used to open against the
 * backend's TCP port.
 */
function attachBroadcastForwarding(targetContents: WebContents): void {
  if (unregisterBroadcastTarget) unregisterBroadcastTarget();
  unregisterBroadcastTarget = addBroadcastTarget(({ type, payload }) => {
    if (targetContents.isDestroyed()) return;
    targetContents.send('codetrellis:ws-event', { type, payload });
  });
}

/**
 * Hand a URL to the OS browser, but only if its scheme is one we trust.
 *
 * `shell.openExternal` will happily hand `file://`, `smb://` or a custom
 * protocol to the operating system, which is how "open a link" becomes "run
 * something". Only http and https leave this app.
 */
function openExternally(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return; // not a URL — nothing to open
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    console.warn(`[Electron] Refused to open a non-http(s) URL: ${parsed.protocol}`);
    return;
  }
  void shell.openExternal(parsed.toString());
}

/**
 * Content-Security-Policy for the renderer.
 *
 * Applied as a response header rather than a meta tag so it covers every
 * document the renderer loads, and cannot be removed by injected markup.
 *
 *   default-src 'self'     nothing loads from anywhere else by default
 *   script-src  'self'     no inline script, no eval, no remote script —
 *                          this is the directive that makes injected markup
 *                          inert rather than merely ugly
 *   style-src              'unsafe-inline' is required: the app is Tailwind
 *                          + React inline styles. Inline STYLE cannot
 *                          execute; it is a defacement risk, not an
 *                          execution one, and removing it would mean
 *                          rewriting the styling layer.
 *   img-src     data:      icons and generated images are inlined
 *   connect-src 'self'     XHR/WebSocket to our own origin only. In the
 *                          packaged app the renderer uses IPC anyway, so
 *                          this costs nothing and blocks exfiltration.
 *   frame-src / object-src 'none' — no embedded browsing contexts at all
 *   base-uri    'self'     stops injected <base> retargeting every relative URL
 *   form-action 'none'     nothing in this app submits a form anywhere
 */
const RENDERER_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss: http://localhost:* http://127.0.0.1:*",
  "media-src 'self' blob: data:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function installContentSecurityPolicy(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [RENDERER_CSP],
      },
    });
  });
}

function createWindow(backendOk: boolean): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0a0a0b',
    webPreferences: {
      // electron-vite emits preload to `out/preload/preload.js`; main.js
      // lives at `out/main/main.js`, so we reach across with `..`.
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // ── Renderer containment (Phase 19, finding 16) ─────────────────────
  //
  // The reported `javascript:` payload was refuted — React 19 rewrites such
  // URLs to a throwing value — but the hardening it prompted was missing
  // entirely: there were no navigation guards, no window-open handler and no
  // Content-Security-Policy anywhere in this app.
  //
  // The renderer displays content this app did not author: plan bodies, spec
  // docs, agent output, channel messages, markdown from a scanned repo. Any
  // of that can carry a link or an embed. Three containments:

  // 1. NEVER NAVIGATE AWAY. The renderer is a single-page app; a top-level
  //    navigation is always either a bug or an attack. An http(s) link gets
  //    handed to the real browser, where it is somebody else's sandbox.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow?.webContents.getURL() ?? '';
    if (url === current) return;
    event.preventDefault();
    openExternally(url);
  });

  // 2. NO NEW WINDOWS. `window.open`, `target="_blank"` and friends all land
  //    here. Denying is the default; safe schemes are re-routed outward.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url);
    return { action: 'deny' };
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // Provide the MCP screenshot tool with a native Electron capture path.
  // webContents.capturePage() grabs the rendered viewport as a NativeImage —
  // no html-to-image dependency, no canvas-tainting issues on file:// origins.
  const win = mainWindow;
  setElectronScreenshotCapture(async () => {
    if (win.isDestroyed()) throw new Error('BrowserWindow is destroyed');
    const image = await win.webContents.capturePage();
    return image.toPNG().toString('base64');
  });

  // Forward backend broadcasts to the renderer via IPC. Also
  // re-attach if the renderer reloads (e.g. dev HMR).
  attachBroadcastForwarding(mainWindow.webContents);
  mainWindow.webContents.on('did-finish-load', () => {
    if (mainWindow) attachBroadcastForwarding(mainWindow.webContents);
  });

  // Tell the renderer it's running under Electron + whether the
  // backend booted cleanly. The frontend's IPC shim activates on
  // `ipc=1` and routes /api/* fetches + WebSocket through window.codetrellisIpc.
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    const url = new URL(devUrl);
    url.searchParams.set('ipc', '1');
    if (backendStartError) {
      url.searchParams.set('backendError', backendStartError.message.slice(0, 200));
    }
    mainWindow.loadURL(url.toString());
  } else {
    const renderHtml = path.join(__dirname, '../renderer/index.html');
    const query: Record<string, string> = { ipc: '1' };
    if (backendStartError) query.backendError = backendStartError.message.slice(0, 200);
    mainWindow.loadFile(renderHtml, { query });
  }
  // Note: `backendOk` is currently used only for logging; future
  // work could surface a banner in the renderer based on it.
  void backendOk;

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'right' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // Boot the backend in-process. Don't gate the window on it — if
  // initialisation fails we still want to open the window with an
  // error banner rather than a dangling Dock icon.
  // Before any window exists, so no document is ever served without it.
  installContentSecurityPolicy();

  const backendOk = await bootstrap();
  createWindow(backendOk);

  // Session-persistence plan / Track A — wire AC monitor + start the
  // power state machine + drive the OS sleep-prevent assertion off
  // its output. Safe even if backend boot failed (setBlocker / setAc
  // are no-ops without an active subscription, and the renderer can
  // still surface controls; the user just won't see any
  // status changes until the backend recovers).
  if (backendOk) {
    wirePowerControl();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(backendOk);
  });
}).catch((err) => {
  console.error('[Electron] Fatal startup error:', err);
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow(false);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Clean shutdown — release the OS power assertion + any caffeinate
// child. Without this the assertion can persist a tick into shutdown
// (cosmetic) and a `caffeinate` child can orphan briefly.
app.on('before-quit', () => {
  teardownPowerControl();
});

// =============================================================
// Power control — session-persistence plan / Track A
// =============================================================
//
// This block is the *only* place that talks to the OS sleep-prevent
// assertion. It listens to the backend power-service for the
// authoritative `{ shouldBlock, reason, ac, platform }` status and
// starts/stops `powerSaveBlocker` accordingly. On macOS, when
// `preventLidCloseSleep` is also on, it manages a `caffeinate -s`
// child process — `powerSaveBlocker('prevent-app-suspension')` alone
// doesn't beat lid-close sleep on Macs.

let blockerId: number | null = null;
let caffeinate: ChildProcess | null = null;
let unsubPowerStatus: (() => void) | null = null;
let powerListenersInstalled = false;

function setBlocker(on: boolean): void {
  if (on && blockerId === null) {
    blockerId = powerSaveBlocker.start('prevent-app-suspension');
  } else if (!on && blockerId !== null) {
    if (powerSaveBlocker.isStarted(blockerId)) {
      powerSaveBlocker.stop(blockerId);
    }
    blockerId = null;
  }
}

function setCaffeinate(on: boolean): void {
  // Lid-close prevention is macOS-only; on other platforms the toggle
  // is hidden by the UI so this path effectively no-ops.
  if (process.platform !== 'darwin') return;

  const settings = getSettings();
  const wanted = on && settings.power.preventLidCloseSleep;

  if (wanted && !caffeinate) {
    try {
      caffeinate = spawn('caffeinate', ['-s'], { stdio: 'ignore' });
      caffeinate.on('exit', () => { caffeinate = null; });
    } catch (err) {
      console.warn('[Electron] Failed to spawn caffeinate:', err);
      caffeinate = null;
    }
  } else if (!wanted && caffeinate) {
    try { caffeinate.kill('SIGTERM'); } catch { /* race with exit */ }
    caffeinate = null;
  }
}

function wirePowerControl(): void {
  if (powerListenersInstalled) return;
  powerListenersInstalled = true;

  // Initial AC state — must be read after app.whenReady() (which is
  // when this is called).
  setAcState(powerMonitor.isOnBatteryPower() ? 'battery' : 'plugged');

  // Subscribe to subsequent AC transitions. These events fire on
  // plug/unplug and on battery exhaustion.
  powerMonitor.on('on-battery', () => setAcState('battery'));
  powerMonitor.on('on-ac', () => setAcState('plugged'));

  // Boot the state machine + signal wiring.
  startPowerService();
  startPowerSignals();

  // Drive the OS-level assertions off authoritative status. Log
  // each transition so it's traceable in session-persistence
  // debugging — pairs with [WebRTC][Lifecycle] + [MobileRPC][Lifecycle]
  // lines from Plan 9.1.
  let lastBlock: boolean | null = null;
  unsubPowerStatus = onPowerStatusChange((status) => {
    if (lastBlock !== status.shouldBlock) {
      console.log(
        `[Power][Lifecycle] ${status.shouldBlock ? 'engaged' : 'released'} ` +
        `reason=${status.reason ?? 'none'} ac=${status.ac} platform=${status.platform}`,
      );
      lastBlock = status.shouldBlock;
    }
    setBlocker(status.shouldBlock);
    setCaffeinate(status.shouldBlock);
  });
}

function teardownPowerControl(): void {
  if (unsubPowerStatus) { unsubPowerStatus(); unsubPowerStatus = null; }
  stopPowerSignals();
  if (caffeinate) {
    try { caffeinate.kill('SIGTERM'); } catch { /* */ }
    caffeinate = null;
  }
  if (blockerId !== null) {
    try {
      if (powerSaveBlocker.isStarted(blockerId)) powerSaveBlocker.stop(blockerId);
    } catch { /* */ }
    blockerId = null;
  }
  powerListenersInstalled = false;
}

// =============================================================
// IPC handlers
// =============================================================

/**
 * Catch-all `/api/*` dispatcher. The renderer's IPC shim wraps
 * `fetch('/api/...')` calls and forwards them here. The backend's
 * Express app handles them in-process — no TCP, no port exposure.
 */
ipcMain.handle('codetrellis:api', async (_event, req: IpcRequest) => {
  if (!req || typeof req.method !== 'string' || typeof req.url !== 'string') {
    return {
      status: 400,
      headers: { 'content-type': 'text/plain' },
      body: 'invalid IPC request shape',
    };
  }
  return dispatchAuthorised(expressApp, req);
});

// Native dialogs / shell integration — Electron-only features that
// can't be served by the Express app.
ipcMain.handle('dialog:open-project', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Open Project',
    buttonLabel: 'Open Project',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

/**
 * Phase 15 §15.D — generic file/folder picker for attachments.
 * Multi-select + folders + filters all configurable. Returns
 * absolute paths array (frontend converts to project-relative when
 * appropriate). Null on cancel — distinct from empty array.
 */
ipcMain.handle('dialog:open-files', async (_event, options: {
  multiSelect?: boolean;
  allowFolders?: boolean;
  filters?: Array<{ name: string; extensions: string[] }>;
  defaultPath?: string;
  title?: string;
}) => {
  if (!mainWindow) return null;
  const properties: Array<'openFile' | 'openDirectory' | 'multiSelections'> = ['openFile'];
  if (options?.allowFolders) properties.push('openDirectory');
  if (options?.multiSelect) properties.push('multiSelections');
  const result = await dialog.showOpenDialog(mainWindow, {
    properties,
    filters: options?.filters,
    defaultPath: options?.defaultPath,
    title: options?.title ?? 'Pick files',
    buttonLabel: 'Attach',
  });
  if (result.canceled) return null;
  return result.filePaths;
});

ipcMain.handle('logs:reveal', async () => {
  const p = getCurrentLogPath();
  shell.showItemInFolder(p);
  return p;
});

ipcMain.handle('logs:get-path', async () => getCurrentLogPath());

/**
 * Reveal a verified update download (Phase 29, surfacing Phase 19
 * finding 23).
 *
 * The download service will not install — on macOS a DMG can only be
 * revealed and the user drags it — so revealing is how that flow ends.
 * The path is NOT taken from the renderer: it is read from the download
 * service's own state, which only ever holds a path once the bytes have
 * been verified against the signed manifest. A renderer-supplied path
 * would make this an arbitrary "open anything in Finder" primitive.
 */
ipcMain.handle('updates:reveal', async () => {
  const state = getUpdateDownloadState();
  if (state.phase !== 'ready' || !state.filePath) return null;
  shell.showItemInFolder(state.filePath);
  return state.filePath;
});

// =============================================================
// Terminal IPC — bidirectional PTY I/O
// =============================================================

// Track which terminal IDs have a renderer listener so we only
// forward data for active connections.
const terminalIpcListeners = new Set<string>();

// Wire terminal service output → renderer IPC
terminalService.onTerminalData((id, data) => {
  if (!terminalIpcListeners.has(id) || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(`codetrellis:terminal-data:${id}`, { type: 'output', data });
});

terminalService.onTerminalExit((id, code) => {
  if (!terminalIpcListeners.has(id) || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(`codetrellis:terminal-data:${id}`, { type: 'exit', code });
  terminalIpcListeners.delete(id);
});

// Renderer connects to a terminal — start forwarding output AND
// immediately replay the current ring buffer so the xterm panel
// doesn't render blank after a click-away / re-mount. Plan item
// 12.1. Mirrors what `sendTerminalSnapshots` does for WebRTC peers
// in remote-terminal-service.ts — same ANSI clear-screen prefix so
// any stale renderer state is replaced cleanly.
ipcMain.on('codetrellis:terminal-connect', (_event, termId: string) => {
  terminalIpcListeners.add(termId);
  try {
    const delta = terminalService.readTerminalDelta(termId);
    if (delta && delta.data.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(`codetrellis:terminal-data:${termId}`, {
        type: 'output',
        data: '\x1b[2J\x1b[H' + delta.data,
      });
    }
  } catch { /* unknown terminal id — drop silently, same as before */ }
});

// Renderer disconnects from a terminal
ipcMain.on('codetrellis:terminal-disconnect', (_event, termId: string) => {
  terminalIpcListeners.delete(termId);
});

// Renderer sends keyboard input / resize to a terminal
ipcMain.on('codetrellis:terminal-send', (_event, termId: string, msg: { type: string; data?: string; cols?: number; rows?: number }) => {
  if (msg.type === 'input' && msg.data) {
    terminalService.writeTerminal(termId, msg.data);
  } else if (msg.type === 'resize' && msg.cols && msg.rows) {
    terminalService.resizeTerminal(termId, msg.cols, msg.rows);
  }
});
