/**
 * Phase 31 §7.3 — HTML reports in their own sandboxed view.
 *
 * HTML is the one format that is a program, so it never runs in the app's
 * window. A report is shown in a separate WebContentsView laid over the
 * viewer's body:
 *
 *  - sandboxed, context-isolated, no preload, no Node, no devtools, no
 *    <webview>; JavaScript OFF unless the person turns this page's scripts
 *    on, which makes a new view;
 *  - its own in-memory session, cleared whenever the view goes away, with
 *    every permission denied and downloads refused;
 *  - that session can load one scheme, `ct-html://<uid>/…`, which serves
 *    only files from the report's own folder (serveReportAsset), each with a
 *    CSP that has no connect-src — anything else is cancelled before it
 *    leaves, scripts or not;
 *  - it may move between pages of the same report (a coverage report's
 *    file pages) and nowhere else: no other report, no web, no file:, no
 *    new windows.
 *
 * Only the main window may show, move or hide it, and only by attachment
 * uid; the path is resolved in main, as everywhere in §7.1.
 */

import { ipcMain, nativeImage, screen, session, WebContentsView, type BrowserWindow, type NativeImage, type Session } from 'electron';
import { Readable } from 'node:stream';
import { overlay } from './composite';
import { isAttachmentUid, resolveServable, serveReportAsset } from '../backend/services/artefact-content-service';
import { isSameReport } from '../backend/services/html-view-policy';

interface Bounds { x: number; y: number; width: number; height: number }

const PARTITION = 'ct-html-view'; // no "persist:" — in memory only

let reportSession: Session | null = null;
let view: WebContentsView | null = null;
let shown: { uid: string; scripts: boolean } | null = null;

function toBounds(b: unknown): Bounds | null {
  const o = b as Partial<Bounds> | null;
  if (!o) return null;
  const n = [o.x, o.y, o.width, o.height].map((v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : NaN));
  if (n.some(Number.isNaN) || n[2] <= 0 || n[3] <= 0) return null;
  return { x: Math.max(0, n[0]), y: Math.max(0, n[1]), width: Math.min(n[2], 10_000), height: Math.min(n[3], 10_000) };
}

function reportSessionOnce(): Session {
  if (reportSession) return reportSession;
  const ses = session.fromPartition(PARTITION, { cache: false });
  ses.protocol.handle('ct-html', async (request) => {
    const url = new URL(request.url);
    // Only the report on screen, with the script setting it was shown with.
    if (!shown || url.hostname !== shown.uid.toLowerCase()) return new Response('Not part of this report', { status: 404 });
    const served = await serveReportAsset(shown.uid, url.pathname, shown.scripts);
    if (!served.stream) return new Response(served.error ?? 'Not found', { status: served.status, headers: served.headers });
    return new Response(Readable.toWeb(served.stream) as unknown as ReadableStream, { status: served.status, headers: served.headers });
  });
  // Belt to the CSP's braces: nothing that is not the report's own scheme leaves.
  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({ cancel: !/^(ct-html|data|blob):/.test(details.url) });
  });
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  ses.on('will-download', (event) => event.preventDefault());
  reportSession = ses;
  return ses;
}

function destroy(win: BrowserWindow | null): void {
  if (view) {
    if (win && !win.isDestroyed()) win.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }
  view = null;
  shown = null;
  void reportSession?.clearStorageData();
}

