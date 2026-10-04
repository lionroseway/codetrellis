// Records one real phone screen (tools/phone-preview on :5190, which renders
// mobile/app through react-native-web) being answered: the fixture's items
// are listed, the `tap` button is pressed, and the list then comes back
// empty, as it would once the desktop took the answer.
//
// Usage: node phone.cjs --fixture=phone/breakpoint.json --out=<dir> [--url=http://localhost:5190/]
// Writes frames/ (PNG, 3x), frames.json and tap.json (where and when the tap
// landed, in the phone's 390x844 points), which a composition can use to
// draw the touch.
const fs = require('fs');
const path = require('path');
const { launch, flags } = require('./chromium.cjs');

const f = flags(process.argv.slice(2));
const OUT = path.resolve(f.out ?? 'phone-capture');
const fx = JSON.parse(fs.readFileSync(path.resolve(__dirname, f.fixture ?? 'phone/breakpoint.json'), 'utf-8'));
// A negative hitAt is "this long ago".
const now = Date.now();
const items = fx.items.map((it) => (typeof it.hitAt === 'number' && it.hitAt <= 0 ? { ...it, hitAt: now + it.hitAt } : it));

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  const page = await ctx.newPage();
  await page.addInitScript(({ fx, items }) => {
    let answered = false;
    window.__PHONE__ = { state: fx.state ?? {}, calls: [], rpc: {
      [fx.list.method]: () => ({ [fx.list.key]: answered ? [] : items }),
      [fx.answer.method]: () => { answered = true; return { [fx.answer.key]: { ...items[0], ...fx.answer.set, answeredAt: Date.now() } }; },
    } };
  }, { fx, items });
  await page.goto(`${f.url ?? 'http://localhost:5190/'}?screen=${encodeURIComponent(fx.screen)}`);
  await page.locator('#phone[data-ready]').waitFor({ state: 'attached' });
  const button = page.getByText(fx.tap, { exact: true });
  await button.waitFor();
  await page.waitForTimeout(800);
  const box = await button.boundingBox();

  const meta = [];
  const grab = async () => {
    const n = meta.length;
    meta.push(Date.now() / 1000);
    await page.locator('#phone').screenshot({ path: path.join(OUT, 'frames', `${String(n).padStart(6, '0')}.png`) });
  };
  const hold = async (s) => { const end = Date.now() + s * 1000; while (Date.now() < end) await grab(); };
  await hold(fx.before ?? 1.5);
  const tapAt = Date.now() / 1000;
  await button.click();
  await hold(fx.after ?? 3);
  meta.push(Date.now() / 1000);
  fs.writeFileSync(path.join(OUT, 'frames.json'), JSON.stringify(meta));
  fs.writeFileSync(path.join(OUT, 'tap.json'), JSON.stringify({ x: box.x + box.width / 2, y: box.y + box.height / 2, at: +(tapAt - meta[0]).toFixed(2) }, null, 2));
  await browser.close();
  console.log(`phone: ${meta.length - 1} frames, tapped "${fx.tap}" at ${(tapAt - meta[0]).toFixed(2)} s`);
})().catch((e) => { console.error(e); process.exit(1); });
