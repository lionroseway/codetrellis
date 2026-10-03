/**
 * M3 "done when" (Phase 32 A3.5, awareness spec §10): five agents' worth of
 * parallel work produces a digest a person can read in under a minute, and
 * marking signals intended keeps them quiet until a side changes shape.
 *
 * Five real worktrees of the sample app, real edits, the running backend:
 * four of them edit one shared file (six overlapping pairs, one of them on
 * the same function), and one changes a function another imports (a
 * contract). The person reads it as the Awareness tab does, through the same
 * digest the agents get.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, type Harness } from '../harness';
import { buildDigest, digestText, DIGEST_MAX_LINES } from '../../src/shared/lib/awareness-digest';
import type { AwarenessSignal } from '../../src/shared/types';

const VALIDATORS = 'packages/shared/src/validators.ts';
const DB = 'services/api/app/db.py';
const ORDERS = 'services/api/app/routes/orders.py';
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

/** Reading at a relaxed 180 words a minute: the digest must fit well inside that. */
const WORD_BUDGET = 150;

test.describe.serial('M3: distilled', () => {
  test.setTimeout(180_000);

  let h: Harness;
  let root: string;
  const trees: Record<string, string> = {};
  const branches = { auth: 'auth-refresh', billing: 'billing-v2', checkout: 'checkout-fix', users: 'users-admin', search: 'email-search' };
  const canon = (p: string) => { try { return fs.realpathSync(p); } catch { return p; } };

  const signals = async () => {
    const res = await h.client.raw('GET', `/api/awareness?fresh=1&project=${encodeURIComponent(root)}`);
    return ((await res.json()) as { signals: AwarenessSignal[] }).signals;
  };
  const label = (r: string) => {
    const hit = Object.entries(trees).find(([, dir]) => canon(dir) === canon(r));
    return hit ? branches[hit[0] as keyof typeof branches] : r;
  };
  const digest = async () => buildDigest(await signals(), label);
  const edit = (name: string, rel: string, from: string, to: string) => {
    const f = path.join(trees[name], rel);
    const was = fs.readFileSync(f, 'utf-8');
    expect(was.includes(from), `${name}: ${rel} contains the text to change`).toBe(true);
    fs.writeFileSync(f, was.replace(from, to));
  };

  test.beforeAll(async () => {
    h = await setupHarness('awareness-m3', { env: { CODETRELLIS_WORKSTREAM_DEBOUNCE_MS: '150' } });
    root = h.fixture.projectPath;
    for (const [name, branch] of Object.entries(branches)) {
      trees[name] = `${root}-${name}`;
      execFileSync('git', ['-C', root, 'worktree', 'add', '-q', trees[name], '-b', branch], { env: ENV });
    }
    await h.client.scanProject(root);

    // Four worktrees in one shared file; two of them in the same function.
    edit('auth', VALIDATORS, 'return EMAIL_RE.test(email);', 'return EMAIL_RE.test(email.trim());');
    edit('search', VALIDATORS, 'return EMAIL_RE.test(email);', 'return EMAIL_RE.test(email.toLowerCase());');
    edit('billing', VALIDATORS, "errors.push('userId must be a positive number');", "errors.push('userId must be positive');");
    edit('users', VALIDATORS, "errors.push('name is required');", "errors.push('a name is required');");
    // And a contract: billing changes a function checkout's routes import.
    edit('billing', DB, 'def add_order(user_id: int, amount: float) -> Order:', 'def add_order(user_id: int, amount: float, currency: str) -> Order:');
    edit('checkout', ORDERS, 'from app.db import add_order, list_orders', 'from app.db import add_order, list_orders  # checkout-fix');
  });

  test.afterAll(async () => {
    for (const dir of Object.values(trees)) {
      try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', dir]); } catch { /* */ }
    }
    await h?.teardown();
  });

  test('five workstreams, seven overlaps: a digest of five lines, the two high ones first, read in under a minute', async () => {
    // Six pairs in validators.ts and the contract: seven groups once every watcher has seen its edits.
    await expect.poll(async () => {
      const d = await digest();
      return d.lines.length + d.moreLines;
    }, { timeout: 20_000, intervals: [500] }).toBe(7);

    const d = await digest();
    expect(d.lines).toHaveLength(DIGEST_MAX_LINES);
    expect(d.moreLines).toBe(2);
    expect(d.lines.slice(0, 2).map((l) => l.severity)).toEqual(['high', 'high']);
    const texts = d.lines.map((l) => l.text);
    expect(texts).toContain("`billing-v2` changed add_order's signature; `checkout-fix` imports it");
    expect(texts.some((t) => /`auth-refresh` and `email-search` both change .*isValidEmail/.test(t))).toBe(true);

    // The paragraph an agent gets and the lines a person reads: every one of
    // them, the question, and the rest counted, inside the budget.
    const text = digestText(d);
    expect(text).toContain('And 2 more overlaps.');
    const words = text.split(/\s+/).length;
    expect(words, text).toBeLessThanOrEqual(WORD_BUDGET);
  });

  test('marked intended, all of it stays quiet through body edits on every side', async () => {
    for (const s of (await signals()).filter((x) => x.state === 'open')) {
      const res = await h.client.raw('POST', `/api/awareness/${s.id}/state?project=${encodeURIComponent(root)}`, { state: 'intended' });
      expect(res.status).toBe(200);
    }
    expect((await digest()).needsYou).toBe(0);

    edit('auth', VALIDATORS, 'return EMAIL_RE.test(email.trim());', 'return EMAIL_RE.test(email.trim().normalize());');
    edit('search', VALIDATORS, 'return EMAIL_RE.test(email.toLowerCase());', 'return EMAIL_RE.test(String(email).toLowerCase());');
    edit('billing', VALIDATORS, "errors.push('userId must be positive');", "errors.push('userId must be > 0');");
    edit('checkout', ORDERS, '  # checkout-fix', '  # checkout-fix, again');
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const d = await digest();
      expect(d.needsYou, JSON.stringify(d.lines)).toBe(0);
    }
    expect(digestText(await digest())).toBe('Nothing overlaps with other work right now.');
  });

  test('one side adds a function to the shared file: only its overlaps come back, saying why', async () => {
    edit('users', VALIDATORS, 'export function validateCreateUser(', 'export function isAdmin(role: string): boolean { return role === \'admin\'; }\n\nexport function validateCreateUser(');
    await expect.poll(async () => (await digest()).lines.length, { timeout: 15_000, intervals: [500] }).toBe(3);

    const d = await digest();
    expect(d.lines.every((l) => l.text.includes('`users-admin`')), JSON.stringify(d.lines)).toBe(true);
    const back = (await signals()).filter((s) => s.state === 'open');
    expect(back.every((s) => s.reopened?.from === 'intended')).toBe(true);
    // The rest are still as the person left them.
    const still = (await signals()).filter((s) => s.state === 'intended');
    expect(still.length).toBeGreaterThanOrEqual(4);
    expect(still.every((s) => !s.workstreams.some((w) => label(w) === 'users-admin'))).toBe(true);
  });
});
