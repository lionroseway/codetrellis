# Phase 28 — Callsite extractors for Ruby, C#, Kotlin and Swift

> Implemented: 2026-09-18.
> Follows [PHASE-27-LANGUAGE-EXPANSION.md](PHASE-27-LANGUAGE-EXPANSION.md),
> which put these four languages in the graph but not on the map.
> Pattern: [PHASE-20-GO-SUPPORT.md](PHASE-20-GO-SUPPORT.md) established
> the shape.

---

## 1. Why this had to follow 27 immediately

Phase 27 gave Ruby, C#, Kotlin and Swift symbols and import edges. It
did not give them **callsites**, and a callsite is what puts a service
on the cross-system map. The result was a specific kind of wrong:

> A .NET service scanned cleanly, drew every file, drew its internal
> imports — and connected to nothing else in the repository. It looked
> like an isolated service. It was an unread one.

That is the same failure this line of work keeps finding: not an error,
just a confident picture with something missing from it. The product
claim is "we map your microservices". For TS, Python and Go that was
true. For the four languages added the week before, it was not.

## 2. What ships

| Language | Inbound (`http_route`) | Outbound (`http_call`) |
|---|---|---|
| C# | ASP.NET controllers (`[Route]` + `[HttpGet]`), minimal APIs (`MapGet`, `MapGroup`, `MapMethods`) | `HttpClient` (`GetAsync`, `PostAsJsonAsync`, …), `HttpRequestMessage`, Refit `[Get("…")]` |
| Kotlin | Spring (`@RequestMapping` class prefix, `@GetMapping`), Ktor (`routing`, nested `route`) | Ktor client, OkHttp `.url(…)`, Retrofit `@GET` |
| Swift | Vapor (`app.get("api", "orders")`, `grouped`, `group`) | `URL(string:)` + `httpMethod`, Alamofire `AF.request` |
| Ruby | Rails router (`resources`, `resource`, `namespace`, `scope`, `member`/`collection`, explicit verbs), Sinatra | `Net::HTTP`, `HTTParty`, `RestClient`, `Faraday` |

SQL needed nothing: `services/sql/embedded.ts` already scans string
literals in **every** language and hands anything SQL-shaped to the
shared tokenizer, so these four languages have had table references
since Phase 21. That design decision paid for itself here.

`subprocess` and `env_lookup` remain unemitted by every extractor,
including the three that predate this phase. The `CallsiteKind` union
declares them; nothing produces them. That is worth either building or
deleting, and it is noted in §6 rather than quietly left.

## 3. The thing each language does that a naive regex gets wrong

Each of these produces a *plausible* graph when handled carelessly,
which is why each has a test named after it.

**C# — `[controller]` is not decoration, it is the path.**
`[Route("api/[controller]")]` on `OrdersController` declares
`/api/orders`. An extractor reporting the literal emits
`/api/[controller]` for **every controller in the project**: twenty real
endpoints collapse into one fake one that pairs with nothing. The token
is expanded from the class name, as the framework does. `[action]` is
expanded from the method name; `[area]` is **not**, because it comes
from folder conventions this extractor cannot see, so it is left intact
rather than guessed at.

**Kotlin — the server and client forms are spelled almost identically.**

```kotlin
get("/api/orders") { … }           // a route this service serves
client.get("http://billing/api")   // a call this service makes
```

No annotation separates them. The rule used is the one that matches how
they are actually written: a **bare** verb call is a route (Ktor's
routing DSL is an extension-function scope, so the server form never has
a receiver), and a verb call **with** a receiver is outbound. This
misreads exactly one shape — a route registered through a captured
`Route` receiver — and the failure there is a missing edge rather than a
wrong one, which is the direction to err in.

**Swift — the verb is on a different line from the URL.**
`URL(string:)` names the endpoint; `request.httpMethod = "POST"` names
the verb, usually two or three lines later, joined by a local variable a
regex cannot resolve. A short forward window is scanned, **bounded by
the next `URL(string:)`** so one request cannot borrow the verb of the
one after it. With no assignment found the call is reported as GET —
not a convenience default: `URLRequest.httpMethod` is literally `"GET"`
until something sets it.

**Ruby — `resources :orders` is five routes, not one.**
Almost no Rails application writes its API verb by verb. An extractor
reading only explicit `get`/`post` lines finds **nothing** in a typical
`config/routes.rb`, and Ruby joins the graph as a service that serves no
endpoints while visibly making calls. `resources` is expanded the way
Rails expands it, honouring `only:` and `except:`; `resource` (singular)
drops `index` and the `:id` segment.

