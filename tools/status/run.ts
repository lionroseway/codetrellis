/**
 * Phase 32 — write the LOG's Now and Checklist from the status file and git.
 *
 *   npm run status         # read git (and GitHub when it answers), rewrite the block
 *   npm run status:check   # exit 1 if the block is behind what git says now
 *
 * Needs the integration branch's history (`git fetch origin feat/phase-32`).
 * See `status.ts` for what is written and what is read.
 */

import fs from 'node:fs';
import path from 'node:path';
import { allIds, applyToLog, loadStatus } from './status';
import { readFacts } from './git-facts';

async function main(): Promise<void> {
  const root = path.resolve(__dirname, '..', '..');
  const docs = path.join(root, 'docs');
  const logPath = path.join(docs, 'PHASE-32-LOG.md');
  const status = loadStatus(fs.readFileSync(path.join(docs, 'PHASE-32-STATUS.yaml'), 'utf8'));
  const facts = await readFacts(root, allIds(status), { github: !process.argv.includes('--offline') });
  const log = fs.readFileSync(logPath, 'utf8');
  const next = applyToLog(log, status, facts);

  if (process.argv.includes('--check')) {
    if (next !== log) {
      console.error(`docs/PHASE-32-LOG.md is behind git (${facts.base} ${facts.baseSha}): run \`npm run status\` and commit it`);
      process.exit(1);
    }
    console.log(`docs/PHASE-32-LOG.md matches the YAML and git (${facts.base} ${facts.baseSha})`);
  } else if (next !== log) {
    fs.writeFileSync(logPath, next);
    console.log(`Wrote the status block in docs/PHASE-32-LOG.md (${facts.base} ${facts.baseSha}, ${facts.source})`);
  } else {
    console.log('docs/PHASE-32-LOG.md already matches');
  }
}

void main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
