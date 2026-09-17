# Phase 21 — SQL schema + ref-tracker

> Drafted: 2026-09-17
> Status: **built** 2026-09-17. This doc has been reconciled with what
> actually shipped — three design calls changed during implementation and
> are marked **[changed]** below, with the reason. A design doc that still
> describes the plan rather than the result is worse than none.
> Depends on: [Phase 20](PHASE-20-GO-SUPPORT.md) only for the Go half of
> the extractor set. The TS/Python/Java/PHP halves can ship first.
> Referred to in TRACKER §3 as Phase 11 sub-phase 2.G.

---

## 1. SQL is not a seventh language

The instinct is to write `parsers/sql.ts` and give SQL a resolver
alongside every other language. That is wrong, and it is worth saying
why in a doc so nobody re-proposes it in six months.

**[changed]** `sql` *was* added to the `SupportedLanguage` union, which
this doc originally argued against. The argument was right about the
substance and wrong about the mechanics: a `.sql` file still produces
symbols, and every symbol is stored against a language tag, so it needs
one. What SQL does not get — and the real content of the rule — is a
parser plugin, a grammar, a resolver, or an entry in `parsers/index.ts`.
It is handled ahead of the tree-sitter dispatch in `parseSource`, by
`services/sql/`. The union entry carries a comment saying exactly that.

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

### Grammar, parser, or regex? **[changed]** — a tokenizer

This doc originally recommended regex. Implementation used a small
**tokenizer** (`services/sql/tokenizer.ts`) instead, and it is worth
recording why, because the reasoning also settles the library question.

Three candidates were measured against real inputs before choosing:

| | sqlglot (Python) | sql-parser-cst (JS) | tokenizer |
|---|---|---|---|
| DDL across dialects | excellent, 20+ | good, 5 | good for the DDL we read |
| `WHERE id = ?` / `$1` | yes | yes, with `paramTypes` | yes |
| `VALUES (%s, %s)` | yes | **no** | yes |
| `WHERE id = ${id}` | yes | **no** | yes |
| truncated fragment | yes | **no** | yes |
| CTE alias excluded | yes | needs a custom visitor | yes |
| `FROM` inside a comment / string | yes | yes | yes |
| Runtime cost | **a Python runtime in Electron** | ~7 MB | none |

**sqlglot is the best SQL library of the three** and got all nine hard
extraction cases right on the first try. It is Python, and using it would
mean shipping a Python runtime inside an Electron app across five
platform targets — against a codebase whose packaging is already scarred
by exactly one native dependency. That cost is not repayable by a
table-name extractor. If CodeTrellis ever grows a server-side or CI
component, sqlglot is the right choice there and this decision should be
revisited.

`sql-parser-cst` is pure JS and handles DDL well, but it is a *parser*,
and embedded SQL is usually not a parseable statement. It rejected three
of the seven fragment forms that appear in ordinary application code.

The tokenizer wins because **the hard cases are lexical, not
grammatical**. Comments, string literals and quoted identifiers are
tokenizer concerns; CTE aliases are keyword-tracking. None of them needs
a grammar — and not having one is precisely what makes fragments,
placeholders and interpolation harmless, since there is no grammar left
to violate.

The extractor stays isolated behind `services/sql/`, so swapping in a
parser later touches no callers.

## 3. Piece B — the ref-tracker

### Extraction **[changed]** — one scanner, not five extractors

The plan was per-language `sql_query` extraction in each
`callsites/<lang>.ts`. Implementation inverted it: a single scanner
(`services/sql/embedded.ts`) called once from `parseSource`, for every
language.

The per-language extractors exist because HTTP routing genuinely differs
per framework. SQL does not — it is the same language everywhere, and the
only thing that varies by host language is **how a string literal is
written**. So the scanner handles the quoting styles (double, single,
backtick, and the triple-quoted forms used by Python and Java text
blocks) and hands anything SQL-shaped to the shared tokenizer.

The payoff: Rust, PHP and Java get table references with no per-language
work, and a sixth language gets them for free. Verified per language in
`services/sql/embedded.test.ts` — Go raw strings, Python triple-quotes,
TS template literals, Java text blocks, PHP single quotes.

The gate for "is this string SQL" is `looksLikeSql`, and it is
structural rather than a prefix regex, because a naive `INSERT\s+INTO`
matches the prose *"insert into the form"* and `DELETE\s+FROM` matches
*"delete from the list of users"*. Both appear in the test suite as
strings that must produce nothing. A false positive here becomes a
fabricated dependency on an architecture graph, and people act on those.

The snippet is stored in `Callsite.sqlText` — the field was already
reserved.

### Matching

Table names come from the tokenizer, lower-cased and stripped of schema
qualifiers and quoting. The defining side is a **symbol**, not another
callsite: the table as declared by a `CREATE` in some `.sql` file. On a
hit, a cross-system edge (`protocol: 'sql'`) is written from the code
file to the schema file, labelled `READ orders` / `WRITE orders`.

Three rules keep it honest, and all three are "emit nothing" rules:

- **An unknown table produces no edge.** If nothing in the repo CREATEs
  it, we do not know where it lives. This is also what stops ORM-managed
  and external tables from inventing couplings.
- **Ambiguity produces no edge.** Two files defining the same table name
  means we cannot say which one a query meant.
- **A file referencing its own table is not an edge** — a view selecting
  from a table declared beside it is internal structure.

Column mapping is documented at the source (`services/sql/index.ts`) and
in `db-schema.ts`: the `callsites` columns are generic "what was
referenced" slots, so `url_pattern` carries the table name and `method`
carries READ/WRITE. That reuses `idx_callsites_url` — exactly the lookup
the matcher needs — and avoids a migration on a self-healing table.

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
