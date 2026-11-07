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
Electron **v45.2.3** release —
`https://github.com/electron/electron/releases/download/v45.2.3/hunspell_dictionaries.zip`
(sha256 `f4692e1bc615b542478c8cf4c5d3424ea2d9c891076a8f218b0da0ba06b8d5c8`),
which Electron builds from Chromium's `third_party/hunspell_dictionaries`.
The licence files are that archive's own, unchanged from v44's.

| File | sha256 |
|---|---|
| `en-US-10-2.bdic` | `b0d80e6b6c5491879365e176ecbd98074602a663429bcfcfb0a5a8375c051f13` |
| `en-GB-10-2.bdic` | `e014c23d2215f093205343b9b8805e17c8d8e115d314d93fd5ba51eadf05cff2` |
| `en-AU-10-2.bdic` | `13427b9828773291cde00ba266a58fd5110ba6f1d4b29ed86b49f4b3afdf0a39` |
| `en-CA-10-2.bdic` | `4e0ab8e315fff2c7db23476e08a287088005912a08d9d5a2efc601699b7d34a8` |

Electron 45 moved Chromium's dictionary format from `10-1` to `10-2`, so the
v44 files (`en-*-10-1.bdic`, from v44.4.1's archive and unchanged in v44.10.1's)
were replaced in the commit that moved Electron to 45: Electron 45 looks for
the `10-2` name, so the old files would not have been found.

When Electron is upgraded, check the new release's archive: if the English
files' names or hashes changed, replace them here in the same commit.
