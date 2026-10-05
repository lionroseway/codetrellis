/**
 * Write a phase's LOG Now and Checklist from its status file and git.
 *
 *   npm run status                 # the newest phase with a docs/PHASE-<n>-STATUS.yaml
 *   npm run status -- --phase 32   # a named phase
 *   npm run status:check           # exit 1 if the block is behind what git says now
 *   npm run status:page            # also write the progress page (see page.ts)
 *
 * Needs the integration branch's history (`git fetch origin feat/phase-<n>`).
 * See `status.ts` for what is written and what is read.
 */

import fs from 'node:fs';
import path from 'node:path';
import { allIds, applyToLog, loadStatus, phaseFrom } from './status';
import { readFacts } from './git-facts';
import { renderPage } from './page';

async function main(): Promise<void> {
  const root = path.resolve(__dirname, '..', '..');
  const docs = path.join(root, 'docs');
  const phase = phaseFrom(process.argv, fs.readdirSync(docs));
  const logName = `docs/PHASE-${phase}-LOG.md`;
  const logPath = path.join(root, logName);
  const status = loadStatus(fs.readFileSync(path.join(docs, `PHASE-${phase}-STATUS.yaml`), 'utf8'), phase);
  const facts = await readFacts(root, allIds(status), phase, { github: !process.argv.includes('--offline') });
  const log = fs.readFileSync(logPath, 'utf8');
  const next = applyToLog(log, status, facts, phase);

  if (process.argv.includes('--check')) {
    if (next !== log) {
      console.error(`${logName} is behind git (${facts.base} ${facts.baseSha}): run \`npm run status\` and commit it`);
      process.exit(1);
    }
    console.log(`${logName} matches the YAML and git (${facts.base} ${facts.baseSha})`);
    return;
  }
  if (next !== log) {
    fs.writeFileSync(logPath, next);
    console.log(`Wrote the status block in ${logName} (${facts.base} ${facts.baseSha}, ${facts.source})`);
  } else {
    console.log(`${logName} already matches`);
  }
  if (process.argv.includes('--page')) {
    const out = path.join(root, 'out', 'status', `phase-${phase}.html`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, renderPage(status, facts, phase, new Date()));
    console.log(`Wrote the progress page to ${path.relative(root, out)}; publish it to the progress artifact (docs/PHASE-${phase}-EXECUTION.md §1)`);
  }
}

void main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
