"""FastAPI entry point for the sample service.

Mounts the users + orders routers under `/api`. The harness's
cross-system matcher pairs each route here with a `fetch(...)` in
`packages/web/src/api.ts`.
"""

from fastapi import FastAPI
from app.routes import users, orders

# Routes carry the full `/api/...` path on the decorator (rather than
# being mounted under `prefix="/api"`) so the cross-system matcher
# MVP — which does literal path-string comparison — can pair them
# with the corresponding `fetch('/api/users')` calls in the web
# package.
app = FastAPI(title="sample-api")
app.include_router(users.router)
app.include_router(orders.router)


@app.get("/healthz")
def health() -> dict[str, str]:
    return {"status": "ok"}
