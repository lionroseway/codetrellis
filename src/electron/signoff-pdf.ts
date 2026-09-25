/**
 * Phase 31 §13 — the sign-off pack as a PDF.
 *
 * Chromium prints the pack's page (signoff-pack.ts) to PDF in a window
 * nobody sees, built to be inert:
 *  - JavaScript is off, and the page has none anyway (its one `<script>`
 *    is `application/json` data);
 *  - it has its own in-memory session, so nothing it does touches the app's
 *    storage, and every request except the page itself is refused — the
 *    page's CSP says `default-src 'none'` too, but the session does not
 *    rely on it;
 *  - it is destroyed when the PDF is made.
 */

import { BrowserWindow, session } from 'electron';

let seq = 0;

export async function htmlToPdf(html: string): Promise<Buffer> {
  const partition = `signoff-pdf-${process.pid}-${++seq}`;
  const ses = session.fromPartition(partition, { cache: false });
  ses.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith('data:text/html') });
  });
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: {
      javascript: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      session: ses,
      spellcheck: false,
    },
  });
  try {
    await win.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html, 'utf-8').toString('base64')}`);
    return await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
    });
  } finally {
    win.destroy();
    void ses.clearStorageData().catch(() => {});
  }
}
