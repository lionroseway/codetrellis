/**
 * Shared types between the web frontend and the Python API.
 * Kept simple on purpose — these mirror the Pydantic models in
 * `services/api/app/models.py`.
 */

export interface User {
  id: number;
  email: string;
  name: string;
  createdAt: string; // ISO 8601
}

export interface Order {
  id: number;
  userId: number;
  amount: number;
  status: OrderStatus;
  createdAt: string;
}

export type OrderStatus = 'pending' | 'paid' | 'cancelled';

export interface CreateUserPayload {
  email: string;
  name: string;
}

export interface CreateOrderPayload {
  userId: number;
  amount: number;
}
