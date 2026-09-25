/**
 * Phase 31 §13 — runs in Electron (see run.ts). The real `htmlToPdf`, given
 * a page that tries to reach a local server by every route a page has —
 * an image, a stylesheet, an iframe, a script, a prefetch. The server
 * must see nothing, and what comes back must be a PDF.
 */
import { app } from 'electron';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { htmlToPdf } from '../../src/electron/signoff-pdf';

// The printing window is the only window, and destroying it would
// otherwise quit the app with status 0 — before the check has said
// anything, which would read as a pass.
app.on('window-all-closed', () => { /* the check decides when to exit */ });

app.whenReady().then(async () => {
  const hits: string[] = [];
  const server = http.createServer((req, res) => { hits.push(req.url ?? ''); res.end('x'); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const page = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${origin}/style.css"><link rel="prefetch" href="${origin}/prefetch">
</head><body><h1>Sign-off pack</h1><p>EMEA ties to the ledger — approved.</p>
<img src="${origin}/image.png"><iframe src="${origin}/frame"></iframe>
<script src="${origin}/script.js"></script><script>fetch('${origin}/fetch')</script>
</body></html>`;

  let failures: string[] = [];
  try {
    const pdf = await htmlToPdf(page);
    if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') failures.push('the output is not a PDF');
    if (pdf.length < 500) failures.push(`the PDF is implausibly small (${pdf.length} bytes)`);
    // Give anything asynchronous a moment to reach the server.
    await new Promise((r) => setTimeout(r, 500));
    if (hits.length > 0) failures.push(`the printing window reached the network: ${hits.join(', ')}`);
  } catch (err) {
    failures = [`htmlToPdf threw: ${err instanceof Error ? err.message : String(err)}`];
  }
  server.close();

  if (failures.length > 0) {
    console.error(`signoff-pdf-check: FAIL\n- ${failures.join('\n- ')}`);
    app.exit(1);
  } else {
    console.log('signoff-pdf-check: ok — a PDF, and nothing reached the network');
    app.exit(0);
  }
});
