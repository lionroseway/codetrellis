import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'node:path';
import { startServer, getBoundBackendPort } from '../backend/server';
import { installFileLogger, getCurrentLogPath } from '../backend/services/logger';

// Mirror console.* to <dataDir>/logs/<YYYY-MM-DD>.log so the
// packaged app produces a discoverable trail when no terminal is
// attached. Must run BEFORE any code that does console.* so we
// don't lose the early boot logs.
installFileLogger();
console.log(`[Electron] App boot — pid ${process.pid}, log file: ${getCurrentLogPath()}`);

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

/**
 * Boot the embedded backend. Resolves to the actually-bound port (3001
 * by default; autodetected forward on EADDRINUSE — see
 * `startServer` in src/backend/server.ts). Failures are caught and
 * stashed in `backendStartError` so the window opens regardless and
 * the user sees something rather than just a Dock icon.
 */
async function bootstrap(): Promise<number | null> {
  try {
    await startServer();
    const port = getBoundBackendPort();
    console.log(`[Electron] Backend ready on port ${port}`);
    return port;
  } catch (err) {
    backendStartError = err instanceof Error ? err : new Error(String(err));
    console.error('[Electron] Backend failed to start:', backendStartError);
    return null;
  }
}

function createWindow(backendPort: number | null): void {
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

  // electron-vite sets `ELECTRON_RENDERER_URL` to the dev server URL
  // when running `electron-vite dev`. In production builds, it's
  // unset and we load the bundled html from disk.
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    // Packaged: the renderer runs from `file://` so relative `/api`
    // fetches don't work. Pass the bound backend port + status as a
    // query string; the frontend's bridge layer reads them and routes
    // calls to `http://localhost:<port>/api`. The renderer html ends
    // up at `out/renderer/index.html`, which inside the asar is at
    // the same relative location to main.js (`../renderer/index.html`).
    const renderHtml = path.join(__dirname, '../renderer/index.html');
    const query: Record<string, string> = {};
    if (backendPort) query.port = String(backendPort);
    if (backendStartError) query.backendError = backendStartError.message.slice(0, 200);
    mainWindow.loadFile(renderHtml, { query });
  }

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'right' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // Start the backend, but don't gate window creation on it. If the
  // backend fails (port conflict, broken DB), we still want the
  // window to open and surface a useful error instead of leaving the
  // user looking at a Dock icon with nothing else.
  const backendPort = await bootstrap();
  createWindow(backendPort);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(backendPort);
  });
}).catch((err) => {
  // Final safety net — if even the activation handler throws, keep
  // the app from silently hanging in Dock.
  console.error('[Electron] Fatal startup error:', err);
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow(null);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC handlers (Electron-only features)
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

ipcMain.handle('project:scan', async (_event, projectPath: string) => {
  // Delegate to backend via HTTP (same as web mode)
  const port = getBoundBackendPort();
  const res = await fetch(`http://localhost:${port}/api/project/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectPath }),
  });
  return res.json();
});

ipcMain.handle('db:search-symbols', async (_event, query: string) => {
  const port = getBoundBackendPort();
  const res = await fetch(`http://localhost:${port}/api/symbols/search?q=${encodeURIComponent(query)}`);
  return res.json();
});

ipcMain.handle('mcp:status', async () => {
  const port = getBoundBackendPort();
  const res = await fetch(`http://localhost:${port}/api/mcp/status`);
  return res.json();
});

ipcMain.handle('logs:reveal', async () => {
  // Reveal the current day's log in Finder / Explorer / file manager.
  const p = getCurrentLogPath();
  shell.showItemInFolder(p);
  return p;
});

ipcMain.handle('logs:get-path', async () => getCurrentLogPath());
