import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import { startServer } from '../backend/server';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

process.on('uncaughtException', (err) => {
  console.error('[Electron] Uncaught exception:', err);
});

let mainWindow: BrowserWindow | null = null;

async function bootstrap(): Promise<void> {
  // Start backend server (same one used in web mode)
  await startServer(3001);
  console.log('[Electron] Backend server started');
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0a0a0b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'right' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  await bootstrap();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
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
  const res = await fetch(`http://localhost:3001/api/project/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectPath }),
  });
  return res.json();
});

ipcMain.handle('db:search-symbols', async (_event, query: string) => {
  const res = await fetch(`http://localhost:3001/api/symbols/search?q=${encodeURIComponent(query)}`);
  return res.json();
});

ipcMain.handle('mcp:status', async () => {
  const res = await fetch('http://localhost:3001/api/mcp/status');
  return res.json();
});
