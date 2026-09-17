# Phase 21 — SQL schema + ref-tracker

> Drafted: 2026-09-17
> Status: designed, not built
> Depends on: [Phase 20](PHASE-20-GO-SUPPORT.md) only for the Go half of
> the extractor set. The TS/Python/Java/PHP halves can ship first.
> Referred to in TRACKER §3 as Phase 11 sub-phase 2.G.

---

## 1. SQL is not a seventh language

The instinct is to add `sql` to `SupportedLanguage` and write
`parsers/sql.ts`. That is wrong, and it is worth saying why in a doc so
nobody re-proposes it in six months.

Every parser plugin we have answers two questions: *what symbols does
this file define* and *what files does it import*. SQL answers the
first and has no answer to the second — there is no import graph in a
schema. Meanwhile the thing users actually want — "which code touches
the `orders` table" — is not a property of the SQL file at all. It is a
property of the **TypeScript, Python, Go, Java and PHP** files that
mention it.

So this phase is two pieces that ship in order:

| Piece | Shape | Slot |
|---|---|---|
| **A — schema extraction** | `.sql` file → table / view / proc symbols | Light extractor, file+symbol model, no resolver |
| **B — the ref-tracker** | code file → `sql_query` callsites → matched to tables | `callsites/<lang>.ts` + a SQL matcher, exactly the HTTP shape |

B is the valuable half. A exists to give B something to point at.

`project-scanner.ts` already maps `.sql` → `sql` in `LANG_MAP`, and
`Callsite` in `src/shared/types/ast.ts` already reserves an `sqlText`
field with the comment "SQL specifics (later phases)". The groundwork
was laid; this is the later phase.

## 2. Piece A — schema extraction

### Model

A schema file becomes a node like any other file. Its **tables become
its symbols**. This reuses the entire existing file→symbol pipeline —
the Inspector, symbol search, `search_symbols`, the symbol-depth graph
view and `@`-mention picker all work on tables for free, with no new
storage and no new UI.

| SQL construct | `SymbolKind` | modifiers |
|---|---|---|
| `CREATE TABLE x` | `class` | `table` |
| `CREATE VIEW x` | `class` | `view` |
| `CREATE [MATERIALIZED] VIEW` | `class` | `view`, `materialized` |
| `CREATE FUNCTION` / `PROCEDURE` | `function` | `proc` |
| `CREATE INDEX` | skip | noise at architecture altitude |
| `ALTER TABLE x ADD COLUMN` | — | see migrations below |

Columns are deliberately **not** symbols. At the altitude this product
works at, a table is the unit; a 60-column table would swamp the graph
and bury the thing the user came to see.

### Migrations are the hard case

Most repos define schema as an ordered pile of migrations, not one
canonical schema file. `001_create_orders.sql` creates it,
`014_add_status.sql` alters it, `031_drop_orders.sql` may remove it.
Treating each migration file as an independent definer produces
duplicate and zombie tables.

Approach: detect a migrations directory (a directory of `.sql` whose
filenames sort numerically or by timestamp — the convention is near
universal across goose, golang-migrate, Alembic, Flyway, Knex), and
**fold it into one synthetic schema view**: replay `CREATE` / `ALTER` /
`DROP` in filename order, and attribute each surviving table to the
migration that created it. The node the user clicks is the creating
migration; the table's history is the fold.

If detection fails, fall back to per-file symbols. Wrong-but-visible
beats silently empty.

### Grammar or regex?

A tree-sitter SQL grammar exists but dialect coverage is uneven
(Postgres vs MySQL vs SQLite vs T-SQL diverge exactly at DDL). For DDL
specifically, the statements we care about are highly regular and
regex handles them with less risk than a grammar that half-parses a
dialect. **Recommend regex for A**, with the extractor isolated behind
a small module so a grammar can replace it later without touching
callers.

This is a deliberate asymmetry with every other language and should be
called out in the file header, or someone will "fix" it.

## 3. Piece B — the ref-tracker

### Extraction

Add `sql_query` callsites to each language's existing extractor. The
patterns, in rough order of payoff:

