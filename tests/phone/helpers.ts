/**
 * Open one phone screen in the preview with the desktop's side given: the
 * live snapshot (`state`) and the answers to its RPC calls (`rpc`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import type { WorkspaceSnapshot } from '../../mobile/lib/types';

export const OUT = path.join('test-results', 'phone');

export interface PhoneSide {
  /** Typed as the phone's own snapshot, so a fixture cannot drift from what the desktop sends. */
  state?: Partial<WorkspaceSnapshot>;
  rpc?: Record<string, unknown>;
}

export async function openScreen(page: Page, screen: string, side: PhoneSide = {}, params?: Record<string, unknown>): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Functions cannot cross into the page as values: a fixture that depends on
  // the params is written as `{ __byParam: key, answers: { value: answer } }`.
  await page.addInitScript((s) => {
    const rpc: Record<string, unknown> = {};
    for (const [m, v] of Object.entries(s.rpc ?? {})) {
      const byParam = v && typeof v === 'object' && '__byParam' in (v as object) ? (v as { __byParam: string; answers: Record<string, unknown> }) : null;
      rpc[m] = byParam ? (p: Record<string, unknown>) => byParam.answers[String(p[byParam.__byParam])] : v;
    }
    (window as unknown as { __PHONE__: unknown }).__PHONE__ = { state: s.state ?? {}, rpc, calls: [] };
  }, side);
  const q = new URLSearchParams({ screen, ...(params ? { params: JSON.stringify(params) } : {}) });
  await page.goto(`/?${q}`);
  await expect(page.locator('#phone[data-ready]')).toBeAttached({ timeout: 15_000 });
  expect(errors, 'the screen rendered without an error').toEqual([]);
}

/** What the screen has sent over RPC so far. */
export async function calls(page: Page): Promise<Array<{ method: string; params: Record<string, unknown> }>> {
  return page.evaluate(() => (window as unknown as { __PHONE__: { calls: Array<{ method: string; params: Record<string, unknown> }> } }).__PHONE__.calls);
}

/** Where the screen asked to go. */
export async function navigations(page: Page): Promise<Array<{ action: string; to?: unknown }>> {
  return page.evaluate(() => (window as unknown as { __PHONE_NAV__?: Array<{ action: string; to?: unknown }> }).__PHONE_NAV__ ?? []);
}

export async function shot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  await page.locator('#phone').screenshot({ path: path.join(OUT, `${name}.png`) });
}
