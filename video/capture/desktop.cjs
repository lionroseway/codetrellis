// Records the CodeTrellis window (the web build on :5173) until <out>/stop
// appears. Two modes, because one capture cannot have both here:
//
//   --mode=hd      2x device pixels (3200x1800 for 1600x900) by screenshot
//                  loop. About 1 fps in a software-rendered cloud container,
//                  faster on a real machine. Sharp enough to zoom into; the UI
//                  changes in steps, and encode.cjs dissolves between them.
//   --mode=smooth  Chrome's own screencast (CDP). As many frames as the page
//                  paints, but only at CSS pixels (1600x900): use it 1:1.
//
// Not Playwright's recordVideo: that is ~1 Mbit/s VP8, blurry text.
//
// Usage: node desktop.cjs --out=<dir> [--mode=hd|smooth] [--width=1600] [--height=900] [--url=http://localhost:5173/]
const fs = require('fs');
const path = require('path');
const { launch, flags } = require('./chromium.cjs');

const f = flags(process.argv.slice(2));
const OUT = path.resolve(f.out ?? 'capture');
const MODE = f.mode ?? 'hd';
const W = Number(f.width ?? 1600), H = Number(f.height ?? 900), SCALE = MODE === 'hd' ? 2 : 1;
const STOP = path.join(OUT, 'stop');

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });
  const browser = await launch();
  const context = await browser.newContext({
    viewport: { width: W, height: H }, deviceScaleFactor: SCALE, colorScheme: 'dark',
    storageState: { cookies: [], origins: [{ origin: 'http://localhost:5173', localStorage: [
      { name: 'codetrellis:guide:seen', value: '1' }, { name: 'codetrellis:learn-trellis:seen', value: '1' }] }] },
  });
  // The first-run checklist is keyed by project path, which the demo makes fresh.
  await context.addInitScript(() => {
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function (k) { return String(k).startsWith('codetrellis:gettingStarted:dismissed:') ? '1' : get.call(this, k); };
  });
  const page = await context.newPage();
  await page.goto(f.url ?? 'http://localhost:5173/');
  await page.waitForTimeout(4000);
  const cdp = await context.newCDPSession(page);
  const meta = [];
  const writes = [];
  const save = (data) => {
    const n = meta.length;
    meta.push(Date.now() / 1000);
    writes.push(fs.promises.writeFile(path.join(OUT, 'frames', `${String(n).padStart(6, '0')}.jpg`), Buffer.from(data, 'base64')));
  };
  fs.writeFileSync(path.join(OUT, 'ready'), '1');

  if (MODE === 'hd') {
    // A CDP session of our own does not inherit Playwright's emulation:
    // without this, captureScreenshot returns CSS pixels.
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: SCALE, mobile: false });
    while (!fs.existsSync(STOP)) {
      const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92, optimizeForSpeed: true });
      save(r.data);
    }
  } else {
    cdp.on('Page.screencastFrame', (fr) => {
      save(fr.data);
      cdp.send('Page.screencastFrameAck', { sessionId: fr.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
    while (!fs.existsSync(STOP)) await page.waitForTimeout(250);
    await cdp.send('Page.stopScreencast');
  }
  meta.push(Date.now() / 1000); // when the last frame stops showing
  await Promise.all(writes);
  fs.writeFileSync(path.join(OUT, 'frames.json'), JSON.stringify(meta));
  fs.writeFileSync(path.join(OUT, 'capture.json'), JSON.stringify({ mode: MODE, width: W * SCALE, height: H * SCALE, frames: meta.length - 1 }, null, 2));
  await browser.close();
  console.log(`desktop: ${meta.length - 1} frames, ${(meta[meta.length - 1] - meta[0]).toFixed(1)} s, ${MODE}`);
})().catch((e) => { console.error(e); process.exit(1); });
