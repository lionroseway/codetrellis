"""User routes — paired with `packages/web/src/api.ts`'s
`fetch('/api/users')` calls by the harness's cross-system matcher."""

from fastapi import APIRouter, HTTPException
from app.models import User, CreateUserPayload
from app.db import add_user, list_users, get_user

router = APIRouter()


@router.get("/api/users")
def get_users() -> list[User]:
    return list_users()


@router.post("/api/users")
def post_user(payload: CreateUserPayload) -> User:
    return add_user(email=payload.email, name=payload.name)


@router.get("/api/users/{user_id}")
def get_user_by_id(user_id: int) -> User:
    user = get_user(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="user not found")
    return user