function create(win: BrowserWindow, uid: string, scripts: boolean): WebContentsView {
  const v = new WebContentsView({
    webPreferences: {
      session: reportSessionOnce(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      javascript: scripts,
      devTools: false,
      spellcheck: false,
      navigateOnDragDrop: false,
      disableDialogs: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      autoplayPolicy: 'user-gesture-required',
    },
  });
  v.setBackgroundColor('#ffffff');
  const wc = v.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  const stay = (event: Electron.Event, target: string) => {
    if (!isSameReport(wc.getURL() || `ct-html://${uid}/`, target)) event.preventDefault();
  };
  wc.on('will-navigate', (event, target) => stay(event, target));
  wc.on('will-redirect', (event, target) => stay(event, target));
  wc.on('will-frame-navigate', (event) => { if (!event.isMainFrame) event.preventDefault(); });
  wc.on('will-attach-webview', (event) => event.preventDefault());
  win.contentView.addChildView(v);
  return v;
}

/**
 * Show a report over `bounds` of the window, making a new view when the
 * report or its script setting changed. Exported for the hostile-report
 * test (tools/html-view-hostile); the app reaches it only through IPC.
 */
export async function showReport(win: BrowserWindow, uid: unknown, bounds: unknown, scripts: unknown): Promise<{ ok: boolean; reason?: string }> {
  const box = toBounds(bounds);
  if (!box || !isAttachmentUid(uid)) return { ok: false, reason: 'This report cannot be shown here.' };
  const file = await resolveServable(uid);
  if (!file || !/\.html?$/i.test(file.rel)) return { ok: false, reason: 'This report cannot be shown here.' };
  const wantScripts = scripts === true;
  if (!view || !shown || shown.uid !== uid || shown.scripts !== wantScripts) {
    destroy(win);
    shown = { uid, scripts: wantScripts };
    view = create(win, uid, wantScripts);
    const name = file.rel.split(/[\\/]/).pop() ?? 'index.html';
    void view.webContents.loadURL(`ct-html://${uid.toLowerCase()}/${encodeURIComponent(name)}`).catch(() => {});
  }
  view.setBounds(box);
  return { ok: true };
}

/** The view on screen, for the hostile-report test. */
export function currentReportView(): WebContentsView | null {
  return view;
}

/**
 * The window's capture as a PNG, with the report on screen painted in.
 *
 * `capturePage()` on the window sees only its own page, so without this a
 * screenshot of an open report is the white box the view is laid over.
 * The view is captured twice for the same reason the window is (main.ts):
 * an occluded window hands back the previous frame on the first call.
 */
export async function pngWithReport(win: BrowserWindow, page: NativeImage): Promise<Buffer> {
  const v = view;
  if (!v || v.webContents.isDestroyed()) return page.toPNG();
  const scaleFactor = screen.getDisplayMatching(win.getBounds()).scaleFactor;
  await v.webContents.capturePage();
  await new Promise((r) => setTimeout(r, 120));
  const report = await v.webContents.capturePage();

  const base = { data: page.toBitmap({ scaleFactor }), ...page.getSize(scaleFactor) };
  const top = { data: report.toBitmap({ scaleFactor }), ...report.getSize(scaleFactor) };
  if (base.data.length !== base.width * base.height * 4 || top.data.length !== top.width * top.height * 4) {
    return page.toPNG();
  }
  // Bounds are in the window's content coordinates; the bitmap is in pixels.
  const scale = base.width / win.getContentBounds().width;
  const at = v.getBounds();
  const painted = overlay(base, top, at.x * scale, at.y * scale);
  return nativeImage.createFromBitmap(painted, { width: base.width, height: base.height, scaleFactor }).toPNG({ scaleFactor });
}

export function installHtmlView(getWindow: () => BrowserWindow | null): void {
  const fromMain = (sender: Electron.WebContents) => {
    const win = getWindow();
    return win && !win.isDestroyed() && sender === win.webContents ? win : null;
  };

  ipcMain.handle('artefacts:html:show', async (e, uid: unknown, bounds: unknown, scripts: unknown) => {
    const win = fromMain(e.sender);
    if (!win) return { ok: false, reason: 'This report cannot be shown here.' };
    return showReport(win, uid, bounds, scripts);
  });

  ipcMain.handle('artefacts:html:bounds', (e, bounds: unknown) => {
    const box = toBounds(bounds);
    if (!fromMain(e.sender) || !box || !view) return false;
    view.setBounds(box);
    return true;
  });

  ipcMain.handle('artefacts:html:hide', (e) => {
    const win = fromMain(e.sender);
    if (!win) return false;
    destroy(win);
    return true;
  });
}

/** When the window goes, the view and its session data go with it. */
export function closeHtmlView(win: BrowserWindow | null): void {
  destroy(win);
}
