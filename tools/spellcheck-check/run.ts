/**
 * `npx tsx tools/spellcheck-check/run.ts`
 *
 * On Linux and Windows, Chromium's spellchecker downloads its dictionaries
 * from Google's CDN unless one is already where it looks. The app ships
 * its own (src/electron/spellcheck.ts). This starts real Electron the way
 * the app does, under English, British and French system locales, and
 * requires that no download is ever attempted and that a bundled
 * dictionary loads. A control run without the bundle must see a download
 * begin — otherwise this check could not tell the difference.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

interface Result {
  installed: string[];
  languages: string[];
  events: Array<{ event: string; language: string }>;
}

const REPO = path.resolve(__dirname, '../..');

function launch(main: string, mode: 'confined' | 'control', lang: string): Result | string {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-spellcheck-ud-'));
  const electron = String(require('electron'));
  // This checks where dictionaries come from, not Chromium's sandbox; as
  // root Electron will not start without this switch.
  const args = [main, ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])];
  const cmd = process.platform === 'linux' && !process.env.DISPLAY ? ['xvfb-run', '-a', electron, ...args] : [electron, ...args];
  const r = spawnSync(cmd[0], cmd.slice(1), {
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      LANG: `${lang}.UTF-8`, LANGUAGE: lang, LC_ALL: `${lang}.UTF-8`,
      CHECK_MODE: mode, CHECK_USER_DATA: userData, CHECK_BUNDLE: path.join(REPO, 'resources', 'spellcheck'),
    },
  });
  fs.rmSync(userData, { recursive: true, force: true });
  const line = (r.stdout ?? '').split('\n').find((l) => l.startsWith('SPELLCHECK-RESULT '));
  if (!line) return `Electron reported nothing (status ${r.status}): ${(r.stderr ?? '').slice(-400)}`;
  return JSON.parse(line.slice('SPELLCHECK-RESULT '.length)) as Result;
}

async function main(): Promise<void> {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-spellcheck-'));
  await build({
    bundle: true, logLevel: 'error', external: ['electron'],
    entryPoints: [path.join(__dirname, 'main.ts')], outfile: path.join(work, 'main.cjs'), platform: 'node', format: 'cjs',
  });
  const main = path.join(work, 'main.cjs');
  const failures: string[] = [];

  for (const [lang, expected] of [['en_US', 'en-US'], ['en_GB', 'en-GB'], ['fr_FR', 'en-US']] as const) {
    const r = launch(main, 'confined', lang);
    if (typeof r === 'string') { failures.push(`${lang}: ${r}`); continue; }
    const downloads = r.events.filter((e) => e.event.includes('download'));
    const loaded = r.events.filter((e) => e.event === 'spellcheck-dictionary-initialized').map((e) => e.language);
    console.log(`  ${lang}: languages ${r.languages.join(', ')} · loaded ${loaded.join(', ') || 'nothing'} · downloads ${downloads.length}`);
    if (downloads.length > 0) failures.push(`${lang}: a dictionary download was attempted: ${downloads.map((d) => `${d.event} ${d.language}`).join(', ')}`);
    if (!r.languages.every((l) => r.installed.includes(l))) failures.push(`${lang}: a language that is not bundled was enabled: ${r.languages.join(', ')}`);
    if (!loaded.includes(expected)) failures.push(`${lang}: the bundled ${expected} dictionary never loaded`);
  }

  const control = launch(main, 'control', 'en_US');
  if (typeof control === 'string') failures.push(`control: ${control}`);
  else {
    const began = control.events.some((e) => e.event === 'spellcheck-dictionary-download-begin');
    console.log(`  control (no bundle): download attempted ${began ? 'yes' : 'no'}`);
    if (!began) failures.push('control: without the bundle no download was seen either — this check cannot see downloads');
  }

  fs.rmSync(work, { recursive: true, force: true });
  if (failures.length) {
    console.error(`\nSpell-check dictionaries: FAILED\n${failures.map((f) => `  - ${f}`).join('\n')}`);
    process.exit(1);
  }
  console.log('\nSpell-check dictionaries: bundled ones load, and nothing is downloaded.');
}

void main();
