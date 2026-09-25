/**
 * Phase 31 §7.1 — runs in Electron (see run.ts). The real transport module,
 * the real preload and the real fetch shim, in a file:// page as packaged:
 * an artefact's bytes must reach fetch() unchanged, a rendition's refusal
 * must arrive as its JSON, <img> must still load through the scheme, and a
 * window that is not the app's must be refused.
 */
import { app, BrowserWindow, protocol } from 'electron';
import path from 'node:path';
import { ARTEFACT_SCHEME, installArtefactTransport } from '../../src/electron/artefact-transport';

protocol.registerSchemesAsPrivileged([ARTEFACT_SCHEME]);

const here = __dirname;
const FILE = '11111111-1111-4111-8111-111111111111';
const IMAGE = '22222222-2222-4222-8222-222222222222';
// Every byte value: decoded as UTF-8 anywhere on the way, 128–255 would not survive.
const BYTES = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

async function respond(url: string): Promise<Response> {
  const u = new URL(url);
  if (u.searchParams.get('rendition') === 'pdf') {
    return new Response(JSON.stringify({ error: 'this build carries no conversion engine', fallback: true }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (u.hostname === IMAGE) return new Response(PNG, { headers: { 'Content-Type': 'image/png' } });
  if (u.hostname === FILE) return new Response(BYTES, { headers: { 'Content-Type': 'application/octet-stream' } });
  return new Response('Not a file that can be shown', { status: 404 });
}

function window(): BrowserWindow {
  return new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
  });
}

async function resultOf(win: BrowserWindow): Promise<Record<string, unknown>> {
  for (let i = 0; i < 100; i++) {
    const r = await win.webContents.executeJavaScript('window.__result');
    if (r) return r;
    await new Promise((res) => setTimeout(res, 100));
  }
  return { error: 'the page never finished' };
}

app.whenReady().then(async () => {
  let appWindow: BrowserWindow | null = null;
  installArtefactTransport(respond, (sender) => sender === appWindow?.webContents);
  appWindow = window();
  await appWindow.loadFile(path.join(here, 'page.html'), { query: { ipc: '1', file: FILE, image: IMAGE } });
  const r = await resultOf(appWindow);

  // Another window with the same preload is not the app's window.
  const other = window();
  await other.loadFile(path.join(here, 'blank.html'));
  const refused = await other.webContents.executeJavaScript(`window.codetrellisIpc.artefact('ct-artefact://${FILE}').then((x) => x.status)`);

  const checks: Array<[string, boolean, unknown]> = [
    ['fetch() gets the bytes, every one of them', r.status === 200 && r.bytesIntact === true, r],
    ['with the content type', r.type === 'application/octet-stream', r.type],
    ['a rendition refused arrives as its JSON, for the fallback', r.renditionStatus === 503 && r.renditionFallback === true, r],
    ['an unknown uid is a 404', r.unknownStatus === 404, r.unknownStatus],
    ['<img> still loads through the scheme', r.img === 'loaded', r.img],
    ['a window that is not the app\'s is refused', refused === 403, refused],
  ];
  let failed = 0;
  for (const [what, ok, got] of checks) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : ` — got ${JSON.stringify(got)}`}`);
    if (!ok) failed++;
  }
  app.exit(failed ? 1 : 0);
});
