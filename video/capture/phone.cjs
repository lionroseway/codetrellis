// Records one real phone screen (tools/phone-preview on :5190, which renders
// mobile/app through react-native-web). Two kinds of fixture:
//  - answered: `list` and `answer` methods. The fixture's items are listed,
//    the `tap` button is pressed, and the list then comes back empty, as it
//    would once the desktop took the answer.
//  - shown: `rpc` (method -> answer) and optional `params`. The screen is
//    held for `before` seconds, nothing tapped.
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
// A time given as a negative number of milliseconds is "this long ago", so a
// fixture reads "9 min ago" whenever it is recorded.
const now = Date.now();
const TIMES = new Set(['hitAt', 'firstSeen', 'lastSeen', 'toldAt', 'answeredAt', 'at']);
const relative = (v, key) => {
  if (Array.isArray(v)) return v.map((x) => relative(x));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, relative(x, k)]));
  return TIMES.has(key) && typeof v === 'number' && v <= 0 ? now + v : v;
};
fx.rpc = relative(fx.rpc ?? {});
const items = relative(fx.items ?? []);

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  const page = await ctx.newPage();
  await page.addInitScript(({ fx, items }) => {
    let answered = false;
    const rpc = { ...(fx.rpc ?? {}) };
    if (fx.list) rpc[fx.list.method] = () => ({ [fx.list.key]: answered ? [] : items });
    if (fx.answer) rpc[fx.answer.method] = () => { answered = true; return { [fx.answer.key]: { ...items[0], ...fx.answer.set, answeredAt: Date.now() } }; };
    window.__PHONE__ = { state: fx.state ?? {}, calls: [], rpc };
  }, { fx, items });
  const q = new URLSearchParams({ screen: fx.screen, ...(fx.params ? { params: JSON.stringify(fx.params) } : {}) });
  await page.goto(`${f.url ?? 'http://localhost:5190/'}?${q}`);
  await page.locator('#phone[data-ready]').waitFor({ state: 'attached' });
  const button = fx.tap ? page.getByText(fx.tap, { exact: true }) : null;
  if (button) await button.waitFor();
  else if (fx.waitFor) await page.getByText(fx.waitFor).first().waitFor();
  await page.waitForTimeout(800);
  const box = button ? await button.boundingBox() : null;

  const meta = [];
  const grab = async () => {
    const n = meta.length;
    meta.push(Date.now() / 1000);
    await page.locator('#phone').screenshot({ path: path.join(OUT, 'frames', `${String(n).padStart(6, '0')}.png`) });
  };
  const hold = async (s) => { const end = Date.now() + s * 1000; while (Date.now() < end) await grab(); };
  await hold(fx.before ?? 1.5);
  const tapAt = Date.now() / 1000;
  if (button) {
    await button.click();
    await hold(fx.after ?? 3);
  }
  meta.push(Date.now() / 1000);
  fs.writeFileSync(path.join(OUT, 'frames.json'), JSON.stringify(meta));
  if (box) fs.writeFileSync(path.join(OUT, 'tap.json'), JSON.stringify({ x: box.x + box.width / 2, y: box.y + box.height / 2, at: +(tapAt - meta[0]).toFixed(2) }, null, 2));
  await browser.close();
  console.log(`phone: ${meta.length - 1} frames${button ? `, tapped "${fx.tap}" at ${(tapAt - meta[0]).toFixed(2)} s` : ''}`);
})().catch((e) => { console.error(e); process.exit(1); });
