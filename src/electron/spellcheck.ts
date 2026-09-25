/**
 * Spell-check dictionaries that ship with the app, so none is downloaded.
 *
 * On Linux and Windows, Chromium's spellchecker is Hunspell, and by default
 * it fetches each language's dictionary from Google's CDN
 * (`redirector.gvt1.com`) the first time the language is used — a request
 * to a third party, from a tool that otherwise talks only to the machine it
 * runs on and the peers a person paired. macOS uses the system spellchecker
 * and downloads nothing, so none of this runs there.
 *
 * What stops the request, measured in Electron 44 rather than assumed:
 *
 *  - A dictionary already in `<userData>/Dictionaries` BEFORE the app is
 *    ready is loaded and nothing is fetched. Copied in any later, Chromium
 *    has already started the download.
 *  - `setSpellCheckerDictionaryDownloadURL` does not accept `file://` — the
 *    download simply fails — so the bundle cannot be served that way.
 *  - The languages come from the system locale unless set. They are set,
 *    in `session-created`, to the bundled ones only; the download URL is
 *    pointed at the loopback discard port, so a dictionary that is somehow
 *    missing fails on this machine instead of falling back to Google.
 *
 * `tools/spellcheck-check` proves it in real Electron in CI.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Session } from 'electron';

/**
 * Nothing listens on the discard port, and a download aimed at it never
 * leaves the machine. A guard, not a source: a bundled language never
 * reaches it.
 */
export const DICTIONARY_DOWNLOAD_GUARD = 'http://127.0.0.1:9/';

/** Chromium names a dictionary `<lang>-<format version>.bdic`. */
const BDIC = /^([A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*)-\d+-\d+\.bdic$/;

/** Where the bundle lives: `resources/spellcheck` from source, `<resources>/spellcheck` packaged. */
export function bundledDictionaryDir(appPath: string, resourcesPath: string | undefined, packaged: boolean): string {
  return packaged && resourcesPath ? path.join(resourcesPath, 'spellcheck') : path.join(appPath, 'resources', 'spellcheck');
}

/**
 * Copy the bundled dictionaries into `<userData>/Dictionaries`, where
 * Chromium looks before it downloads. Must run before the app is ready.
 * A file already there is replaced when its size differs — a stale or
 * truncated copy would otherwise be "found", fail to load, and be
 * downloaded. Returns the languages now installed.
 */
export function installDictionaries(bundleDir: string, userDataDir: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(bundleDir).filter((n) => BDIC.test(n));
  } catch {
    return [];
  }
  const target = path.join(userDataDir, 'Dictionaries');
  fs.mkdirSync(target, { recursive: true });
  const installed: string[] = [];
  for (const name of names) {
    const from = path.join(bundleDir, name);
    const to = path.join(target, name);
    try {
      const want = fs.statSync(from).size;
      const have = fs.existsSync(to) ? fs.statSync(to).size : -1;
      if (have !== want) fs.copyFileSync(from, to);
      installed.push(BDIC.exec(name)![1]);
    } catch (err) {
      console.warn(`[spellcheck] could not install ${name}:`, err);
    }
  }
  return installed;
}

const baseOf = (l: string) => l.split(/[-_]/)[0].toLowerCase();

/**
 * The spell-check languages to use: the person's preferred languages that
 * are bundled — exactly (`en-GB`), or by base language when no variant of
 * it is chosen yet (`en` → `en-US`, `fr` → `fr-FR`, else the first bundled
 * one) — else `en-US` when bundled, else none. A system that says
 * `en-US, en` gets one English dictionary, not two.
 */
export function chooseLanguages(installed: string[], preferred: string[]): string[] {
  const have = new Map(installed.map((l) => [l.toLowerCase(), l]));
  const chosen: string[] = [];
  const add = (l: string | undefined) => { if (l && !chosen.includes(l)) chosen.push(l); };
  for (const p of preferred) {
    const exact = have.get(p.toLowerCase().replace('_', '-'));
    if (exact) { add(exact); continue; }
    const base = baseOf(p);
    if (chosen.some((c) => baseOf(c) === base)) continue;
    const variants = installed.filter((l) => baseOf(l) === base);
    add(variants.find((l) => l.toLowerCase() === `${base}-${base}`)
      ?? variants.find((l) => l === 'en-US')
      ?? variants[0]);
  }
  if (chosen.length === 0) add(have.get('en-us'));
  return chosen;
}

/** Point a session at the bundle only. Call from `app.on('session-created')`. */
export function confineSpellcheck(ses: Session, installed: string[], preferred: string[]): void {
  ses.setSpellCheckerDictionaryDownloadURL(DICTIONARY_DOWNLOAD_GUARD);
  const languages = chooseLanguages(installed, preferred);
  if (languages.length === 0) {
    ses.setSpellCheckerEnabled(false);
    return;
  }
  ses.setSpellCheckerLanguages(languages);
}
