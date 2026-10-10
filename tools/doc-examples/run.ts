/**
 * Phase 33 B7 — run one worked example from the docs (examples.ts reads
 * them): a fresh repository with the example's files on `main`, its change
 * committed on a branch, and its commands run there in order, each with what
 * it printed and how it exited.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import type { DocExample } from './examples';

export interface StepRun { commands: string; code: number | null; out: string; err: string }

const IDENTITY = { GIT_AUTHOR_NAME: 'Sam Lee', GIT_AUTHOR_EMAIL: 'sam@acme.test', GIT_COMMITTER_NAME: 'Sam Lee', GIT_COMMITTER_EMAIL: 'sam@acme.test' };

/** The example's repository, at `dir/<id>`, on its change's branch. */
export function exampleRepo(ex: DocExample, dir: string): string {
  const repo = path.join(dir, ex.id);
  fs.rmSync(repo, { recursive: true, force: true });
  fs.mkdirSync(repo, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { env: { ...process.env, ...IDENTITY }, stdio: 'ignore' });
  const write = (at: 'main' | 'change') => {
    for (const f of ex.files.filter((x) => x.at === at)) {
      fs.mkdirSync(path.dirname(path.join(repo, f.path)), { recursive: true });
      fs.writeFileSync(path.join(repo, f.path), f.text);
    }
  };
  git('init', '-q', '-b', 'main');
  write('main');
  git('add', '-A');
  git('commit', '-q', '--allow-empty', '-m', 'main');
  git('checkout', '-q', '-b', 'change');
  write('change');
  git('add', '-A');
  git('commit', '-q', '-m', 'the change');
  return repo;
}

/** Each of the example's steps, run in `repo` with `env`; `codetrellis stop` after, whatever happened. */
export function runSteps(ex: DocExample, repo: string, env: Record<string, string>): StepRun[] {
  const out: StepRun[] = [];
  try {
    for (const s of ex.steps) {
      const r = spawnSync('sh', ['-c', s.commands], { cwd: repo, env: { ...env, ...IDENTITY }, encoding: 'utf8', timeout: 240_000 });
      out.push({ commands: s.commands, code: r.status, out: r.stdout.trimEnd(), err: r.stderr.trimEnd() });
    }
  } finally {
    spawnSync('sh', ['-c', 'codetrellis stop'], { cwd: repo, env, stdio: 'ignore', timeout: 60_000 });
  }
  return out;
}
