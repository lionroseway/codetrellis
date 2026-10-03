/**
 * The contract signal beyond TS/JS and Python (Phase 32 A2.7), end to end on
 * two worktrees of the sample app: the real parsers' signatures for Go and
 * Kotlin, the project's import graph, and what the person is told.
 *
 *  - Kotlin: `billing-v2` gives ReconcileJob.runCount a parameter;
 *    `checkout-fix` edits Scheduler.kt, which imports ReconcileJob. High.
 *  - Go: `billing-v2` gives (Ledger).Post a parameter; `checkout-fix` edits
 *    main.go, which imports the ledger package. Go imports a package, so it
 *    may use any of it: medium, and marked "possibly".
 *  - A body edit in either raises nothing.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, type Harness } from '../harness';

interface Signal {
  kind: string; severity: string; summary: string;
  subject: { file?: string; symbol?: string; change?: string; signature?: { before: string; after: string }; importers?: string[]; possibly?: boolean };
}

const JOB = 'services/scheduler/src/main/kotlin/com/acme/scheduler/jobs/ReconcileJob.kt';
const SCHEDULER = 'services/scheduler/src/main/kotlin/com/acme/scheduler/Scheduler.kt';
const LEDGER = 'services/billing/internal/ledger/ledger.go';
const MAIN = 'services/billing/main.go';
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

test.describe.serial('Contract signals for Go and Kotlin', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let billing: string;
  let checkout: string;

  const contracts = async () => {
    const res = await h.client.raw('GET', `/api/awareness?fresh=1&project=${encodeURIComponent(root)}`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { signals: Signal[] }).signals.filter((s) => s.kind === 'contract');
  };
  const settle = async (want: number) => {
    for (let i = 0; i < 40; i++) {
      const got = await contracts();
      if (got.length >= want) return got;
      await new Promise((r) => setTimeout(r, 250));
    }
    return contracts();
  };
  const edit = (folder: string, rel: string, from: string, to: string) => {
    const f = path.join(folder, rel);
    const was = fs.readFileSync(f, 'utf-8');
    const now = was.replace(from, to);
    expect(now, `${rel} changed`).not.toBe(was);
    fs.writeFileSync(f, now);
  };
  const reset = (folder: string) => execFileSync('git', ['-C', folder, 'checkout', '-q', '--', '.'], { env: ENV });

  test.beforeAll(async () => {
    h = await setupHarness('awareness-contract-languages', { env: { CODETRELLIS_WORKSTREAM_DEBOUNCE_MS: '150' } });
    root = h.fixture.projectPath;
    billing = `${root}-billing`;
    checkout = `${root}-checkout`;
    for (const [dir, branch] of [[billing, 'billing-v2'], [checkout, 'checkout-fix']]) {
      execFileSync('git', ['-C', root, 'worktree', 'add', '-q', dir, '-b', branch], { env: ENV });
    }
    await h.client.scanProject(root);
  });

  test.afterEach(async () => {
    reset(billing);
    reset(checkout);
    // Let the watcher see the reset before the next test edits again.
    for (let i = 0; i < 40 && (await contracts()).length; i++) await new Promise((r) => setTimeout(r, 250));
  });

  test.afterAll(async () => {
    for (const w of [billing, checkout]) {
      try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', w]); } catch { /* */ }
    }
    await h?.teardown();
  });

  test('Kotlin: a parameter added to a method of a class the other worktree\'s edited file imports is high', async () => {
    edit(billing, JOB, 'fun runCount(): Int = runs', 'fun runCount(since: Long): Int = runs');
    edit(checkout, SCHEDULER, 'import com.acme.scheduler.jobs.ReconcileJob', 'import com.acme.scheduler.jobs.ReconcileJob\n// checkout-fix touches the scheduler');
    const [c] = await settle(1);
    expect(c, 'a contract signal').toBeTruthy();
    expect(c.severity).toBe('high');
    expect(c.subject).toMatchObject({
      file: JOB, symbol: 'ReconcileJob.runCount', change: 'signature',
      signature: { before: '(): Int', after: '(since: Long): Int' },
      importers: [SCHEDULER],
    });
    expect(c.summary).toContain('`billing-v2` changed ReconcileJob.runCount');
  });

  test('Go: a parameter added to an exported method, in a package the other worktree\'s edited file imports, is medium: possibly used', async () => {
    edit(billing, LEDGER, 'Post(amount money.Amount) error', 'Post(amount money.Amount, memo string) error');
    edit(checkout, MAIN, 'const defaultPort = ":8081"', 'const defaultPort = ":8082"');
    const [c] = await settle(1);
    expect(c, 'a contract signal').toBeTruthy();
    expect(c.severity).toBe('medium');
    expect(c.subject).toMatchObject({
      file: LEDGER, symbol: '(Ledger).Post', change: 'signature',
      signature: { before: '(amount money.Amount) error', after: '(amount money.Amount, memo string) error' },
      importers: [MAIN], possibly: true,
    });
  });

  test('a body edit in either raises nothing', async () => {
    edit(billing, JOB, 'fun runCount(): Int = runs', 'fun runCount(): Int = runs + 0');
    edit(billing, LEDGER, 'Post(amount money.Amount) error {', 'Post(amount money.Amount) error {\n\t// billing-v2 was here');
    edit(checkout, SCHEDULER, 'import com.acme.scheduler.jobs.ReconcileJob', 'import com.acme.scheduler.jobs.ReconcileJob\n// still here');
    edit(checkout, MAIN, 'const defaultPort = ":8081"', 'const defaultPort = ":8083"');
    await new Promise((r) => setTimeout(r, 1500));
    expect(await contracts()).toEqual([]);
  });
});
