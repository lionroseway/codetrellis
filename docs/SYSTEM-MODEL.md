# System Model & Multi-Language Ingestion

Status: planning + Phase 1 in flight (2026-04-26)
Owner: high priority
Tracker: see [TRACKER.md](TRACKER.md) §3 Phase 11

---

## Why this exists

CodeTrellis was originally built around npm + JavaScript imports. Real
codebases — including the projects we're testing against — are not.

A typical real repo looks like this:

```
my-saas/
├── apps/
│   ├── web/           ← Next.js (TS)
│   ├── admin/         ← React (TS)
│   └── mobile/        ← React Native (TS)
├── packages/
│   ├── ui/            ← shared component lib (TS)
│   ├── types/         ← shared types (TS)
│   └── api-client/    ← generated OpenAPI client (TS)
├── services/
│   └── realtime/      ← Node service (TS, NOT in npm workspaces)
├── backend/
│   ├── fastapi/       ← Python FastAPI
│   └── workers/       ← Python Celery workers
├── infra/             ← Terraform + shell
├── migrations/        ← SQL files
├── e2e/               ← Playwright (TS)
└── docs/              ← Mixed (Markdown + Python demo scripts)
```

The current pipeline:

- Detects only npm-style monorepos (`package.json workspaces`,
  `pnpm-workspace.yaml`, `nx.json`, `turbo.json`)
- Resolves only relative imports + a hardcoded `@shared` alias
- Extracts imports only for JS/TS-flavor `import_statement` nodes
- Treats the whole repo as one flat space; clusters are inferred from
  file paths and edges, both of which are JS-skewed

Result for a repo like the one above:

- `services/realtime/` — invisible (not in npm `workspaces`)
- `backend/fastapi/` — files appear in tree but every Python file has
  zero edges → invisible in the dependency graph
- `apps/admin` — appears, but its imports of `@swf/ui` /
  `@swf/payments` etc. don't resolve, so it shows up as an isolated
  cluster instead of connected to the package layer
- `migrations/` SQL files — not parsed at all
- `infra/` shell — not parsed

We need a richer ingestion model.

---

## The model

```
Project
   ↓
System              ← top-level boundary (manifest-driven, hard)
   ↓
Cluster             ← architectural grouping (inferred or explicit, soft)
   ↓
File
   ↓
Symbol
```

…with **edges** between files and symbols, of multiple kinds.

### System (NEW first-class entity)

