import { app, BrowserWindow, ipcMain, dialog, shell, type WebContents } from 'electron';
import path from 'node:path';
import {
  initializeBackend,
  app as expressApp,
  addBroadcastTarget,
} from '../backend/server';
import { setElectronScreenshotCapture } from '../backend/mcp/server';
import { dispatch, type IpcRequest } from '../backend/services/ipc-dispatcher';
import * as terminalService from '../backend/services/terminal-service';
import { installFileLogger, getCurrentLogPath } from '../backend/services/logger';

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
declare const __dirname: string; // eslint-disable-line @typescript-eslint/no-unused-vars

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
 * Boot the embedded backend in-process — no TCP listen on the
 * backend port. Only the MCP server (port 19432) ends up exposed,
 * because external agents need a stable URL for it. The renderer
 * reaches the Express app via the IPC handler registered below.
 *
 * On failure we capture the error so `createWindow()` can still
 * open the window and surface something useful instead of leaving
 * the user staring at a Dock icon.
 */
async function bootstrap(): Promise<boolean> {
  try {
    await initializeBackend();
    console.log('[Electron] Backend initialised in-process (no TCP backend port)');
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
  const backendOk = await bootstrap();
  createWindow(backendOk);

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
  return dispatch(expressApp, req);
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

// Renderer connects to a terminal — start forwarding output
ipcMain.on('codetrellis:terminal-connect', (_event, termId: string) => {
  terminalIpcListeners.add(termId);
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
