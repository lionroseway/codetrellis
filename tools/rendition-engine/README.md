# The conversion engine

Phase 31 §7.6. The viewer shows Word, PowerPoint and Excel files as they look
by converting them to PDF with LibreOffice compiled to WebAssembly. This
directory is everything that decides what that engine is. The engine itself
is never committed: CI builds it here, publishes it, and the app pins its
hashes.

| | |
|---|---|
| LibreOffice | `d1c9e0e4e1ddeb24fe8f93e56860b3765043f8b1` (the final `libreoffice-24-8` commit), from https://github.com/LibreOffice/core |
| Emscripten | 3.1.74 |
| Licence | LibreOffice is MPL-2.0. The published engine is built from that commit plus the files here, so its source is exactly those two things. |

## Files

| File | What it does |
|---|---|
| `build.sh` | Fetches the pinned LibreOffice and Emscripten, applies the patch, configures, builds, collects the output. It can resume (see below). |
| `autogen.input` | LibreOffice's configuration: headless, all import/export filters, no Java, no scripting, no database drivers, no updater, no crash reporter. |
| `patches/wasm-build-fixes.patch` | The fixes LibreOffice 24.8 needs to build for WebAssembly and to export LibreOfficeKit to a driver. It is vendored from [matbeedotcom/libreoffice-document-converter](https://github.com/matbeedotcom/libreoffice-document-converter) at `b72a3d5`, is MPL-2.0 like the code it patches, and has sha256 `ca60837d08f8b1485e94fc004744b4467afd50abaa20c73b2d0d3f51fe71eb37`. `autogen.input` is based on the same project's. |
| `no-network.js` | An Emscripten JS library that replaces every socket syscall and name lookup with a stub that returns a constant error. `build.sh` links it and removes the Fetch API. |
| `stub-check.c` | `build.sh` builds this twice before compiling LibreOffice. First it links it plainly and runs it: every socket call and lookup must fail. Then it links it with LibreOffice's own flags (pthreads, `ASSERTIONS`, memory past 2 GB) and runs the network proof on the result. So a stub or proof that doesn't match what Emscripten emits fails within minutes, not after the final link. |
| `runtime/adapter.cjs` | Our driver. It loads the engine with no fetches and converts one document at a time through LibreOfficeKit. It runs inside the engine's confined process (`src/backend/services/rendition/child/main.ts`). |
| `assemble.ts` | Turns a finished build into an engine directory: the files, our driver, and `engine.json` with every file's sha256, where it was built from, and the network proof's result. |
| `prove-network-free.ts` | Runs `src/backend/services/rendition/network-proof.ts` on an engine. It checks that every network-capable import is a stub and that the glue carries no network machinery. |
| `hostile.ts` | Converts documents that try to reach out (remote images, template, fields, an external workbook, a macro on load) through the app's own host, against a listener that counts connections. It must count zero. |

## How it gets into the app

1. **Build.** Run the **Rendition engine** workflow (`.github/workflows/rendition-engine.yml`) by hand. It builds, assembles, proves, runs `hostile.ts` on Node 24 and Node 26, and publishes the prerelease `rendition-engine-<version>` on this repository.
2. **Pin.** The run's summary contains an `engine-lock.json`. Commit it as `src/backend/services/rendition/engine-lock.json`. The app compiles it in, so an engine on disk cannot vouch for itself.
3. **Package.** `npm run package:*` runs `scripts/fetch-rendition-engine.mjs`. That script downloads the pinned archive, checks the archive's hash and then every file's hash, and places the engine at `resources/rendition/engine`, which is packaged as `rendition/engine`. With `version: null` nothing is fetched, and Office files use their fallback views.

The version names the recipe: the LibreOffice commit plus a hash of `build.sh`, `autogen.input`, `no-network.js`, the patch and the driver. Changing any of those makes a new version. A published version is never replaced, because an app pinned to its hashes would stop verifying it.

## Why "network-free" is proven, not assumed

Node 25+ can deny a child process the network (`--permission` without `--allow-net`), and the engine host uses that where it can. Electron 44 bundles Node 24, which cannot. There, the host runs an engine only if its pin says `networkFree: true`, and CI writes that only for an engine that passed the proof and the hostile documents. See Phase 31 §7.6.

## Building locally

```sh
WORK=/path/with/60GB tools/rendition-engine/build.sh    # hours; resumable
npx tsx tools/rendition-engine/assemble.ts "$WORK/out" resources/rendition/engine
npm run build:rendition
npx tsx tools/rendition-engine/hostile.ts resources/rendition/engine
```

A source run (`npm run dev`) uses `resources/rendition/engine`, or `CODETRELLIS_RENDITION_ENGINE` if set, and trusts that directory's own `engine.json` when no pin is committed.

### Resuming

`MAKE_BUDGET=<seconds>` stops `make` cleanly after that long and exits 75. Compiler output is in ccache and third-party sources are in `$TARBALLS`, so the next run continues from there. CI works this way: a run that does not finish saves both caches and starts the next run, up to `continue_runs` times.

## Known build issues handled here

- **Autotext race.** One build step zips autotext files before they are generated on some runs. `build.sh` creates them early, as the upstream script does.
- **The data package path.** The glue records the build path of `soffice.data`. `build.sh` rewrites it to the bare name, and the driver hands the bytes in directly anyway.
- **An ~80 s stall on load.** LibreOffice's threaded XML parser hands file reads to a worker, and Emscripten proxies them back to the main thread, which is blocked waiting on that same worker. The driver sets `SAX_DISABLE_THREADS=1`.