A coherent unit of code with its own conventions, manifest, and
runtime. Detected by manifest signals — see [Discovery rules](#discovery-rules).

A system has:

- `id` — generated stable identifier
- `name` — from manifest (e.g. `@swf/admin`) or directory name
- `rootPath` — absolute path to the system root
- `language` — primary language (or `mixed`)
- `manifestKind` — `package.json`, `pyproject.toml`, `Cargo.toml`,
  `composer.json`, `pom.xml`, `go.mod`, `Gemfile`, `tsconfig.json`,
  or `informal` (no manifest, but has source code)
- `manifestPath` — absolute path to the manifest file
- `isWorkspaceRoot` — true if the manifest declares sub-workspaces
- `packageName` — the npm name if applicable (drives alias resolution)
- `workspaceGlobs` — sub-workspace patterns if the manifest has them

A file belongs to its **nearest ancestor system**. Files outside any
system end up in a synthetic root system tagged `informal`.

### Cluster (existing, redefined scope)

Cluster is now **intra-system by default** — each system gets its own
cluster set, inferred from path + dependency relationships within that
system. So `@swf/admin` has its own clusters; `backend/fastapi` has
its own clusters. They don't bleed.

Clusters can also be **cross-system** for vertical features: an "Auth"
cluster spanning frontend auth + shared types + backend auth. These
are the high-value architectural lenses humans actually think in. They
have to be explicitly created (by user or agent), since they cut
across hard boundaries.

So three lenses on the same code:

- **System view** — manifest-driven, hard boundaries → "what runs where"
- **Cluster view within system** — dependency-inferred, soft → "what hangs together inside this system"
- **Cross-system feature cluster** — manual or agent-curated → "this feature spans these systems"

### Edges

Not just imports. Multiple kinds, each with its own extractor:

| Edge kind | Source | Target | Detection |
|---|---|---|---|
| `import` | file | file | Per-language import extractor + resolver |
| `call` | symbol | symbol | Per-language call-graph extractor (later) |
| `http_route` | frontend fetch site | backend route handler | URL string match between fetch and route decorator/registration |
| `sql_ref` | code (string literal) | table / view / function | SQL parser on string literals + migration parser |
| `subprocess` | code | invoked script | `spawn` / `subprocess.run` argument detection |
| `env_ref` | code | env var | `process.env.X` / `os.getenv('X')` detection |
| `route_link` | OpenAPI client | route handler | Generated client → declared route |

For v1 we ship **multi-language `import` only**. Other kinds are how we
eventually link Python backend ↔ TS frontend ↔ SQL schema in one
graph; they come later.

---

## Discovery rules

System discovery walks the directory tree (respecting ignores) and
emits a system for every manifest it finds.

| Manifest file | System kind | Detected language |
|---|---|---|
| `package.json` (with `workspaces`) | npm/yarn/pnpm monorepo *root* | typescript / javascript |
| `pnpm-workspace.yaml` | pnpm monorepo root | typescript / javascript |
| `nx.json` | nx monorepo root | typescript / javascript |
| `turbo.json` | turborepo root | typescript / javascript |
| `package.json` (without `workspaces`) | npm package or app | typescript / javascript |
| `pyproject.toml` | Python project | python |
| `setup.py` (without `pyproject.toml`) | Python project | python |
| `requirements.txt` (without `pyproject.toml` / `setup.py`) | Python project | python |
| `Cargo.toml` `[workspace]` | Rust workspace root | rust |
| `Cargo.toml` (standalone) | Rust crate | rust |
| `go.mod` | Go module | go |
| `composer.json` | PHP project | php |
| `pom.xml` | Java/Maven project | java |
| `build.gradle` / `build.gradle.kts` | Java/Gradle project | java |
| `Gemfile` | Ruby project | ruby |
| `tsconfig.json` (without nearby `package.json`) | Standalone TS area | typescript |
| Folder with source code, no manifest | "Informal system" — flag for promotion | inferred from contents |

Crucial: **system discovery is not "find npm workspaces." It's "find
every manifest, anywhere in the tree, and treat each as a system root."**

When manifests nest (e.g. an npm workspace root contains sub-package
manifests), both are systems. Files belong to the *nearest* one.

---

## Per-language plumbing

Each language needs four pieces:

1. **Tree-sitter import extractor** — recognizes the language's import
   AST nodes and pulls out the source string + imported names
2. **Resolver** — turns import strings into file paths within the
   project, knowing the language's resolution rules
3. **Manifest reader** — extracts package metadata (name, version,
   workspace globs, dependencies)
4. **Optional: alias map source** — TS `compilerOptions.paths`, Python
   namespace packages, PHP PSR-4 from composer, Java package dirs

Current status:

| Language | Extract | Resolve | Manifest | Alias |
|---|---|---|---|---|
| TS / JS | ✅ | partial (only `@shared` hardcoded) | ✅ npm | ❌ workspace + tsconfig.paths |
| Python | ❌ | ❌ | ❌ | ❌ |
| Rust | ❌ | ❌ | ❌ | n/a (crates) |
| PHP | ❌ | ❌ | ❌ | ❌ PSR-4 |
| Java | ❌ | ❌ | ❌ | n/a (package dirs) |
| Go | ❌ | ❌ | ❌ | n/a (module-relative) |
| SQL | n/a | ❌ ref-tracker | n/a | n/a |

### Per-language resolution rules

**TypeScript / JavaScript**
- Relative: `./foo`, `../foo` → search candidate file extensions + `/index.{ext}`
- Workspace alias: `@swf/ui` → look up name in package index, find that package's entry (try `src/index.{ts,tsx,js,jsx}`, `index.{ts,tsx,js,jsx}`, then `package.json` `source` / `main` resolved to source)
- TS path mapping: walk up from importer to nearest `tsconfig.json`, read `compilerOptions.paths`, apply pattern substitution
- Anything else (npm package): skip

**Python**
- Relative: `from . import x`, `from .foo import x` → relative to importer's package
- Absolute project import: `from app.routes import x` → resolve from the system root, treating each subdir with `__init__.py` (or implicit namespace) as a package
- Standard lib / pip: skip

**Rust**
- `use crate::foo` → relative to crate root
- `use self::foo`, `use super::foo` → relative to module
- `use external_crate::foo` → check Cargo workspace; skip if external
- Resolution looks at `mod.rs` / `lib.rs` / `main.rs` per Rust module convention

**PHP**
- `use Vendor\Package\Class` → resolve via PSR-4 mapping in nearest
  `composer.json`'s `autoload.psr-4`
- `require 'path'` / `require_once 'path'` → relative

**Java**
- `import com.example.foo.Bar` → resolve `com/example/foo/Bar.java`
  under each source root (`src/main/java`, `src/test/java`, etc.)
- Skip `java.*`, `javax.*` standard library

**Go**
- `import "module-path/sub"` → strip the module name (from `go.mod`)
  to get the local subpath; resolve to that directory
- Skip standard library + third-party

**SQL** (later)
- Parse string literals in code looking for `SELECT FROM <table>`,
  `INSERT INTO <table>`, etc.
- Build a table index from migration files (`CREATE TABLE`)
- Edge from code → table

---

## Cross-system links (later phases)

The whole point of "PHP + Python + SQL all in one project" is being
able to see the architecture *across* those systems. None of that is
captured by imports. Specific link kinds:

### HTTP route link

- Backend declares routes (FastAPI `@router.get('/api/orders')`,
  Express `app.get('/api/orders', handler)`, Hono `app.get(...)`,
  Django urls.py)
- Frontend issues fetches (`fetch('/api/orders')`, `axios.get(...)`,
  generated client methods)
- Match by URL string → edge from fetch site to route handler
- Type strictness varies: exact string match is easy; templated routes
  (`/api/orders/{id}`) need pattern match

### SQL reference link

- Code contains queries: parse string literals for SQL keywords +
  table names
- Migrations declare tables: parse `CREATE TABLE`, `CREATE VIEW`
- Edge from code → table; tables become first-class nodes

### Env var / secret link

- Backend reads `os.getenv('STRIPE_KEY')`, `process.env.STRIPE_KEY`
- Deployment / `.env.example` declares them
- Edge from code → env var declaration; surfaces deployment surface

### Subprocess link

- Code calls `spawn('./tool')`, `subprocess.run(['./script.sh'])`
- Edge from caller → invoked script

### OpenAPI / contract link

- Spec file (`openapi.yaml`) declares endpoints + schemas
- Generated client + backend handlers reference it
- Edge from each generated symbol → spec node; deviation = drift from
  the contract

---

## Shared assets / shared libs

Three flavors, treated differently:

**1. In-repo declared package** (`packages/ui` with its own
`package.json`)
→ already a system; alias resolution makes it appear connected. ✅

**2. In-repo shared folder, no manifest** (e.g. `shared/utils/`)
→ either an "informal system" (if it has substantial code) or just a
directory that gets clustered within an ancestor system. Imports
resolve via TS path aliases or relative paths.

**3. Out-of-repo private package** (in `node_modules` from a private
registry, or git submodule)
→ not ingested by default. Future feature: "mark this dependency as
interesting" → CodeTrellis ingests its source as a virtual system.
Submodules can be detected via `.gitmodules` and treated as
sub-systems.

---

## Phase plan

### Phase 1 — Stop losing things (½ day, fixes the immediate complaint)

Goal: every system in a real repo gets discovered; in-repo aliases resolve.

| Item | Effect |
|---|---|
| Better ignore list (`venv`, `build`, `vendor`, `test-results`, etc.) | Stops drowning the scanner in venvs and test artifacts |
| Generic system discovery — find every manifest | `services/realtime/`, `backend/fastapi/`, `e2e/` etc. become known systems |
| Dynamic package alias map from every `package.json` | `@swf/ui`, `@swf/types`, etc. resolve → `apps/admin`'s edges to packages light up |
| Read `tsconfig.json` `paths` at every level | TS path aliases respected per-app |

**Acceptance:** opening swf shows `services/realtime/`,
`backend/fastapi/`, and the npm workspace packages all as known
systems; `apps/admin` has dependency edges to `@swf/ui`, `@swf/types`,
`@swf/payments`, etc.

### Phase 2 — Per-language depth (1–2 days)

Goal: each single-language system in the repo is fully connected internally.

| Item | Effect |
|---|---|
| Python `import_statement` + `import_from_statement` extraction | `backend/fastapi/` symbols connect |
| Python resolver (relative + project-anchored absolute) | Edges resolve within Python systems |
| Rust `use_declaration` + crate-relative resolver | Future Rust support |
| PHP `namespace_use_declaration` + PSR-4 from `composer.json` | PHP support |
| Java `import_declaration` + package-dir resolver | Java support |
| Go `import` + module-relative resolver | Go support |

**Acceptance:** opening a multi-language repo shows each language's
files connected to each other within their own systems via real
imports.

### Phase 3 — System model in the data layer (1 day)

Goal: System is a first-class entity that the rest of the app reasons about.

| Item | Effect |
|---|---|
| `systems` table (id, name, rootPath, language, manifestKind, manifestPath, packageName) | First-class entity |
| `system_id` column on `files` table | Files attributed to systems |
| MCP: `list_systems`, `get_system_files`, `get_system_dependencies` | Agents can query system-scoped |
| REST: `/api/systems`, `/api/systems/:id/files`, `/api/systems/:id/dependencies` | Frontend uses |

**Acceptance:** `GET /api/systems` returns all detected systems for an
opened project, each with file counts and inter-system dependency counts.

### Phase 4 — System-aware UI (1–2 days)

Goal: the user sees and works with systems, not just files.

| Item | Effect |
|---|---|
| Sidebar: top-level "Systems" section above the file tree | The user sees admin / web / mobile / api-client / fastapi / realtime as distinct systems |
| Default cluster view: cluster within each system | Admin's clusters distinct from Web's clusters |
| Inspector: System view kind (click a system node → see its files + dependencies + drift) | Plans can target whole systems |
| Plan tasks gain `affectedSystems[]` (alongside `affectedFiles[]`) | Drift attribution by system |
| Mode chrome shows "scoped to system X" when drilled into one | Clarity at a glance |

**Acceptance:** opening a multi-system repo, the canvas defaults to a
view where each system is a top-level node and clusters live inside.

### Phase 5 — Cross-system non-import links (later, 2–3 days each)

Goal: see how systems actually talk to each other, not just imports.

- HTTP route detection (FastAPI, Express, fetch URLs)
- SQL table reference detection + migration parser
- Env var / secret tracking
- Subprocess detection
- OpenAPI contract linking

**Acceptance:** can ask "what backend route does the booking page
call?" and see the edge on the graph.

### Phase 6 — Shared lib expansion (later)

- Mark specific `node_modules` packages as "interesting" → ingest
  their source as a virtual system
- `.gitmodules` awareness — submodules become sub-systems
- Symlink-following for hand-linked shared dirs

---

## Acceptance criteria summary

After Phase 1: every detectable system in swf appears as known;
admin's edges to @swf packages resolve.

After Phase 2: backend/fastapi shows internal Python edges.

After Phase 3: agents can ask "what systems exist" and "what's in this
system" via MCP.

After Phase 4: the UI defaults to system-grouped clusters; plans can
target a system.

After Phase 5: frontend ↔ backend ↔ database all link on one graph.

---

## Implementation notes

### File layout (target after Phase 3)

```
src/backend/services/
  system-discovery.ts     ← walk repo, find every manifest, return DiscoveredSystem[]
  alias-map.ts            ← turn discovered systems + tsconfig paths into a resolver-ready map
  systems-service.ts      ← (Phase 3) DB-backed CRUD over systems
  ast-parser.ts           ← per-language extractors (existing; extend with import variants)
  database.ts             ← resolveImports takes (aliasMap, importerSystem)
  language-resolvers/     ← (Phase 2) one resolver per language
    typescript.ts
    python.ts
    rust.ts
    php.ts
    java.ts
    go.ts
```

### Backward compatibility

`monorepo-detector.ts` and its `MonorepoConfig` stay for now. The new
system model is additive — system discovery runs alongside the
existing npm-only detector. Eventually the npm detector becomes a
specialization of the generic one and can be removed.

### Performance

Each phase adds a per-file pass at scan time. For large repos this
needs the deferred Worker pool. Track perf as we go; if a single-pass
ingest of swf gets > 2s, we move parsing to workers (Phase 6 of the
overall TRACKER plan).

### Testing

For each language we add:
- A small fixture project with known imports
- An e2e test that opens the fixture and checks the dependency edge count
- A unit test for the resolver

For the alias-map fix specifically:
- Open swf
- Assert `apps/admin` has > 0 edges to `packages/ui`
- Assert `backend/fastapi/app/main.py` is included in the file list
