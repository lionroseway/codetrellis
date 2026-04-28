"""Order routes — paired with `packages/web/src/api.ts`'s
`fetch('/api/orders')` calls by the harness's cross-system matcher."""

from fastapi import APIRouter
from app.models import Order, CreateOrderPayload
from app.db import add_order, list_orders

router = APIRouter()


@router.get("/api/orders")
def get_orders() -> list[Order]:
    return list_orders()


@router.post("/api/orders")
def post_order(payload: CreateOrderPayload) -> Order:
    return add_order(user_id=payload.user_id, amount=payload.amount)
