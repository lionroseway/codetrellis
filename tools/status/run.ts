/**
 * Phase 32 — write the LOG's Now and Checklist from the status file.
 *
 *   npm run status         # rewrite the block in docs/PHASE-32-LOG.md
 *   npm run status:check   # exit 1 if the LOG disagrees with the status file
 *
 * See `status.ts` for why the status is data.
 */

import fs from 'node:fs';
import path from 'node:path';
import { applyToLog, loadStatus } from './status';

const docs = path.resolve(__dirname, '..', '..', 'docs');
const statusPath = path.join(docs, 'PHASE-32-STATUS.yaml');
const logPath = path.join(docs, 'PHASE-32-LOG.md');

const status = loadStatus(fs.readFileSync(statusPath, 'utf8'));
const log = fs.readFileSync(logPath, 'utf8');
const next = applyToLog(log, status);

if (process.argv.includes('--check')) {
  if (next !== log) {
    console.error('docs/PHASE-32-LOG.md is stale: run `npm run status` and commit it');
    process.exit(1);
  }
  console.log('docs/PHASE-32-LOG.md matches docs/PHASE-32-STATUS.yaml');
} else if (next !== log) {
  fs.writeFileSync(logPath, next);
  console.log('Wrote the status block in docs/PHASE-32-LOG.md');
} else {
  console.log('docs/PHASE-32-LOG.md already matches docs/PHASE-32-STATUS.yaml');
}
