# CodeTrellis conventions

Rules this codebase has that nobody could infer by reading it, where a
violation is unambiguous, and which CI cannot see.

Every entry here earned its place — each one is either a bug that shipped, a
decision that was made deliberately, or a boundary that is load-bearing. Do not
add rules that are merely good practice; the portable dimension references
already cover those, and padding this file is how a reviewer loses credibility.

When a convention finding is accepted in review, add the rule here so the set
compounds instead of dying in a closed PR thread.

---

## This repository is public

`lionroseway/codetrellis` is public. Everything committed is world-readable the
moment it lands, and a secret pushed then reverted is still in the history and
already scraped.

**Finding:** anything that reads as a security finding register — severities,
reproduction steps, "this endpoint is unauthenticated", file-and-line pointers
to an unfixed hole — anywhere outside `docs/private/`.

The rule is narrower than it sounds. *Architecture rules* are safe and belong
in the tree: "all filesystem access goes through the confined-file helper" is a
standard. *Status* is not: "the confined-file helper is not applied to
`contribution-service` yet" is a map. Write the rule, never the gap.

**Finding:** any new file under `docs/private/` referenced from a tracked file
by a path that implies its contents.

---

## `require('./relative')` in `src/backend` is forbidden

**This has shipped broken to users twice.**

rollup bundles static `import` and `await import()`. A runtime CommonJS
`require('./relative')` is left exactly as written. On disk in dev it resolves,
typecheck is happy, `npm run build` passes — and in the packaged app the
relative path does not exist next to the bundled `out/main/main.js`, so it
throws `MODULE_NOT_FOUND` at runtime.

Bare requires are fine — `require('fs')`, `require('better-sqlite3')` are
built-ins or externalised natives, not relative paths.

**Finding:** any `require('./…')` or `require('../…')` added under
`src/backend`. `scripts/check-no-relative-require.sh` catches it, but say so in
review anyway: the author needs to know *why*, because the obvious fix
(switching to a static import) is sometimes wrong for a genuinely lazy load, and
the right answer is then `await import()`.

Related failure with the same root cause: a service reachable only through a
dynamic require can be omitted from the bundle entirely and nothing notices
until a packaged build runs. If a PR adds a backend service, check it is
reachable through a static import chain.

---

## V1 plan tools are gone — do not reintroduce them

The MCP surface migrated from V1 (`plans` / `plan_tasks` / `plan_phases` /
`plan_docs`) to V2 (`plan_items`, a unified Object + Action tree). The 19 V1
tools — `claim_task`, `add_subtask`, `add_plan_doc`, `add_plan_phase`,
`update_task`, `get_next_task` and the rest — were **removed**, not deprecated.

The migration was triggered by an agent making 34 MCP calls with zero UI
updates, because V1 tools wrote to tables the V2 workspace does not render.

**Finding:** a new MCP tool, REST route, or service function that writes to the
V1 tables, or that reintroduces task/phase/doc CRUD alongside `plan_items`.
Work goes through `plan-item-service` and `plan-event-service`, and emits
`plan-item-*` WebSocket events.

**Finding:** a tool that mutates plan state without broadcasting. The UI reads
exclusively from WebSocket events; a write that does not broadcast is invisible,
which is the exact bug the migration existed to fix.

---

## MCP tools live in `src/backend/mcp/tools/`, one file per domain

18 files, one per domain. `server.ts` is ~530 lines and binds transports; it is
not where tools go. It used to be a 2000-line monolith and the split was
deliberate.

**Finding:** a `registerTool` call added to `mcp/server.ts` rather than to the
matching `tools/<domain>-tools.ts`.

---

## The graph is a projection, never a source of truth

The graph store holds derived state. Scans, plans and git are upstream of it.

**Finding:** a write path that updates graph state without updating what it was
derived from, or a component that treats a graph node's `data` as authoritative
for anything persisted.

---

## One Zustand store per domain, and stores do not call each other

Stores live in `src/frontend/stores/`, one per domain (graph, agent, project,
plan, ui, toast, presence, channels, terminal, system-docs).

**Finding:** a store importing another store. Cross-domain coordination belongs
in the component or hook that owns the interaction, not in the store layer —
store-to-store imports produce initialisation-order bugs that only appear in the
packaged app.

---

## Per-language plugins must be registered

Parsers, resolvers and callsite extractors are per-language plugins at
`services/parsers/<lang>.ts`, `services/resolvers/<lang>.ts`,
`services/callsites/<lang>.ts`.

**Finding:** a new language file added without a corresponding entry in the
matching `index.ts`. It typechecks, it is never called, and the symptom is
silently missing edges rather than an error.

---

## The bridge abstraction picks the transport — nothing else may

`src/frontend/bridge/` selects HTTP (web/dev), Electron IPC (desktop), or
WebRTC data channels (peer-routed) at runtime.

**Finding:** a component or store issuing `fetch` directly to the backend, or
reaching for `window.codetrellisIpc` outside the bridge. As of v0.1.2 the
desktop binds **zero TCP ports** for the backend — the renderer reaches it via
IPC — so a direct `fetch` works in the browser and fails in the shipped app.

---

## Release artifacts are version-pinned, and one thing owns the build

**Finding:** an unpinned glob over build output (`*.deb` rather than
`*-${VERSION}.deb`). An unpinned glob sweeps a stale artifact from a previous
run into a release, and nothing about the result looks wrong until a user
reports the wrong version. This has been fixed once already.

**Finding:** re-enabling the `push.tags` trigger in `release.yml` while
`scripts/release.sh` still dispatches `build-installers.yml`. Both would fire
and two multi-platform builds would race to attach assets to the same release.
One of them owns the build, never both.

**Finding:** adding AppImage back to a distributed set. It is built but not
shipped — the target disables the Chromium sandbox, and sandboxing stays on in
everything distributed.

---

## Mobile is Expo/React Native, and that is settled

The companion is a genuinely native client — WebRTC mesh, four data channels,
binary PTY, audio. A webview shell cannot host `react-native-webrtc`.

**Finding:** a PR that moves mobile toward a webview shell, or that duplicates
desktop web UI into the mobile app rather than driving it over the `ui` channel.

`ios/` and `android/` are gitignored — this is a CNG project and `expo prebuild`
regenerates them.

**Finding:** a committed `ios/` or `android/` file, or native config written
into the Xcode project rather than `app.json` or a config plugin. It will be
silently wiped on the next prebuild.

---

## Pairing and reconnect changes are lockstep releases

The pairing/reconnect protocol spans `peer-connection-service.ts`,
`pairing-service.ts` and `mobile/lib/webrtc.ts`. A change to one side without
the other breaks every existing pairing in the field.

**Finding:** a protocol-level change to one side only, or one that changes the
handshake without a note about forced re-pairing.

---

## Node is pinned at 22

`.nvmrc` and `.node-version` both say 22. `better-sqlite3` is a native binding
and the version drift is what left a working tree without a usable binding
before.

**Finding:** a workflow using a literal `node-version:` rather than
`node-version-file: .nvmrc`. The pin exists so there is one place to change it.
