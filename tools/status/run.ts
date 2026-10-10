/**
 * Write a phase's LOG Now and Checklist from its status file and git.
 *
 *   npm run status                 # the newest phase with a docs/PHASE-<n>-STATUS.yaml
 *   npm run status -- --phase 32   # a named phase
 *   npm run status:check           # exit 1 if the block is behind what git says now
 *   npm run status:page            # also write the progress page (see page.ts)
 *   npm run status:page -- --shots <dir>   # its screens from <dir>, not test-results/ux-audit
 *
 * Needs the integration branch's history (`git fetch origin feat/phase-<n>`).
 * See `status.ts` for what is written and what is read.
 */

import fs from 'node:fs';
import path from 'node:path';
import { allIds, applyToLog, loadStatus, phaseDocs, phaseFrom } from './status';
import { readFacts } from './git-facts';
import { latestEntries, renderPage } from './page';

/** Every phase status file under docs/, in either layout, repository-relative. */
export function statusFiles(root: string): string[] {
  const docs = path.join(root, 'docs');
  const flat = fs.readdirSync(docs).filter((f) => /^PHASE-\d+-STATUS\.yaml$/.test(f)).map((f) => `docs/${f}`);
  const folders = fs.readdirSync(docs).filter((d) => /^phase-\d+$/.test(d) && fs.existsSync(path.join(docs, d, 'STATUS.yaml'))).map((d) => `docs/${d}/STATUS.yaml`);
  return [...flat, ...folders];
}

async function main(): Promise<void> {
  const root = path.resolve(__dirname, '..', '..');
  const all = phaseDocs(statusFiles(root));
  const phase = phaseFrom(process.argv, all.map((d) => d.phase));
  const docs = all.find((d) => d.phase === phase)!;
  const logPath = path.join(root, docs.log);
  const status = loadStatus(fs.readFileSync(path.join(root, docs.status), 'utf8'), docs.status);
  const facts = await readFacts(root, allIds(status), phase, { github: !process.argv.includes('--offline') });
  const log = fs.readFileSync(logPath, 'utf8');
  const next = applyToLog(log, status, facts, docs);

  if (process.argv.includes('--check')) {
    if (next !== log) {
      console.error(`${docs.log} is behind git (${facts.base} ${facts.baseSha}): run \`npm run status\` and commit it`);
      process.exit(1);
    }
    console.log(`${docs.log} matches the YAML and git (${facts.base} ${facts.baseSha})`);
    return;
  }
  if (next !== log) {
    fs.writeFileSync(logPath, next);
    console.log(`Wrote the status block in ${docs.log} (${facts.base} ${facts.baseSha}, ${facts.source})`);
  } else {
    console.log(`${docs.log} already matches`);
  }
  if (process.argv.includes('--page')) {
    const out = path.join(root, 'out', 'status', `phase-${phase}.html`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    // The screens, copied beside the page from where the browser suite wrote them
    // (`--shots <dir>`, else test-results/ux-audit); published with it under shots/.
    const i = process.argv.indexOf('--shots');
    const from = path.resolve(root, i >= 0 ? process.argv[i + 1] : path.join('test-results', 'ux-audit'));
    const shotsDir = path.join(path.dirname(out), 'shots');
    const present = new Set<string>();
    for (const shot of status.shots ?? []) {
      const src = path.join(from, shot.file);
      if (!fs.existsSync(src)) { console.log(`No ${shot.file} in ${path.relative(root, from)}: left off the page (run its browser spec to take it)`); continue; }
      fs.mkdirSync(shotsDir, { recursive: true });
      fs.copyFileSync(src, path.join(shotsDir, shot.file));
      present.add(shot.file);
    }
    fs.writeFileSync(out, renderPage(status, facts, docs, new Date(), present, latestEntries(next, 2)));
    console.log(`Wrote the progress page to ${path.relative(root, out)}${present.size ? ` with ${present.size} screens in ${path.relative(root, shotsDir)}/` : ''}; publish it, and its shots/, to the progress artifact (the phase's EXECUTION §1.1)`);
  }
}

if (require.main === module) void main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
