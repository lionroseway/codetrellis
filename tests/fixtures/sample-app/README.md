# sample-app — CodeTrellis E2E fixture

Mixed-language fixture used by the E2E harness. **Do not edit by hand
during development** — tests reset this directory by re-cloning from
the committed template into a tmp dir per test run.

## Shape

- `packages/shared/` — TS workspace package (`@sample/shared`), exports types
- `packages/web/` — TS workspace package, calls the Python API via `fetch('/api/...')`
- `services/api/` — Python FastAPI service, declares the routes the web package calls
- `schema.sql` — SQL schema, used by the future SQL ref-tracker

## Known assertions

The harness asserts on these counts:

- 2 systems (npm workspace + Python project)
- ≥ 25 source files (excluding READMEs / configs)
- 4 cross-system HTTP edges:
  - `packages/web/src/api.ts → services/api/app/routes/users.py:GET /api/users`
  - `packages/web/src/api.ts → services/api/app/routes/users.py:POST /api/users`
  - `packages/web/src/api.ts → services/api/app/routes/orders.py:GET /api/orders`
  - `packages/web/src/api.ts → services/api/app/routes/orders.py:POST /api/orders`

If you change the file layout or the `fetch` / `@router` calls,
update the numbers here AND in `tests/e2e/smoke.test.ts`.

## License

Same as the parent repo.
