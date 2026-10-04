// The browser the captures drive: the repository's own Playwright, and the
// Chromium env.sh found (VIDEO_CHROMIUM), else Playwright's default.
const path = require('path');

const repo = path.resolve(__dirname, '..', '..');
const { chromium } = require(require.resolve('playwright-core', { paths: [repo] }));

const ARGS = ['--disable-gpu', '--disable-gpu-compositing', '--hide-scrollbars', '--force-color-profile=srgb',
  // A recording should make no requests of its own.
  '--disable-background-networking', '--disable-component-update', '--no-pings'];

function launch() {
  return chromium.launch({ ...(process.env.VIDEO_CHROMIUM ? { executablePath: process.env.VIDEO_CHROMIUM } : {}), args: ARGS });
}

/** `--name=value` flags into an object. */
function flags(argv) {
  return Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => {
    const [k, ...v] = a.slice(2).split('=');
    return [k, v.length ? v.join('=') : true];
  }));
}

module.exports = { launch, flags };