`new` and `edit` are **deliberately not emitted**. They are the HTML
form routes, no API client calls them, and whether Rails generates them
at all depends on `config.api_only` — a setting in a file this extractor
cannot see. Emitting them would add two unmatchable routes per resource
on a guess.

## 4. Normalisation is the matching contract, not a formatting choice

`cross-system-service` pairs an outbound call to an inbound route by
**exact string equality** on `` `${METHOD} ${urlPattern}` ``. There is no
fuzzy fallback — the comment there says false positives erode trust
faster than missed pairs, and that is still the right call. The
consequence is that normalisation is not a per-language convenience:
**two languages that normalise differently never pair.**

They had already drifted before this phase:

- Go collapsed `:userID` to `:id`; Python did not.
- `lineOf` was copied verbatim into three files.
- Nothing forced a leading slash, so a framework that writes routes
  without one (ASP.NET attribute routes, Retrofit paths, Rails
  `get 'orders'`) produced `api/orders` — an endpoint nobody calls
  sitting next to a call nobody serves.

Seven extractors sharing a contract that only works when all seven agree
is the same shape as every bug the last two phases turned up. So
`callsites/shared.ts` now owns it, Go, Python and TypeScript were
migrated onto it, and `phase28.test.ts` asserts that every parameter
spelling — `{id}`, `{user_id}`, `:userID`, `${id}`, `<int:pk>`, `%s` —
collapses to the same string.

### One behaviour change, made deliberately

Go's `isLikelyApiPath` required an absolute URL to contain `/api/`
before reporting it, so `http.Get("https://example.com/status")` was
dropped as noise. That also dropped real internal coupling: a call to
`http://billing/ledger` is exactly the edge this product exists to draw,
and plenty of services do not put `/api/` in their paths.

Absolute URLs are now kept. The cost is bounded — the matcher only
creates an edge when the call pairs with a route found in the *same
scan*, so a call to a genuinely external host stores a callsite and
draws nothing. The Go test that encoded the old rule was updated with
the reasoning rather than deleted.

## 5. Tests

- `callsites/phase28.test.ts` — 30 assertions. Each language's hard case
  above gets a named test; the last suite asserts all seven extractors
  normalise identically and that none emits a callsite the matcher would
  silently drop for want of a method, pattern or line.
- `tests/e2e/callsite-expansion.test.ts` — the fixture now contains a
  chain crossing four languages, **Swift → Kotlin → C# → Python**, plus
  Ruby → Python. Each hop is a different framework with a different way
  of spelling a route; the chain exists only because they all normalise
  to one form. A third test asserts every new language contributes at
  least one edge, because an extractor that is registered but never
  fires looks exactly like no extractor at all.
- `tests/e2e/cross-system.test.ts` — the edge count went 4 → 6 → 12
  across Phases 20 and 28, breaking this suite each time on a number
  that said nothing about the matcher. The mutation tests now compute
  their expected counts **relative to the baseline they just measured**,
  so the next fixture addition does not break them. The baseline test
  still asserts an exact label list, because that is what it is for.

## 6. Still open

- **`subprocess` and `env_lookup`** are in the `CallsiteKind` union and
  emitted by nothing, in any language. Either build them or drop them
  from the type — a declared kind that never appears is the same species
  of claim-without-substance this phase existed to fix.
- **GraphQL and gRPC** are unmodelled. A `.proto` service definition is
  much closer to a SQL schema than to an HTTP route — one file declaring
  contracts that many languages consume — so it probably wants the
  `services/sql/`-shaped treatment rather than seven more extractors.
- **Ruby heredoc SQL.** `find_by_sql(<<~SQL)` is idiomatic Rails and the
  shared literal scanner does not know heredocs, so those queries are
  missed. It is one quoting style in one shared file, and it would
  benefit every language that has heredocs.
- **The exact-match ceiling.** A call to `/api/ledger/42` cannot pair
  with a route declared `/api/ledger/:id`, because 42 is a value and
  `:id` is a pattern. The matcher's own comment reserves this as the
  fallback it deliberately did not build. It is now the single largest
  source of unpaired callsites, and worth revisiting with a
  segment-count-plus-literal-prefix rule rather than a fuzzy one.
