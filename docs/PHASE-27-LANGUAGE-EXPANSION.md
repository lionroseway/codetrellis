# Phase 27 — Language expansion (Ruby, C#, Swift, Kotlin)

> Drafted: 2026-09-17
> **Implemented: 2026-09-17 → 18. All four languages shipped.**
> Pattern: [PHASE-20-GO-SUPPORT.md](PHASE-20-GO-SUPPORT.md) established
> the shape; this follows it.
>
> Sections marked **[changed]** record where the built thing differs from
> the plan, and why. The largest divergence is §3: the plan said Kotlin
> and Swift were blocked behind a wasm build toolchain. **That was wrong
> about Kotlin and only half right about Swift**, and finding out cost
> ten minutes of checking the right packages. Both shipped in this phase.

---

## 1. Where we stand

| Language | Parser | Resolver | Callsites | Notes |
|---|---|---|---|---|
| TypeScript / TSX / JS / JSX | ✅ | ✅ | ✅ | |
| Python | ✅ | ✅ | ✅ | |
| Rust | ✅ | ✅ | — | |
| PHP | ✅ | ✅ | — | |
| Java | ✅ | ✅ | — | |
| Go | ✅ | ✅ | ✅ | Phase 20 |
| SQL | n/a | n/a | ✅ | Phase 21 — symbols + refs, no import graph |
| **Ruby** | ✅ | ✅ | — | Phase 27 — **was declared but absent, see §2** |
| C# | ✅ | ✅ | — | Phase 27 |
| Swift | ✅ | ✅ | — | Phase 27 |
| Kotlin | ✅ | ✅ | — | Phase 27 |

**[changed] No callsite extractors were written for the four new
languages, deliberately.** A callsite extractor is what puts a service on
the cross-system map (`HttpClient` calls, ASP.NET route attributes, Ktor
routing, `URLSession`), and it is worth having — but it is a second body
of per-language pattern work with its own fixtures and its own failure
modes, and bundling it here would have meant four half-tested extractors
instead of four tested parsers. The symbol graph and the import graph
land first; "Still open after this phase" in §6 carries the
extractor work forward as its own slice.

## 2. Ruby was the Go bug, live — fixed

> Written before the fix and kept in the present tense, because the
> reasoning is the reusable part. `parsers/ruby.ts` now exists.

`'ruby'` is in the `SupportedLanguage` union and `.rb` is in the
scanner's `LANG_MAP` — but `parsers/ruby.ts` does not exist.

This is precisely the state Go was in before Phase 20, and it fails the
same way: **a Rails repository scans, discovers its files, draws every
one of them as a node, and shows zero symbols and zero edges.**
Confidently empty, with no error to read. A user concludes the product
does not work, and they are not wrong to.

