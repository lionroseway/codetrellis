# Tree-sitter grammars

These `.wasm` files are the parser grammars `ast-parser.ts` loads at
boot, one per `ParserPlugin.grammarFile`. They are committed rather
than fetched at install time, and copied verbatim into the packaged app
via `extraResource`.

`tree-sitter.wasm` is not a grammar — it is the **runtime**, loaded by
`Parser.init({ locateFile })`. It must stay ABI-compatible with the
pinned `web-tree-sitter` version in `package.json`.

## Compatibility

A grammar built for an older tree-sitter ABI fails at
`Language.load()` with an opaque emscripten dylink error, and
`loadGrammars()` catches it, logs a warning and carries on — so an
incompatible grammar presents as **a language that silently produces no
symbols and no edges**, not as a crash. That is a slow, confusing
failure, so:

- `src/backend/services/parsers/go.test.ts` loads the Go grammar
  directly under `npm run test:unit` and asserts it parses. It is the
  fastest signal that a grammar swap broke something. Worth copying for
  the other languages.
- A grammar from a bundle that targets an older runtime will not load.
  During Phase 20 the `tree-sitter-wasms@0.1.13` build of Go failed
  exactly this way against `web-tree-sitter@0.27`; the grammar shipped
  in the official `tree-sitter-go` npm package loaded cleanly.

## Provenance

| File | sha256 | Source |
|---|---|---|
| `tree-sitter-go.wasm` | `9504573f352b20be7f2f1911754d710622aedc15afff16d5ed8fb5645681aee7` | npm `tree-sitter-go@0.25.0`, the `tree-sitter-go.wasm` shipped in the package (Phase 20) |
| `tree-sitter-ruby.wasm` | `09a96427d7c72f0613ed470cd9812223fc4a91d6a9c025c0235cc6bd59ff96f4` | npm `tree-sitter-ruby@0.23.1`, the `tree-sitter-ruby.wasm` shipped in the package (Phase 27) |
| `tree-sitter-java.wasm` | `4fdeac4ca6ca089f06c6f7e562abcac1733cd465728cc7031ebb73c2019122c4` | unrecorded — predates this file |
| `tree-sitter-javascript.wasm` | `5fb488d0cabb4775a594bab85682de5ad6ce83c0d6ac997a9f82dd084d571240` | unrecorded — predates this file |
| `tree-sitter-php.wasm` | `d4df6a6ff08c87c3ec4f9cbb785fe09998a0cb570e03f57d7b19b3acfb146aa7` | unrecorded — predates this file |
| `tree-sitter-python.wasm` | `16108b50df4ee9a30168794252ab55e7c93bfc5765d7fa0aa3e335752c515f47` | unrecorded — predates this file |
| `tree-sitter-rust.wasm` | `f65f354215611fd94ad34134b3427eb3d58cbb745df7b6509ba722184db73d57` | unrecorded — predates this file |
| `tree-sitter-tsx.wasm` | `79e5da75ea62855a0cd67177685f0164eac87d5f630b3cbe1e0a099751ad30f8` | unrecorded — predates this file |
| `tree-sitter-typescript.wasm` | `778025db5a8be0e70f8ccc3671e486dfeddd048c25d9e8a70c26de2e1bf6f97d` | unrecorded — predates this file |
| `tree-sitter.wasm` | `c03bccdc3b448a32848f5ae327e209c982bbb0840d43eec8bc2d5759544a1ed3` | the `web-tree-sitter` runtime (see `package.json` for the pinned version) |

The seven "unrecorded" rows are honest: those files were committed
before provenance was tracked, and guessing a version here would be
worse than saying so. Their hashes are recorded now, so any future
change to them is at least visible. Re-deriving their true origin is
worth doing the next time any of them is touched — this is a public
repo shipping compiled binaries, and "where did this come from" should
have an answer.

## Adding a grammar

1. Obtain the `.wasm` (prefer the grammar's own npm package — those are
   built against a current runtime). **Check first whether the package
   ships one at all**: as of 2026-09-17, `tree-sitter-ruby` and
   `tree-sitter-c-sharp` do; `tree-sitter-swift` and `tree-sitter-kotlin`
   do not, and both also carry an external C scanner, so they need a
   local build with the tree-sitter CLI plus Emscripten or Docker. See
   [docs/PHASE-27-LANGUAGE-EXPANSION.md](../../docs/PHASE-27-LANGUAGE-EXPANSION.md).
2. Verify it loads and parses before writing any plugin code. A unit
   test like `parsers/go.test.ts` is the cheapest way.
3. Commit it here and add a row above with its sha256 and exact source.
4. Register the plugin in `parsers/index.ts`. Nothing else needs
   changing — `getPluginForFile` indexes by extension, and the
   file-watcher derives its parseable-extension set from the same
   registry.

To re-verify every hash:

```bash
cd resources/tree-sitter && sha256sum *.wasm
```
