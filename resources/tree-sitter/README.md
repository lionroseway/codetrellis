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
| `tree-sitter-c-sharp.wasm` | `6f69e1cae44e1c32c1eccc170dc5a9778fb94ff716f71113fe1f8c4299aa2f40` | npm `tree-sitter-c-sharp@0.23.5`, the `tree-sitter-c_sharp.wasm` shipped in the package (Phase 27). ABI 15. |
| `tree-sitter-kotlin.wasm` | `7009d69453bc8735e438b2818a633efb21c88f99782769abba60dffedfab73f7` | npm `@tree-sitter-grammars/tree-sitter-kotlin@1.1.0`, the `tree-sitter-kotlin.wasm` shipped in the package (Phase 27). ABI 14. |
| `tree-sitter-swift.wasm` | `d084eceba50e9a83319f5d171051b53179bd22b6ea6419014900c602d52cfa28` | **Third-party build** — npm `@repomix/tree-sitter-wasms@0.1.17`, `out/tree-sitter-swift.wasm`, built from `tree-sitter-swift@0.7.1` with `tree-sitter-cli@0.26.3`. ABI 14. See "The one third-party grammar" below. |
| `tree-sitter-java.wasm` | `4fdeac4ca6ca089f06c6f7e562abcac1733cd465728cc7031ebb73c2019122c4` | unrecorded — predates this file |
| `tree-sitter-javascript.wasm` | `5fb488d0cabb4775a594bab85682de5ad6ce83c0d6ac997a9f82dd084d571240` | unrecorded — predates this file |
| `tree-sitter-php.wasm` | `d4df6a6ff08c87c3ec4f9cbb785fe09998a0cb570e03f57d7b19b3acfb146aa7` | unrecorded — predates this file |
| `tree-sitter-python.wasm` | `16108b50df4ee9a30168794252ab55e7c93bfc5765d7fa0aa3e335752c515f47` | unrecorded — predates this file |
| `tree-sitter-rust.wasm` | `f65f354215611fd94ad34134b3427eb3d58cbb745df7b6509ba722184db73d57` | unrecorded — predates this file |
| `tree-sitter-tsx.wasm` | `79e5da75ea62855a0cd67177685f0164eac87d5f630b3cbe1e0a099751ad30f8` | unrecorded — predates this file |
| `tree-sitter-typescript.wasm` | `778025db5a8be0e70f8ccc3671e486dfeddd048c25d9e8a70c26de2e1bf6f97d` | unrecorded — predates this file |
| `tree-sitter.wasm` | `c03bccdc3b448a32848f5ae327e209c982bbb0840d43eec8bc2d5759544a1ed3` | the `web-tree-sitter` runtime (see `package.json` for the pinned version) |

## The one third-party grammar

Every grammar above except Swift comes from the grammar's **own npm
package** — the maintainers' build, pinned to an exact immutable version,
reproducible with one `npm pack`.

Swift does not have one. No published `tree-sitter-swift` ships a wasm at
any version, and there is no `@tree-sitter-grammars/tree-sitter-swift`.
The committed file is built by `@repomix/tree-sitter-wasms`, a maintained
fork of `Gregoor/tree-sitter-wasms`.

This repository is public and these bytes ship inside a desktop app, so
say it plainly rather than leaving it to be discovered:

- **Bounded blast radius.** A tree-sitter grammar runs inside the wasm
  sandbox and imports nothing but the tree-sitter runtime — no
  filesystem, no network, no host calls. The worst a hostile grammar can
  do is return a wrong parse tree or hang the parse loop. That is much
  smaller than what an npm package with an install script can do.
- **What the hash proves and does not.** The sha256 above means a
  *change* to these bytes is visible in a diff. It does not prove the
  bytes correspond to `tree-sitter-swift@0.7.1`'s declared source; that
  rests on the publisher.
- **The exit.** Build it locally once the toolchain exists and replace
  the row. Swift is the only grammar here that needs that.

Reproduce the current bytes:

```bash
npm pack @repomix/tree-sitter-wasms@0.1.17
tar -xzf repomix-tree-sitter-wasms-0.1.17.tgz package/out/tree-sitter-swift.wasm
sha256sum package/out/tree-sitter-swift.wasm
```

The seven "unrecorded" rows are honest: those files were committed
before provenance was tracked, and guessing a version here would be
worse than saying so. Their hashes are recorded now, so any future
change to them is at least visible. Re-deriving their true origin is
worth doing the next time any of them is touched — this is a public
repo shipping compiled binaries, and "where did this come from" should
have an answer.

## Adding a grammar

1. Obtain the `.wasm`, preferring the grammar's own npm package — those
   are built against a current runtime.

   **Check every plausible package name before concluding no artifact
   exists.** Phase 27 initially costed Kotlin and Swift as needing an
   Emscripten toolchain because `tree-sitter-kotlin@0.3.8` ships no wasm.
   `@tree-sitter-grammars/tree-sitter-kotlin@1.1.0` — the maintained one,
   under the grammar org's scope — ships it. One `npm pack` of the right
   name replaced a multi-day build story. Names to try, in order:
   `@tree-sitter-grammars/tree-sitter-<lang>`, then
   `tree-sitter-<lang>`, then a reputable prebuilt bundle. Record which
   one you used.

   An external C scanner (`src/scanner.c`) is a hint that a local build
   will be fiddly, **not** evidence that no prebuilt exists — C#, Kotlin
   and Swift all have one and all three have a usable published wasm.
   See [docs/PHASE-27-LANGUAGE-EXPANSION.md](../../docs/PHASE-27-LANGUAGE-EXPANSION.md).
2. **Verify it loads and parses before writing any plugin code**, and
   read the grammar's real node shapes off a sample file rather than
   assuming them. Several grammars pack multiple declarations into one
   node type and separate them with an **anonymous** keyword token that
   `namedChildren` cannot see — Kotlin's `class_declaration` is class,
   interface and enum; Swift's is class, struct, enum and extension.
   Guessing there produces a plausible, wrong graph rather than an error.
   A unit test like `parsers/go.test.ts` is the cheapest way.
3. Commit it here and add a row above with its sha256 and exact source.
4. Register the plugin in `parsers/index.ts`, and add the extension to
   the scanner's `LANG_MAP` and the tag to `SupportedLanguage`. The
   file-watcher needs nothing — it derives its parseable-extension set
   from the same registry — and `findUnparsedLanguages()` fails the unit
   suite if the scanner tags a language no plugin claims.
5. Emit a **flat** symbol list with qualified member names
   (`Type.member`). Nested symbols are written to the database and then
   filtered out by every per-file reader — see `flattenSymbols` in
   `parsers/base.ts`.
6. Add the language to `frontend/lib/prism-lang.ts` and
   `frontend/lib/codemirror-lang.ts`, or deliberately leave it out.
   Both are guarded by `prism-lang.test.ts`; naming a grammar that is not
   installed renders plain text with no error.

To re-verify every hash:

```bash
cd resources/tree-sitter && sha256sum *.wasm
```