It is also the third instance of this class in this codebase (the
file-watcher's extension list twice, and now this), which suggests the
real fix is structural: **a language should not be able to appear in
`SupportedLanguage` or `LANG_MAP` without a parser behind it.** A startup
assertion that cross-checks the three lists would have caught all three.
Worth adding as part of this phase.

Ruby is also the cheapest of the four to fix — `tree-sitter-ruby@0.23.1`
ships a prebuilt `.wasm`, so it takes the Go path exactly.

## 3. Grammar availability — **[changed], the plan was wrong here**

The original table said Kotlin and Swift ship no `.wasm` and are
therefore blocked behind a build toolchain this repository does not have.
That conclusion drove the whole sequencing in §6, and it was wrong.

What it actually got wrong: **it checked the wrong Kotlin package.**
`tree-sitter-kotlin@0.3.8` is the older community package and ships no
wasm. `@tree-sitter-grammars/tree-sitter-kotlin@1.1.0` — the
`tree-sitter-grammars` organisation's maintained one — ships
`tree-sitter-kotlin.wasm` in the tarball. One `npm pack` of the right
name turned "needs Emscripten and Docker" into "download it".

Corrected, and re-verified by loading every candidate under the pinned
`web-tree-sitter@0.27` before writing a line of plugin code:

| Grammar | Source actually used | ABI | Size | First-party? |
|---|---|---|---|---|
| Ruby | `tree-sitter-ruby@0.23.1` | 15 | 2.1 MB | yes |
| C# | `tree-sitter-c-sharp@0.23.5` | 15 | 5.4 MB | yes |
| Kotlin | `@tree-sitter-grammars/tree-sitter-kotlin@1.1.0` | 14 | 3.4 MB | yes |
| Swift | `@repomix/tree-sitter-wasms@0.1.17` | 14 | 3.4 MB | **no — see below** |

**Swift is the one genuine third-party binary.** No published
`tree-sitter-swift` ships a wasm at any version, and there is no
`@tree-sitter-grammars/tree-sitter-swift` at all; the artifact used is
built by `@repomix/tree-sitter-wasms`, a maintained fork of
`Gregoor/tree-sitter-wasms` that compiles `tree-sitter-swift@0.7.1` with
`tree-sitter-cli@0.26.3`. This repository is public and these bytes ship
inside a desktop app, so the tradeoff is stated rather than assumed:

- **What it can do.** A tree-sitter grammar runs inside the wasm sandbox
  with no imports beyond the tree-sitter runtime — no filesystem, no
  network, no host calls. The worst a hostile grammar achieves is a wrong
  parse tree or a hang in the parse loop. That is a materially smaller
  blast radius than an npm package with an install script.
- **What it cannot do.** Nothing proves the bytes correspond to
  `tree-sitter-swift@0.7.1`'s declared source. The version is pinned and
  the sha256 is recorded in `resources/tree-sitter/README.md`, so a
  *change* is visible; the *origin* rests on the publisher.
- **The exit.** Build it locally once the toolchain exists (§6.4) and
  replace the row. Swift is the only language that needs that now.

`tree-sitter-wasms@0.1.13` is still not a shortcut — its Go build failed
to load under `web-tree-sitter@0.27` during Phase 20 with an opaque
dylink error. The `@repomix` fork at 0.1.17 is a different, current
build, and its Swift and C# grammars were both load-tested here before
being trusted.

### Weight

Three grammars added 12.2 MB to `resources/tree-sitter/`, which is copied
verbatim into the packaged app. Measured cost at boot, where every
grammar is compiled eagerly by `loadGrammars()`:

| | load time |
|---|---|
| C# (5.4 MB) | 28 ms |
| Swift (3.4 MB) | 14 ms |
| Kotlin (3.4 MB) | 11 ms |
| **all twelve grammars** | **103 ms** |

53 ms added to boot. Lazy per-language loading was considered and
rejected: it trades a measured 53 ms for a cache-miss stall on first
open of a file, plus a code path that only runs for some users. The
installer-size cost is the real one, and 12 MB on an Electron app is
worth four languages.

## 4. Kotlin before Swift — **[changed], moot**

The plan argued for Kotlin ahead of Swift on the grounds that Kotlin
covers Android *and* JVM backend work and compounds with the existing
Java parser, while Swift is iOS-only and the fussier grammar to build.
The reasoning still holds and would still be the right call under the
original constraint. That constraint evaporated with §3, so both shipped
together and the ordering never had to be paid for.

Worth keeping for the next time: **check for a prebuilt artifact under
every plausible package name before costing a build toolchain.** The
plan spent its sequencing budget on a blocker that was one `npm view`
away from not existing.

## 5. Per-language notes

### Ruby

- **Symbols**: `class`, `module`, `def`, `def self.`, attr accessors.
  Qualify instance methods as `Class#method` and class methods as
  `Class.method` — the Ruby convention, and the same collision problem Go
  had with `Handle` and `String`.
- **Imports**: `require`, `require_relative`, `load`, and Rails
  autoloading. `require_relative` resolves like a path;
  `require 'foo'` is a load-path lookup. **Rails autoloading resolves
  nothing explicitly at all** — `User` just works — so a Rails app's real
  dependency graph is implied by naming convention, not by imports.
  Worth stating plainly in the plugin header: for a Rails repo, expect
  `require_relative` edges and little else until a convention-based
  resolver exists.
- **Callsites**: **not built** — see §1. When they are: `Net::HTTP`,
  `HTTParty`, `RestClient`; routes in `config/routes.rb` (a DSL, not a
  decorator — closer to chi's grouped router than to FastAPI's
  decorators).

### C# — **[changed] resolution works from the csproj, not a namespace index**

- **Symbols**: `class`, `record`, `struct`, `interface`, `enum`,
  `delegate`, methods, constructors, properties, fields, events, nested
  types. Namespaces are descended through, not emitted — **both forms**,
  the block `namespace X { … }` and the C# 10 file-scoped `namespace X;`.
  A test asserts the two produce identical symbols, because otherwise a
  project's architecture diagram would change when it bumped its language
  version.
- **Imports**: the plan said "index namespaces to the files declaring
  them, then longest-prefix match". The built resolver indexes
  **`.csproj` root namespaces** instead, then maps the remaining dotted
  segments to directories. Why the change: building a namespace→file
  index needs each file's *declared* namespace, and `ResolveContext`
  carries file paths, not parse results — threading parsed namespaces
  into resolution would have been a cross-cutting change to the resolver
  contract for one language. The csproj gives the same answer from data
  `system-discovery` already has, and `<RootNamespace>` is read straight
  from the project file (mtime-cached, exactly like the Go resolver's
  `replace` directives).
- **What it refuses to do**: no type-level resolution (`using Acme.X`
  then `new Invoice()` needs a symbol table), no `<Compile Include>`
  handling (SDK-style defaults assumed, so an explicit-include project
  under-resolves rather than mis-resolves), no BCL or NuGet edges.

### Kotlin — **[changed] shipped, not deferred**

- **Symbols**: `class`, `interface`, `enum class`, `object`,
  `companion object`, `data class`, functions, properties, `typealias`,
  enum entries, primary-constructor `val`/`var` properties.
- **The trap**: `class`, `interface` and `enum class` are all one
  `class_declaration` node, and the distinguishing keyword is an
  **anonymous token** — invisible to `namedChildren`. Reading named
  children alone files every Kotlin interface as a class, silently. The
  same shape of trap appears in Swift (four declarations, one node) and
  is why these three languages share a test suite.
- **Imports**: package-qualified like Java's, resolved to the package
  directory under a Gradle / Android / Multiplatform source root, with
  the final segment as a *preference* rather than a requirement —
  Kotlin does not require the file to be named after the declaration,
  and top-level functions have no declaration to be named after.
  `src/main/java` is in the source-root list on purpose: Kotlin files
  living there are legal and common mid-migration, and omitting it is
  how a conventional resolver silently misses half a project.

### Swift — **[changed] shipped, and honestly limited**

- **Symbols**: `class`, `struct`, `enum`, `actor`, `extension`,
  `protocol`, functions, `init`/`deinit`/`subscript`, properties,
  `typealias`, enum cases. An extension is named `Type (extension)` so it
  cannot collide with the type it extends — they are different places,
  usually in different files.
- **Imports resolve, but Swift barely has any.** Within a module every
  file sees every other with **no import statement at all**; `import`
  crosses a module boundary and nothing else. So a single-module iOS app
  — which is most of them — produces essentially no internal import
  edges no matter how good the resolver is. Swift's value in the graph is
  its symbols and (later) its callsites. The resolver maps a module name
  to its SwiftPM target directory under `Sources/`, which is a hard
  convention the build system enforces, and stops there.

## 5a. Two bugs this phase surfaced in existing code

Neither was in scope. Both were found by adding a language on top of
them, and both are the same species as §2: **a list that had drifted, in
a way nothing reported.**

### Nested symbols were written and never read

`symbols.parent_symbol_id` exists, and `insertSymbol` recurses to fill it
in. But `getFileSymbols` (the inspector's file list), the per-file symbol
counts in `trellis-service` and `mobile-rpc-service`, and the MCP
plan-item symbol lookup all filter on `parent_symbol_id IS NULL`. Only
free-text symbol *search* and the global row count see children.

So a nested member was **half-present**: findable by search, missing from
its own file's symbol list, and uncounted in that file's symbol total.
Nobody chose that. It is what happens when some plugins emit trees (Java
did) and others emit flat qualified names (Go's `(Ledger).Post`, Ruby's
`Invoice#post`, TypeScript's methods) and nothing asserts which.

**Java was the live casualty**: its methods were nested *and* unqualified
(`post`, `run`, `close`), so they were absent from every per-file view
and collided with each other in search.

Fixed by making the flat form the contract — `flattenSymbols` in
`parsers/base.ts`, applied by Java, C#, Kotlin and Swift — with a unit
test asserting every plugin emits a flat list. The parent relationship
moves into the name, which is where every reader already looks.

**The alternative not taken**, deliberately: teach the readers to walk
the tree. That is a real product change — file symbol lists become
expandable, per-file counts jump — and it belongs in its own phase, not
smuggled in behind a language addition. `parent_symbol_id` is left in the
schema for it; it is simply always NULL until then.

### The syntax highlighter claimed six languages it did not have

`prism-react-renderer` bundles its own cut-down Prism, much smaller than
Prism's full component list. `CodePreview`'s language map named `java`,
`php`, `ruby`, `bash`, `toml` and `scss` — **none of which are in the
bundle**. The renderer treats a missing grammar as `null` and returns the
source as one plain token, so Java and PHP files had been rendering
unhighlighted while the map said otherwise. No error, no warning.

Fixed by moving the map to `frontend/lib/prism-lang.ts` (beside the
CodeMirror one), resolving every tag against the live registry at use,
and a unit test asserting the map never again names a grammar that is not
there. C#, Java and PHP now borrow `clike`, which is correct as far as it
goes for brace-and-semicolon languages. **Ruby stays plain on purpose** —
it is not C-family, so a borrowed grammar would mis-tokenise it rather
than under-tokenise it, and a wrong grammar is worse than none.

The diff editor got the better outcome: `@codemirror/legacy-modes` — the
CodeMirror project's own mode library, released alongside the 6.x line —
has real stream modes for C#, Kotlin and Swift. A stream mode has no
incremental parse tree, but a read-only diff uses tokens, not trees, so
all three are highlighted by a maintained grammar for their own language.
Cost: 34 kB on a chunk that is already lazy-loaded.

## 6. Sequence — as executed

1. ✅ **Ruby** — the live bug in §2, grammar ready, took the Go path.
2. ✅ **The structural guard** — `findUnparsedLanguages()` cross-checks
   the scanner's `LANG_MAP` against the parser registry at startup and
   reports (not throws) on a language tagged with nothing behind it. A
   unit test asserts the set is empty.
3. ✅ **C#** — grammar ready, `.csproj` discovery added to
   `system-discovery`.
4. ⏭️ **The wasm build toolchain** — **not needed and not built.** §3
   explains why: three of four grammars had first-party wasm, and Swift
   had a credible third-party build. This stays open as the exit path for
   the Swift row and for any future grammar that ships no artifact. It is
   no longer blocking anything.
5. ✅ **Kotlin**, ✅ **Swift**.

### Still open after this phase

- **Callsite extractors** for Ruby, C#, Kotlin and Swift — the work that
  puts these services on the cross-system map. Shapes are known and
  decorator-like in three of the four: ASP.NET `[HttpGet("/api/orders")]`
  and `HttpClient`; Ktor/Spring routing; `URLSession`; `Net::HTTP` /
  `HTTParty` plus the `config/routes.rb` DSL (closer to chi's grouped
  router than to FastAPI's decorators).
- **Rails convention-based resolution.** Autoloading resolves nothing
  explicitly — `User` just works — so a Rails app's real dependency graph
  is implied by naming, not by `require`. Today a Rails repo gets
  `require_relative` edges and little else, and the plugin header says so
  rather than letting the sparse graph imply the code is uncoupled.
- **Swift's grammar provenance** — replace the third-party build with a
  local one (§3).
- **Reading the symbol tree back**, if the product wants nested file
  symbol lists (§5a).

## 7. Tests — as built

Per language, mirroring `go-support.test.ts`:

- `parsers/ruby.test.ts` and `parsers/jvm-and-apple.test.ts` — unit
  suites that load the committed grammar directly, so an ABI-incompatible
  wasm fails in seconds instead of presenting as a silently empty
  language. 27 assertions across C#, Kotlin and Swift; 14 for Ruby.
- `tests/e2e/ruby-support.test.ts` and
  `tests/e2e/jvm-apple-support.test.ts` — symbols of every kind through
  the real scan, in-project imports resolving, stdlib and SDK imports
  **not** resolving, and an edit-triggers-reparse check per extension
  (the file-watcher's list has gone stale twice, so it is asserted, not
  assumed).
- `frontend/lib/prism-lang.test.ts` — the highlighting-map guard from
  §5a.
- Fixture services in the shared fixture, small and deterministic:
  `services/notifier` (Ruby), `services/reporting` (C#, with a
  `<RootNamespace>` that differs from the directory name),
  `services/scheduler` (Kotlin, Gradle layout), `mobile-client` (Swift,
  SwiftPM with two targets).

## 8. Done when — status

- ✅ A Rails repository shows symbols and edges instead of a
  constellation of empty nodes.
- ✅ A .NET repository does the same, and so do Kotlin and Swift ones.
- ✅ `resources/tree-sitter/README.md` records every grammar's exact
  source and sha256, including which single grammar is a third-party
  build and what that does and does not mean.
- ⏭️ Building a grammar wasm from source is documented as a procedure but
  has not been *executed* here — nothing in this phase required it.
