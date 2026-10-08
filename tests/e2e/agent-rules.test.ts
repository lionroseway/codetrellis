/**
 * Phase 33 B5 — the engine, per rule (BUILDING-BLOCKS.md §B5).
 *
 * Some rules only a reader can judge. The team writes one in words: money
 * moves through the ledger, never by writing balances directly. No code
 * checks it, so the check passes a branch that writes a balance, and does not
 * say the rule holds. An agent review gets it in its bundle, marked as the
 * review's alone, and a finding citing it is held to the contract like any:
 * it must quote the change. At warn the review says it and passes; set to
 * block, the same finding fails the run.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { setupHarness, type Harness } from '../harness';
import { REPO_ROOT } from '../harness/paths';

const BIN = path.join(REPO_ROOT, 'bin', 'codetrellis.mjs');
const ENV = { GIT_AUTHOR_NAME: 'Sam Lee', GIT_AUTHOR_EMAIL: 'sam@acme.test', GIT_COMMITTER_NAME: 'Sam Lee', GIT_COMMITTER_EMAIL: 'sam@acme.test' };
const WEB = 'packages/web/src/';
const REFUND = `${WEB}refund.ts`;
const WORDS = 'Code that moves money records it through the ledger, never by writing balances directly.';
const WRITE = '  balances[userId] -= cents;';

interface Bundle { id: string; contract: string; rules: Array<{ rule: string; words: string; strength: string; engine: string }> }
interface Run { id: string; outcome: { ok: boolean; blocks: number; warns: number }; words: string; review: { findings: Array<{ rule: string | null }> } | null }

test.describe.serial('B5: a rule in words reaches the review, is held to the contract, and blocks only at block', () => {
  test.setTimeout(240_000);
  let h: Harness;
  let root: string;
  let main: string;
  let agent: Client;
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env: { ...process.env, ...ENV } }).trim();
  const ct = (...args: string[]) => {
    const r = spawnSync(process.execPath, [BIN, ...args, '--data-dir', h.fixture.dataDir], {
      cwd: root, env: { ...(process.env as Record<string, string>), ...ENV, CLAUDECODE: '1', CODETRELLIS_AGENT: '', FORCE_COLOR: '', GITHUB_BASE_REF: '' }, encoding: 'utf8', timeout: 120_000,
    });
    return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
  };
  const q = () => `project=${encodeURIComponent(root)}`;
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await agent.callTool({ name, arguments: args });
    return { isError: r.isError === true, text: ((r.content ?? []) as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n') };
  };
  const setRule = async (strength: 'warn' | 'block') => {
    const res = await h.client.raw('PUT', `/api/rules/money-through-ledger?${q()}`, { engine: 'agent', rule: WORDS, in: [WEB], strength, because: 'Every movement is audited.', suite: 'money' });
    expect(res.status, await res.clone().text()).toBe(200);
  };
  const review = async (): Promise<Run> => {
    const bundle = JSON.parse((await call('get_review_bundle', { base: main, project_path: root })).text) as Bundle;
    const r = await call('report_review', {
      bundle: bundle.id,
      findings: [
        { kind: 'rule', file: REFUND, start_line: 3, end_line: 3, quote: WRITE.trim(), says: 'The refund writes the balance directly instead of posting to the ledger.', rule: 'money-through-ledger' },
        { kind: 'rule', file: REFUND, start_line: 3, end_line: 3, quote: 'ledger.post(refund)', says: 'Misquoted, so not shown.', rule: 'money-through-ledger' },
      ],
    });
    expect(r.isError, r.text).toBe(false);
    const res = JSON.parse(r.text) as { run: string; kept: unknown[]; dropped: Array<{ why: string }> };
    expect(res.kept).toHaveLength(1);
    expect(res.dropped.map((d) => d.why)).toEqual([`its quote is not what lines 3–3 of ${REFUND} say`]);
    const runs = ((await (await h.client.raw('GET', `/api/check-runs?${q()}`)).json()) as { runs: Run[] }).runs;
    return runs.find((x) => x.id === res.run)!;
  };

  test.beforeAll(async () => {
    h = await setupHarness('agent-rules');
    root = h.fixture.projectPath;
    main = git('rev-parse', '--abbrev-ref', 'HEAD');
    await h.client.scanProject(root);
    await setRule('warn');
    const suite = fs.readFileSync(path.join(root, '.codetrellis', 'rules', 'money.yaml'), 'utf-8');
    expect(suite).toContain('engine: agent');
    expect(suite).toContain('rule: Code that moves money records it through the ledger'); // long words fold onto the next line
    git('add', '.codetrellis');
    git('commit', '-qm', 'Rule: money through the ledger');
    git('checkout', '-qb', 'quick-refund');
    fs.writeFileSync(path.join(root, REFUND), `declare const balances: Record<string, number>;\nexport function refund(userId: string, cents: number) {\n${WRITE}\n}\n`);
    git('add', '-A');
    git('commit', '-qm', 'Quick refund');
    agent = new Client({ name: 'claude-code', version: '0.0.0-test' }, { capabilities: {} });
    await agent.connect(new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', path.join(REPO_ROOT, 'src/backend/mcp/connector/main.ts'), '--data-dir', h.fixture.dataDir],
      cwd: root, stderr: 'pipe',
    }));
  });

  test.afterAll(async () => {
    await agent?.close().catch(() => {});
    await h?.teardown();
  });

  test('no code checks it: the Rules view says who judges it, and the check passes without saying it holds', async () => {
    const rules = ((await (await h.client.raw('GET', `/api/rules?${q()}`)).json()) as { rules: Array<{ rule: { id: string }; words: string; breaches: unknown; breachWords: string }> }).rules;
    const r = rules.find((x) => x.rule.id === 'money-through-ledger')!;
    expect(r.words).toBe(`in ${WEB}: ${WORDS}: Every movement is audited.`);
    expect(r.breaches).toBeNull();
    expect(r.breachWords).toBe('Judged by an agent review, against its words: no code checks it, and with no review it is a guide');
    const c = ct('check', '--base', main, '--json');
    expect(c.code, c.err || c.out).toBe(0);
    const g = JSON.parse(c.out) as { rules: unknown[]; checked?: Array<{ rule: string }> };
    expect(g.rules).toEqual([]);
    expect((g.checked ?? []).map((x) => x.rule)).not.toContain('money-through-ledger');
  });

  test('the bundle carries it as the review\'s alone; a finding citing it must quote the change; at warn the run passes', async () => {
    const bundle = JSON.parse((await call('get_review_bundle', { base: main, project_path: root })).text) as Bundle;
    expect(bundle.rules).toEqual([expect.objectContaining({ rule: 'money-through-ledger', engine: 'agent', strength: 'warn', words: `in ${WEB}: ${WORDS}` })]);
    expect(bundle.contract).toContain('A rule whose `engine` is `agent` is checked by nobody but you');
    const run = await review();
    expect(run.outcome).toEqual(expect.objectContaining({ ok: true, blocks: 0, warns: 1 }));
    expect(run.review?.findings.map((f) => f.rule)).toEqual(['money-through-ledger']);
  });

  test('set to block by its owner, the same finding fails the run', async () => {
    await setRule('block');
    const run = await review();
    expect(run.outcome).toEqual(expect.objectContaining({ ok: false, blocks: 1, warns: 0 }));
    expect(run.words).toContain('1 block');
  });
});
