import type { CreateUserPayload, CreateOrderPayload } from './types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}

export function validateCreateUser(payload: CreateUserPayload): string[] {
  const errors: string[] = [];
  if (!payload.email || !isValidEmail(payload.email)) errors.push('email is invalid');
  if (!payload.name || payload.name.trim().length === 0) errors.push('name is required');
  return errors;
}

export function validateCreateOrder(payload: CreateOrderPayload): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(payload.userId) || payload.userId <= 0) errors.push('userId must be a positive number');
  if (!Number.isFinite(payload.amount) || payload.amount <= 0) errors.push('amount must be a positive number');
  return errors;
}
