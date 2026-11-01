/**
 * A check cannot vouch for code nothing read.
 *
 * "This project's imports are not loaded here" has two meanings. Nobody opened
 * the project: a note, exit 0. Or a scan was tried and failed, and then a rule
 * that blocks has to fail the check. The failure is forced in the database, so
 * this holds whatever the next cause is, and goes through what CI runs: `start`,
 * then `check`.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test, expect } from '@playwright/test';

const CLI = path.resolve(__dirname, '../../bin/codetrellis.mjs');
const BLOCKS = `suite: t
rules:
  - id: ledger-only-allowed
    kind: package
    package: gem:acme_ledger
    only: [lib/allowed.rb]
    strength: block
`;
const WARNS = BLOCKS.replace('strength: block', 'strength: warn');
const CANNOT_VOUCH = 'cannot be said to conform';
const FORCED = 'forced for the test';

test.describe('The check when imports cannot be read', () => {
  test.setTimeout(240_000);

  /** A repository with a rule, a clean base, and a change that breaks the rule. */
  const setup = (rules: string) => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-closed-'));
    const root = path.join(base, 'repo');
    const dataDir = path.join(base, 'data');
    fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
    fs.mkdirSync(path.join(root, '.codetrellis/rules'), { recursive: true });
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    git('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(root, 'lib/allowed.rb'), "require 'acme_ledger'\n");
    fs.writeFileSync(path.join(root, '.codetrellis/rules/t.yaml'), rules);
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-qm', 'base');
    fs.writeFileSync(path.join(root, 'lib/added.rb'), "require 'acme_ledger'\n");
    const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args, '--data-dir', dataDir], { cwd: root, encoding: 'utf8' });
    const db = (sql: string) => {
      const d = new DatabaseSync(path.join(dataDir, 'data.db'));
      d.exec(sql);
      d.close();
    };
    // A scan after a restart is incremental, so it only writes, and only fails, if a file changed.
    let edits = 0;
    const breakScans = () => {
      db(`CREATE TRIGGER fail_scan BEFORE INSERT ON files BEGIN SELECT RAISE(ABORT, '${FORCED}'); END;`);
      fs.writeFileSync(path.join(root, 'lib/edited.rb'), `X = ${(edits += 1)}\n`);
    };
    const mendScans = () => db('DROP TRIGGER fail_scan;');
    return { base, root, dataDir, run, breakScans, mendScans };
  };

  test('a scan that failed at start: the check fails and says why, and start says so too', () => {
    const t = setup(BLOCKS);
    try {
      expect(t.run('start', '--quiet').status).toBe(0);
      t.run('stop');
      t.breakScans();

      const started = t.run('start', '--quiet');
      expect(started.status, 'the backend is up, so start succeeds').toBe(0);
      expect(started.stderr).toContain(FORCED);

      const check = t.run('check', '--base', 'HEAD');
      expect(check.stdout).toContain(CANNOT_VOUCH);
      expect(check.stdout).toContain(FORCED);
      expect(check.stdout, 'no rule is said to hold').not.toContain('holds');
      expect(check.stdout).not.toContain('Conforms');
      expect(check.status).toBe(3);

      // Mended and started again, it judges the change as usual.
      t.run('stop');
      t.mendScans();
      expect(t.run('start', '--quiet').stderr).not.toContain(FORCED);
      const after = t.run('check', '--base', 'HEAD');
      expect(after.stdout).toContain('lib/added.rb');
      expect(after.stdout).not.toContain(CANNOT_VOUCH);
      expect(after.status).toBe(3);
    } finally {
      t.run('stop');
      fs.rmSync(t.base, { recursive: true, force: true });
    }
  });

  test('a rescan that failed after a good scan: the old graph is not trusted, and a good rescan clears it', async () => {
    const t = setup(BLOCKS);
    try {
      fs.rmSync(path.join(t.root, 'lib/added.rb'));
      expect(t.run('start', '--quiet').status).toBe(0);
      expect(t.run('check', '--base', 'HEAD').status, 'clean, and read').toBe(0);

      t.breakScans();
      const token = fs.readFileSync(path.join(t.dataDir, 'capability-token'), 'utf8').trim();
      const check = await rescanThenCheck(t, token);
      expect(check.astError).toContain(FORCED);
      expect(check.stdout).toContain(CANNOT_VOUCH);
      expect(check.status).toBe(3);

      t.mendScans();
      const mended = await rescanThenCheck(t, token);
      expect(mended.astError).toBeNull();
      expect(mended.stdout).not.toContain(CANNOT_VOUCH);
      expect(mended.status).toBe(0);
    } finally {
      t.run('stop');
      fs.rmSync(t.base, { recursive: true, force: true });
    }
  });

  test('only rules at warn: it says they were not checked and passes, and --strict fails', () => {
    const t = setup(WARNS);
    try {
      expect(t.run('start', '--quiet').status).toBe(0);
      t.run('stop');
      t.breakScans();
      expect(t.run('start', '--quiet').status).toBe(0);

      const check = t.run('check', '--base', 'HEAD');
      expect(check.stdout).toContain('the rules were not checked');
      expect(check.stdout).toContain(FORCED);
      expect(check.stdout).not.toContain('Conforms');
      expect(check.status).toBe(0);

      expect(t.run('check', '--base', 'HEAD', '--strict').status).toBe(3);
    } finally {
      t.run('stop');
      fs.rmSync(t.base, { recursive: true, force: true });
    }
  });

  test('another project loaded here, with nothing failed: a note and exit 0, and no rule said to hold', async () => {
    const t = setup(BLOCKS);
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-closed-other-'));
    try {
      fs.writeFileSync(path.join(other, 'a.ts'), 'export const a = 1;\n');
      expect(t.run('start', '--quiet').status).toBe(0);
      const token = fs.readFileSync(path.join(t.dataDir, 'capability-token'), 'utf8').trim();
      await scan(t.dataDir, token, other);

      const check = t.run('check', '--base', 'HEAD');
      expect(check.stdout).toContain('The architecture rules were not checked');
      expect(check.stdout).not.toContain(CANNOT_VOUCH);
      expect(check.stdout).not.toContain('holds');
      expect(check.stdout).not.toContain('Conforms');
      expect(check.status).toBe(0);
    } finally {
      t.run('stop');
      fs.rmSync(t.base, { recursive: true, force: true });
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  test('scan, which only scans, exits 1 when it could not', () => {
    const t = setup(BLOCKS);
    try {
      const first = t.run('scan');
      expect(first.status, first.stderr).toBe(0);
      t.breakScans();
      const scanned = t.run('scan');
      expect(scanned.stderr).toContain(FORCED);
      expect(scanned.status).toBe(1);
    } finally {
      fs.rmSync(t.base, { recursive: true, force: true });
    }
  });
});

/** The backend's own address, as the connector reads it. */
function backendOf(dataDir: string): string {
  const log = fs.readFileSync(path.join(dataDir, 'serve.log'), 'utf8');
  const ports = [...log.matchAll(/\[Backend\] Server running on http:\/\/localhost:(\d+)/g)];
  if (!ports.length) throw new Error(`no backend port in serve.log:\n${log.slice(0, 400)}`);
  return `http://127.0.0.1:${ports[ports.length - 1][1]}`;
}

async function scan(dataDir: string, token: string, projectPath: string): Promise<{ astError: string | null }> {
  const res = await fetch(`${backendOf(dataDir)}/api/project/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-codetrellis-token': token },
    body: JSON.stringify({ projectPath }),
  });
  return (await res.json()) as { astError: string | null };
}

async function rescanThenCheck(t: { root: string; dataDir: string; run: (...a: string[]) => { stdout: string; status: number | null } }, token: string) {
  const { astError } = await scan(t.dataDir, token, t.root);
  const check = t.run('check', '--base', 'HEAD');
  return { astError, stdout: check.stdout, status: check.status };
}
