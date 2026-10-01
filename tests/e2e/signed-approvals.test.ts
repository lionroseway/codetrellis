/**
 * Phase 32 C2.5b — approvals as signed statements, across two machines.
 *
 * Dana's team signs commits with SSH keys and keeps an allowed-signers file.
 * She approves "Figures reconcile to the ledger" from her phone. Her machine
 * signs the approval with her git key and writes it into the plan's folder.
 * Priya pulls the plan on her own machine: the approval verifies against the
 * team's allowed signers, so the criterion reads met, by Dana, "verified".
 * A record edited to say Priya approved does not verify, and counts for
 * nothing; nor does one for a criterion reworded since, or one signed by a
 * key the team does not list. On a machine without git signing, an approval
 * stays on that machine and says why.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { setupHarness, pairPhone, type Harness, type Phone } from '../harness';

interface Approval { uid: string; criterionUid: string; signer: string | null; origin: string; state: string; reason: string | null }
interface Criterion { uid: string; text: string; state: string; latestSignoff: { actor: string; actorType: string; channel: string } | null }

const git = (repo: string, ...args: string[]) => String(execFileSync('git', ['-C', repo, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })).trim();
const keygen = (dir: string, name: string) => {
  const key = path.join(dir, name);
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', name, '-f', key]);
  return { key, pub: fs.readFileSync(`${key}.pub`, 'utf-8').trim() };
};

test.describe.serial('Approvals as signed statements', () => {
  test.setTimeout(180_000);
  let dana: Harness;
  let priya: Harness;
  let phone: Phone;
  let keys: string;
  let plan: string;
  let item: string;
  let criterion: string;
  let danaDir: string;
  let priyaDir: string;
  let allowed: string;

  const criteriaOf = async (h: Harness) => (await (await h.client.raw('GET', `/api/items/${item}/criteria`)).json()) as Criterion[];
  const approvalsOf = async (h: Harness) => (await (await h.client.raw('GET', `/api/items/${item}/signed-approvals`)).json()) as Approval[];
  /** Priya pulls: Dana's plan folder lands in her checkout, and she imports it. */
  const pull = async () => {
    fs.rmSync(priyaDir, { recursive: true, force: true });
    fs.cpSync(danaDir, priyaDir, { recursive: true });
    const res = await priya.client.raw('POST', '/api/plans/import', { planDir: priyaDir });
    expect(res.ok, await res.clone().text()).toBe(true);
  };

  test.beforeAll(async () => {
    // The harness turns signing off by default (a developer's own key may prompt); these two sign.
    dana = await setupHarness('signed-approvals-dana', { env: { CODETRELLIS_SIGN_APPROVALS: '1' } });
    priya = await setupHarness('signed-approvals-priya', { env: { CODETRELLIS_SIGN_APPROVALS: '1' } });
    keys = fs.mkdtempSync(path.join(dana.fixture.tmpDir, 'keys-'));
    const d = keygen(keys, 'dana');
    allowed = path.join(keys, 'allowed_signers');
    fs.writeFileSync(allowed, `dana@acme.test ${d.pub}\n`);
    for (const h of [dana, priya]) {
      const repo = h.fixture.projectPath;
      git(repo, 'config', 'gpg.ssh.allowedSignersFile', allowed);
      await h.client.scanProject(repo);
    }
    const repo = dana.fixture.projectPath;
    git(repo, 'config', 'user.email', 'dana@acme.test');
    git(repo, 'config', 'gpg.format', 'ssh');
    git(repo, 'config', 'user.signingkey', d.key);

    plan = (await dana.client.createPlan({ title: 'Q3 board pack', projectPath: repo })).uid;
    item = ((await (await dana.client.raw('POST', `/api/plans/${plan}/items`, { kind: 'action', title: 'Check the figures' })).json()) as { uid: string }).uid;
    const added = await dana.client.raw('POST', `/api/items/${item}/criteria`, { text: 'Figures reconcile to the ledger', kind: 'manual' });
    expect(added.ok, await added.clone().text()).toBe(true);
    criterion = (await criteriaOf(dana)).find((c) => c.text === 'Figures reconcile to the ledger')!.uid;
    danaDir = (await dana.client.exportPlan(plan, repo)).planDir;
    priyaDir = path.join(priya.fixture.projectPath, path.relative(repo, danaDir));
    phone = await pairPhone(dana.client, { alias: 'Dana’s phone' });
  });

  test.afterAll(async () => {
    await phone?.close().catch(() => {});
    await dana?.teardown();
    await priya?.teardown();
  });

  test('Dana approves from her phone: her machine signs it with her git key into the plan\'s folder', async () => {
    const decided = await phone.rpc<{ criterion: Criterion }>('criterion.decide', { criterionUid: criterion, decision: 'approved' });
    expect(decided.criterion.state).toBe('met');
    const [a] = await approvalsOf(dana);
    expect(a).toMatchObject({ criterionUid: criterion, origin: 'here', state: 'signed', signer: 'dana@acme.test' });
    const record = parseYaml(fs.readFileSync(path.join(danaDir, 'approvals', `${a.uid}.yaml`), 'utf-8')) as { statement: string; signature: string };
    expect(JSON.parse(record.statement)).toMatchObject({ criterionUid: criterion, decision: 'approved', signer: 'dana@acme.test' });
    expect(record.signature).toMatch(/^-----BEGIN SSH SIGNATURE-----/);
  });

  test('Priya pulls: the approval verifies against the team\'s allowed signers, and the criterion is met, by Dana', async () => {
    await pull();
    const c = (await criteriaOf(priya)).find((x) => x.uid === criterion)!;
    expect(c.state).toBe('met');
    expect(c.latestSignoff).toMatchObject({ actor: 'dana@acme.test', actorType: 'human', channel: 'file' });
    const [a] = await approvalsOf(priya);
    expect(a).toMatchObject({ origin: 'file', state: 'verified', signer: 'dana@acme.test', reason: null });
  });

  test('a record edited to say Priya approved does not verify, and counts for nothing', async () => {
    const [signed] = await approvalsOf(dana);
    const file = path.join(danaDir, 'approvals', `${signed.uid}.yaml`);
    const forged = path.join(danaDir, 'approvals', 'forged-0000-0000-0000.yaml');
    const doc = parseYaml(fs.readFileSync(file, 'utf-8')) as { statement: string; signature: string };
    const statement = { ...JSON.parse(doc.statement), uid: 'forged-0000-0000-0000', signer: 'priya@acme.test' };
    const canonical = JSON.stringify(Object.fromEntries(Object.keys(statement).sort().map((k) => [k, statement[k]])));
    fs.writeFileSync(forged, stringifyYaml({ ...doc, statement: canonical }));
    fs.appendFileSync(allowed, `priya@acme.test ${keygen(keys, 'priya').pub}\n`);
    await pull();
    const forgedRow = (await approvalsOf(priya)).find((a) => a.uid === 'forged-0000-0000-0000')!;
    expect(forgedRow).toMatchObject({ state: 'unverified', signer: 'priya@acme.test' });
    expect(forgedRow.reason).toMatch(/^the signature does not verify for priya@acme\.test/);
    const c = (await criteriaOf(priya)).find((x) => x.uid === criterion)!;
    expect(c.latestSignoff?.actor).toBe('dana@acme.test');
    fs.rmSync(forged);
  });

  test('a key the team does not list, and a criterion reworded since, do not count', async () => {
    // Signed by a key nobody added to the allowed signers.
    const stranger = keygen(keys, 'stranger');
    git(dana.fixture.projectPath, 'config', 'user.signingkey', stranger.key);
    const second = await dana.client.raw('POST', `/api/items/${item}/criteria`, { text: 'Notes reviewed', kind: 'manual' });
    expect(second.ok).toBe(true);
    const notes = (await criteriaOf(dana)).find((c) => c.text === 'Notes reviewed')!.uid;
    await phone.rpc('criterion.decide', { criterionUid: notes, decision: 'approved' });
    await dana.client.exportPlan(plan, dana.fixture.projectPath);
    await pull();
    const row = (await approvalsOf(priya)).find((a) => a.criterionUid === notes)!;
    expect(row).toMatchObject({ state: 'unverified' });
    expect((await criteriaOf(priya)).find((c) => c.uid === notes)!.state).not.toBe('met');

    // Approved with Dana's own key, then reworded: what she approved is not what the criterion now says.
    git(dana.fixture.projectPath, 'config', 'user.signingkey', path.join(keys, 'dana'));
    const third = await dana.client.raw('POST', `/api/items/${item}/criteria`, { text: 'Totals tie out', kind: 'manual' });
    expect(third.ok).toBe(true);
    const totals = (await criteriaOf(dana)).find((c) => c.text === 'Totals tie out')!.uid;
    await phone.rpc('criterion.decide', { criterionUid: totals, decision: 'approved' });
    expect((await dana.client.raw('PUT', `/api/criteria/${totals}`, { text: 'Totals tie out, including the Nordics' })).ok).toBe(true);
    await dana.client.exportPlan(plan, dana.fixture.projectPath);
    await pull();
    const reworded = (await approvalsOf(priya)).find((a) => a.criterionUid === totals)!;
    expect(reworded).toMatchObject({ state: 'unverified', signer: 'dana@acme.test', reason: 'the criterion has been reworded since it was approved' });
    expect((await criteriaOf(priya)).find((c) => c.uid === totals)!.state).not.toBe('met');
  });

  test('without git signing, an approval stays on the machine and says why', async () => {
    const repo = dana.fixture.projectPath;
    // Set here rather than unset, so a machine-wide git signing setup cannot stand in for it.
    git(repo, 'config', 'gpg.format', 'openpgp');
    const third = await dana.client.raw('POST', `/api/items/${item}/criteria`, { text: 'Sign-off from finance', kind: 'manual' });
    expect(third.ok).toBe(true);
    const fin = (await criteriaOf(dana)).find((c) => c.text === 'Sign-off from finance')!.uid;
    await phone.rpc('criterion.decide', { criterionUid: fin, decision: 'approved' });
    const row = (await approvalsOf(dana)).find((a) => a.criterionUid === fin)!;
    expect(row).toMatchObject({ origin: 'here', state: 'local' });
    expect(row.reason).toBe('git signing is not set up with an SSH key (gpg.format ssh), so the approval stays on this machine');
    expect(fs.existsSync(path.join(danaDir, 'approvals', `${row.uid}.yaml`))).toBe(false);
  });

  test('a plain HTTP approval is not signed: it may not be the person', async () => {
    git(dana.fixture.projectPath, 'config', 'gpg.format', 'ssh');
    const fourth = await dana.client.raw('POST', `/api/items/${item}/criteria`, { text: 'Board notified', kind: 'manual' });
    expect(fourth.ok).toBe(true);
    const board = (await criteriaOf(dana)).find((c) => c.text === 'Board notified')!.uid;
    expect((await dana.client.raw('POST', `/api/criteria/${board}/decide`, { decision: 'approved' })).ok).toBe(true);
    expect((await approvalsOf(dana)).find((a) => a.criterionUid === board)).toBeUndefined();
  });
});
