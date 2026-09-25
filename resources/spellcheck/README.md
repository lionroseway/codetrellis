# Spell-check dictionaries

Hunspell dictionaries in Chromium's `.bdic` format, shipped with the app so
the spellchecker never downloads one. Without them, Chromium on Linux and
Windows fetches each language's dictionary from Google's CDN
(`redirector.gvt1.com`) the first time it is used. macOS uses the system
spellchecker and needs none of this.

`src/electron/spellcheck.ts` copies these into `<userData>/Dictionaries`
before the app is ready — where Chromium looks before it downloads — enables
only the languages that are here, and points any download at loopback.
`tools/spellcheck-check` proves it in real Electron in CI: English, British
and French system locales, no download attempted, a bundled dictionary
loaded.

## What is here, and why only English

The app's interface is English, and each dictionary is ~450 KB (German is
6.8 MB, Korean 11 MB). A person whose system language is not bundled gets
English spell-check rather than a download. To add a language, extract its
`.bdic` from the same archive and add a row below; the filename's version
suffix is Chromium's format version and must match what the Electron in
`package.json` asks for (check the archive for that Electron version).

## Provenance

Every file is taken unmodified from `hunspell_dictionaries.zip` on the
Electron **v44.4.1** release —
`https://github.com/electron/electron/releases/download/v44.4.1/hunspell_dictionaries.zip`
(sha256 `f75f5f4d42181996edd0cee535d48a1dde30f237238cc845ba106f029d0f2dde`),
which Electron builds from Chromium's `third_party/hunspell_dictionaries`.
The licence files are that archive's own.

| File | sha256 |
|---|---|
| `en-US-10-1.bdic` | `a075b01d9b015c616511a9e87da77da3d9881621db32f584e4606ddabf1c1100` |
| `en-GB-10-1.bdic` | `eaed4a709abdbd2f14aa143f25fe9c4c1b44591c7cb1942f75f968fb2fcd3cf8` |
| `en-AU-10-1.bdic` | `9e045c63b05e5435cd2045c8db9e2e15239a896d3363298fcbba2a3890d74eb1` |
| `en-CA-10-1.bdic` | `0820d1fbc03198ef2933d3a6aed58a21dca5bb901af2c1db02346a496d4b7bdc` |

When Electron is upgraded, check the new release's archive: if the English
files' names or hashes changed, replace them here in the same commit.
