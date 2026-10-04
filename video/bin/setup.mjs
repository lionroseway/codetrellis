// Copies what the compositions load from disk into each one's assets/: GSAP
// and the Geist fonts. Renders never fetch anything, so these must be local.
// Run after `npm install`; the copies are gitignored.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '..');
const require = createRequire(path.join(root, 'package.json'));

const gsap = require.resolve('gsap/dist/gsap.min.js');
const fonts = [
  ['@fontsource/geist-sans', [400, 500, 600, 700]],
  ['@fontsource/geist-mono', [400, 500]],
].flatMap(([pkg, weights]) => {
  const dir = path.join(path.dirname(require.resolve(`${pkg}/package.json`)), 'files');
  const name = pkg.split('/')[1];
  return weights.map((w) => path.join(dir, `${name}-latin-${w}-normal.woff2`));
});

const hyperframes = ['collision', 'real-footage', 'real-ui-hero', 'hero'];
// The only mark any video uses: the app's own icon.
const logo = path.resolve(root, '..', 'resources', 'icon.png');
for (const c of hyperframes) {
  const dest = path.join(root, 'compositions', c, 'assets');
  fs.mkdirSync(dest, { recursive: true });
  for (const f of [gsap, ...fonts]) fs.copyFileSync(f, path.join(dest, path.basename(f)));
  fs.copyFileSync(logo, path.join(dest, 'logo.png'));
  console.log(`compositions/${c}/assets: gsap + ${fonts.length} fonts + logo`);
}
const remotionFonts = path.join(root, 'compositions', 'remotion-hero', 'public', 'fonts');
fs.mkdirSync(remotionFonts, { recursive: true });
for (const f of fonts) fs.copyFileSync(f, path.join(remotionFonts, path.basename(f)));
console.log(`compositions/remotion-hero/public/fonts: ${fonts.length} fonts`);
