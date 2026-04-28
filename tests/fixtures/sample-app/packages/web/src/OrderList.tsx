import { useEffect, useState } from 'react';
import type { Order } from '@sample/shared';
import { listOrders, createOrder } from './api';
import { validateCreateOrder } from '@sample/shared';

export function OrderList() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listOrders().then((o) => {
      setOrders(o);
      setLoading(false);
    });
  }, []);

  async function handlePlace(userId: number, amount: number) {
    const errors = validateCreateOrder({ userId, amount });
    if (errors.length) {
      console.warn('validation failed', errors);
      return;
    }
    const created = await createOrder({ userId, amount });
    setOrders((prev) => [...prev, created]);
  }

  if (loading) return <p>Loading orders…</p>;

  return (
    <ul>
      {orders.map((o) => (
        <li key={o.id}>
          #{o.id} — ${o.amount.toFixed(2)} ({o.status})
        </li>
      ))}
    </ul>
  );
}
