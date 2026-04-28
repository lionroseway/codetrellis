#!/usr/bin/env node
/**
 * Generate macOS `.icns` and Windows `.ico` from `resources/icon.png`.
 *
 * Run via `npm run build:icons` (added to package.json) or as the
 * `prepackage` npm-script hook so DMG / EXE builds always have
 * fresh icons. Idempotent — overwrites existing outputs.
 */
const fs = require('node:fs');
const path = require('node:path');
const png2icons = require('png2icons');

const SRC = path.join(__dirname, '..', 'resources', 'icon.png');
const ICNS = path.join(__dirname, '..', 'resources', 'icon.icns');
const ICO = path.join(__dirname, '..', 'resources', 'icon.ico');

if (!fs.existsSync(SRC)) {
  console.error(`[build-icons] Source missing: ${SRC}`);
  process.exit(1);
}

const png = fs.readFileSync(SRC);

// BICUBIC produces the cleanest downscale for icon sizes; the trade-off
// is ~1s longer than NEAREST and that's fine for a build step.
const icns = png2icons.createICNS(png, png2icons.BICUBIC, 0);
if (!icns) { console.error('[build-icons] ICNS generation failed'); process.exit(1); }
fs.writeFileSync(ICNS, icns);
console.log(`[build-icons] Wrote ${ICNS} (${(icns.length / 1024).toFixed(1)} KB)`);

const ico = png2icons.createICO(png, png2icons.BICUBIC, 0, false);
if (!ico) { console.error('[build-icons] ICO generation failed'); process.exit(1); }
fs.writeFileSync(ICO, ico);
console.log(`[build-icons] Wrote ${ICO} (${(ico.length / 1024).toFixed(1)} KB)`);
