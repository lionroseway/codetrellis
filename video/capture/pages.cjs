// Records web pages that are not the app: a pull request's checks on GitHub,
// a CI run's summary. The same screenshot loop as desktop.cjs (sharp enough to
// zoom into), driven by a list of pages instead of a demo. Signed out: it
// records only what a public page shows anyone.
//
// Usage: node pages.cjs --out=<dir> --plan=<plan.json> [--width=1440] [--height=810] [--scale=2]
//   plan: { "steps": [ { "title": "…", "url": "…", "waitFor": "text on the page",
//                        "scrollTo": "text to bring into view", "block": "center", "hold": 4 } ] }
// Each step is a scene: its title is written to <out>/demo.log as "N. Title"
// with the time, and encode.cjs turns that into scenes.json, as for a demo.
const fs = require('fs');
const path = require('path');
const { launch, flags } = require('./chromium.cjs');

const f = flags(process.argv.slice(2));
const OUT = path.resolve(f.out ?? 'pages');
const plan = JSON.parse(fs.readFileSync(path.resolve(f.plan), 'utf-8'));
const W = Number(f.width ?? 1440), H = Number(f.height ?? 810), SCALE = Number(f.scale ?? 2);

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE, colorScheme: 'dark' });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: SCALE, mobile: false });
  const meta = [];
  let going = true;
  const filming = (async () => {
    while (going) {
      const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92, optimizeForSpeed: true }).catch(() => null);
      if (!r) { await new Promise((res) => setTimeout(res, 50)); continue; }
      const n = meta.length;
      meta.push(Date.now() / 1000);
      fs.writeFileSync(path.join(OUT, 'frames', `${String(n).padStart(6, '0')}.jpg`), Buffer.from(r.data, 'base64'));
    }
  })();
  const log = [];
  for (const [i, s] of plan.steps.entries()) {
    await page.goto(s.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (s.waitFor) await page.getByText(s.waitFor).first().waitFor({ timeout: 30000 });
    if (s.scrollTo) {
      await page.getByText(s.scrollTo).first().evaluate((el, block) => el.scrollIntoView({ block }), s.block ?? 'center');
    }
    await page.waitForTimeout(700);
    // The scene starts once the page shows what it is for.
    log.push(`${(Date.now() / 1000).toFixed(3)} ${i + 1}. ${s.title}`);
    await page.waitForTimeout((s.hold ?? 4) * 1000);
  }
  going = false;
  // A screenshot that never answers (a page that went away under it) must not hang the recording.
  await Promise.race([filming, new Promise((res) => setTimeout(res, 5000))]);
  meta.push(Date.now() / 1000);
  fs.writeFileSync(path.join(OUT, 'frames.json'), JSON.stringify(meta));
  fs.writeFileSync(path.join(OUT, 'demo.log'), log.join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'capture.json'), JSON.stringify({ mode: 'hd', width: W * SCALE, height: H * SCALE, frames: meta.length - 1 }, null, 2));
  await browser.close();
  console.log(`pages: ${meta.length - 1} frames, ${plan.steps.length} pages`);
})().catch((e) => { console.error(e); process.exit(1); });
