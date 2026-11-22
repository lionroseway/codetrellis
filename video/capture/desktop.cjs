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
// Usage: node desktop.cjs --out=<dir> [--mode=hd|smooth] [--width=1600] [--height=900] [--scale=2] [--url=http://localhost:5173/]
// A smaller window at a higher scale (1280x720 at 2.5) is the same 3200x1800
// picture with everything in it larger: for footage shown to a room.
const fs = require('fs');
const path = require('path');
const { launch, flags } = require('./chromium.cjs');

const f = flags(process.argv.slice(2));
const OUT = path.resolve(f.out ?? 'capture');
const MODE = f.mode ?? 'hd';
const W = Number(f.width ?? 1600), H = Number(f.height ?? 900), SCALE = MODE === 'hd' ? Number(f.scale ?? 2) : 1;
const STOP = path.join(OUT, 'stop');

// A person's steps in the window, taken for the demo: it writes a request to
// <out>/ui/<n>.json (scripts/demo/lib/window.ts) and waits for <n>.done. Each
// is done in the real page, with a pointer the recording can see travel there
// first, so a click is never a change with no visible cause.
//   { do: 'click', target }      { do: 'type', target, text, delay? }
//   { do: 'press', key }         { do: 'scroll', target }
// target: { testid } | { label } | { text, exact? } | { css }, with optional
// `within` (a target) and `nth`.
const UI = path.join(OUT, 'ui');
function locate(page, t) {
  const base = t.within ? locate(page, t.within) : page;
  let l = t.testid ? base.getByTestId(t.testid)
    : t.label ? base.getByLabel(t.label)
    : t.text ? base.getByText(t.text, { exact: t.exact ?? false })
    : t.role ? base.getByRole(t.role, { name: t.name })
    : base.locator(t.css);
  if (t.has) l = l.filter({ hasText: t.has });
  return t.nth === undefined ? l.first() : l.nth(t.nth);
}
async function pointAt(page, l) {
  await l.scrollIntoViewIfNeeded({ timeout: 8000 });
  const box = await l.boundingBox();
  if (!box) throw new Error('not on screen');
  const x = box.x + Math.min(box.width / 2, 120), y = box.y + box.height / 2;
  await page.evaluate(([px, py]) => {
    let c = document.getElementById('__pointer');
    if (!c) {
      c = document.createElement('div');
      c.id = '__pointer';
      c.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(255,255,255,.28);border:2px solid rgba(255,255,255,.9);box-shadow:0 0 0 1px rgba(0,0,0,.45);z-index:2147483647;pointer-events:none;transition:transform .45s cubic-bezier(.3,.7,.2,1),opacity .3s;transform:translate(800px,450px)';
      document.body.appendChild(c);
      void c.offsetWidth;
    }
    c.style.opacity = '1';
    c.style.transform = `translate(${px}px,${py}px)`;
  }, [x, y]);
  await page.waitForTimeout(600);
  return { x, y };
}
async function pulse(page) {
  await page.evaluate(() => {
    const c = document.getElementById('__pointer');
    if (!c) return;
    c.animate([{ boxShadow: '0 0 0 0 rgba(255,255,255,.7)' }, { boxShadow: '0 0 0 16px rgba(255,255,255,0)' }], { duration: 450 });
    setTimeout(() => { c.style.opacity = '0'; }, 900);
  });
}
async function act(page) {
  const done = new Set();
  while (!fs.existsSync(STOP)) {
    const todo = fs.existsSync(UI) ? fs.readdirSync(UI).filter((n) => n.endsWith('.json') && !done.has(n)).sort() : [];
    for (const name of todo) {
      done.add(name);
      const stem = path.join(UI, name.replace(/\.json$/, ''));
      let how = 'ok';
      try {
        const a = JSON.parse(fs.readFileSync(path.join(UI, name), 'utf-8'));
        if (a.do === 'press') await page.keyboard.press(a.key);
        else {
          const l = locate(page, a.target);
          await l.waitFor({ state: 'visible', timeout: a.timeout ?? 15000 });
          if (a.do === 'scroll') { await l.evaluate((el, block) => el.scrollIntoView({ block, behavior: 'smooth' }), a.block ?? 'center'); await page.waitForTimeout(500); }
          else {
            await pointAt(page, l);
            await pulse(page);
            // Clicked in the page itself: with a screenshot taken every few
            // milliseconds beside it, the browser's own mouse never settles on
            // a target (a click timed out after six seconds, every time).
            await l.evaluate((el) => { el.click(); if (typeof el.focus === 'function') el.focus(); });
            if (a.do === 'type') await page.keyboard.type(a.text, { delay: a.delay ?? 35 });
          }
        }
        fs.writeFileSync(`${stem}.done`, how.startsWith('ok (') ? 'ok' : how);
        fs.appendFileSync(path.join(UI, 'log.txt'), `${name} ${how}\n`);
      } catch (e) {
        fs.writeFileSync(`${stem}.done`, `failed: ${String(e && e.message || e).split('\n')[0]}`);
        fs.appendFileSync(path.join(UI, 'log.txt'), `${name} failed: ${String(e && e.message || e)}\n`);
      }
    }
    await page.waitForTimeout(100);
  }
}

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });
  const browser = await launch();
  const context = await browser.newContext({
    viewport: { width: W, height: H }, deviceScaleFactor: SCALE, colorScheme: 'dark',
    storageState: { cookies: [], origins: [{ origin: new URL(f.url ?? 'http://localhost:5173/').origin, localStorage: [
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
  const acting = act(page);

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
  await acting;
  meta.push(Date.now() / 1000); // when the last frame stops showing
  await Promise.all(writes);
  fs.writeFileSync(path.join(OUT, 'frames.json'), JSON.stringify(meta));
  fs.writeFileSync(path.join(OUT, 'capture.json'), JSON.stringify({ mode: MODE, width: W * SCALE, height: H * SCALE, frames: meta.length - 1 }, null, 2));
  await browser.close();
  console.log(`desktop: ${meta.length - 1} frames, ${(meta[meta.length - 1] - meta[0]).toFixed(1)} s, ${MODE}`);
})().catch((e) => { console.error(e); process.exit(1); });
