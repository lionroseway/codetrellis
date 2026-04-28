"""Pydantic models — mirror @sample/shared types on the TS side."""

from enum import Enum
from pydantic import BaseModel


class OrderStatus(str, Enum):
    PENDING = "pending"
    PAID = "paid"
    CANCELLED = "cancelled"


class User(BaseModel):
    id: int
    email: str
    name: str
    created_at: str


class Order(BaseModel):
    id: int
    user_id: int
    amount: float
    status: OrderStatus
    created_at: str


class CreateUserPayload(BaseModel):
    email: str
    name: str


class CreateOrderPayload(BaseModel):
    user_id: int
    amount: float