| Language | Pattern |
|---|---|
| Go | `db.Query(...)`, `db.Exec(...)`, `sqlx.Select(...)`, raw backtick strings |
| Python | `cursor.execute(...)`, `session.execute(text(...))`, triple-quoted SQL |
| TS/JS | tagged templates (`` sql`...` ``), `knex.raw(...)`, `pool.query(...)` |
| Java | `@Query(...)`, `jdbcTemplate.query(...)`, `PreparedStatement` literals |
| PHP | `$pdo->query(...)`, `->prepare(...)` |

Plus a **language-agnostic fallback**: any string literal in the file
that matches a SQL-shaped prefix (`SELECT ... FROM`, `INSERT INTO`,
`UPDATE ... SET`, `DELETE FROM`, `JOIN`). Cheap, catches the long tail,
and the false-positive rate is low because that shape is distinctive.

Store the matched text in `Callsite.sqlText` — the field is already
there.

### Matching

Parse table names out of `sqlText` — `FROM x`, `JOIN x`, `INTO x`,
`UPDATE x`, `DELETE FROM x` — strip schema qualifiers and quoting,
lowercase, then look the name up in the table symbol index from Piece A.
On a hit, emit a cross-system edge (`protocol: 'sql'`) from the code
file to the schema/migration file, carrying the table name and the
operation (read / write) so the UI can distinguish "reads orders" from
"writes orders".

**Read vs write is the finding that sells this.** "Seven services read
`orders`; two write it" is an architectural fact most teams cannot
answer about their own system, and it falls straight out of the verb.

### ORMs

Out of scope for the first cut, explicitly. Prisma schemas, SQLAlchemy
models, GORM structs and Eloquent models define tables in *code*, so
they need a mapping layer (model class → table name, usually by
convention plus an override annotation). That is a second matcher, and
it should be its own change once raw SQL is proven. Say so in the UI:
better to report "raw SQL only" than to look broken on a Prisma repo.

## 4. What the graph gains

With Phase 20 and this phase landed, a single traversal reads:

```
OrdersPage.tsx  ──http──▶  billing/main.go  ──sql──▶  003_create_orders.sql
   fetch('/api/orders')      r.Get("/api/orders")        table: orders (read)
```

Three languages, three coupling kinds, one path. Nothing else we could
build this quarter changes the product's story that much.

It also makes **blast radius** real: `diff-engine.ts` already computes a
`blastRadius` array, but today it only follows import edges. Once SQL
edges exist, "what breaks if I change this table" becomes answerable,
and that is the question that makes a platform team care.

## 5. Risks

| Risk | Mitigation |
|---|---|
| Dialect drift in DDL regex | Target Postgres/MySQL/SQLite first; keep the extractor isolated; fixture per dialect |
| Dynamic SQL (string-built queries) is invisible | Accept. Capture the literal fragment when there is one; never guess |
| Table-name collisions across schemas | Qualify by schema when present; on ambiguity emit no edge rather than a wrong one |
| Migration fold gets complicated | Cap it: `CREATE`, `ALTER ... RENAME`, `DROP`. Anything else leaves the table as-is |
| A giant migrations directory inflates scan time | Fold once per scan, cache by directory hash |

## 6. Tests

Extend the fixture with a `db/migrations/` directory (4 files including
one `ALTER` and one `DROP`), and add raw queries to the existing Python
service and the Phase 20 Go service.

`tests/e2e/sql-refs.test.ts`:

1. Tables extracted as symbols with the right kinds and modifiers.
2. The migration fold: dropped table absent, altered table present once.
3. `testdata`-style noise and `CREATE INDEX` produce no symbols.
4. Go `db.Query("SELECT ... FROM orders")` yields a read edge to the
   creating migration.
5. Python `cursor.execute("INSERT INTO orders ...")` yields a write edge.
6. A query naming an unknown table yields no edge (no invention).
7. Mutation: adding a query to a Go file yields a new edge within ~1s.

## 7. Done when

- A real repo with migrations shows code→table edges on the graph.
- Read/write direction is visible in the Inspector.
- `sql-refs.test.ts` green, 5 consecutive runs.
- TRACKER §1 cross-system row updated with real counts from a real repo.
