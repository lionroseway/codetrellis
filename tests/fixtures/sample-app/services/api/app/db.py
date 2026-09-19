"""In-memory store for the sample API service.

Real services would talk to Postgres; the fixture stays lightweight
so tests don't need a database.
"""

from datetime import datetime
from typing import Optional
from app.models import User, Order, OrderStatus
from app.config import DATABASE_URL  # noqa: F401 — kept to exercise import resolver

_users: dict[int, User] = {}
_orders: dict[int, Order] = {}
_user_seq = 0
_order_seq = 0


def add_user(email: str, name: str) -> User:
    global _user_seq
    _user_seq += 1
    user = User(
        id=_user_seq,
        email=email,
        name=name,
        created_at=datetime.utcnow().isoformat(),
    )
    _users[user.id] = user
    return user


def list_users() -> list[User]:
    return list(_users.values())


def get_user(user_id: int) -> Optional[User]:
    return _users.get(user_id)


def add_order(user_id: int, amount: float) -> Order:
    global _order_seq
    _order_seq += 1
    order = Order(
        id=_order_seq,
        user_id=user_id,
        amount=amount,
        status=OrderStatus.PENDING,
        created_at=datetime.utcnow().isoformat(),
    )
    _orders[order.id] = order
    return order


def list_orders() -> list[Order]:
    return list(_orders.values())


# --- Raw SQL, used by the Phase 21 ref-tracker fixture --------------------
#
# These are never executed (the fixture store is in-memory); they exist so
# the SQL ref-tracker has realistic embedded queries to find, against the
# tables declared in ../../schema.sql.

LIST_ORDERS_SQL = """
    SELECT o.id, o.amount, o.status
    FROM orders o
    JOIN users u ON u.id = o.user_id
    WHERE u.id = %s
"""

INSERT_USER_SQL = "INSERT INTO users (email, name) VALUES (%s, %s)"


def list_orders_for_user(cursor, user_id: int):
    cursor.execute(LIST_ORDERS_SQL, (user_id,))
    return cursor.fetchall()


def create_user_row(cursor, email: str, name: str):
    # "delete from the list" below is prose, not SQL — the extractor must
    # not treat it as a reference.
    cursor.execute(INSERT_USER_SQL, (email, name))  # delete from the list
    return cursor.lastrowid
