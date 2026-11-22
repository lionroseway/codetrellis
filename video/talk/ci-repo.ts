/**
 * The talk's sample repository as it is pushed to GitHub for demo 03's CI
 * beat: `main` with the rule at block and the conformity workflow, and a
 * branch `prefs-save` whose pull request first breaks the rule, then fixes it.
 *
 * Builds the history locally and prints nothing else; `talk/ci.sh` pushes it.
 * The files are the demos' own (`scripts/demo/fixtures/prefs-api.ts`), so CI
 * checks the code the videos show.
 *
 * Usage: node --import tsx video/talk/ci-repo.ts <dir>   (from the repository root)
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ENDPOINT_BREACH, ENDPOINT_FIXED, PREFS_API_FILES, PREFS_ENDPOINT, PREFS_RULES, PREFS_SERVICE } from '../../scripts/demo/fixtures/prefs-api';

const dir = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) { console.error('usage: ci-repo.ts <dir>'); process.exit(2); }
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, env, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf-8' });
const write = (rel: string, body: string) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); };
const commit = (message: string) => { git('add', '-A'); git('commit', '-qm', message); };

// The whole CI job: install the CLI, start it for this checkout, check the change.
const WORKFLOW = `name: conformity
on: pull_request
jobs:
  conformity:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0 # the base, to judge the change by its rules
      - uses: actions/setup-node@v5
        with:
          node-version: 26
      - name: Install CodeTrellis
        run: npm install -g codetrellis@0.3.1
      - name: Start CodeTrellis
        run: codetrellis start --quiet
      - name: Write the findings to the summary
        run: codetrellis check --base origin/main --format markdown >> "$GITHUB_STEP_SUMMARY" || true
      - name: Conformity
        run: codetrellis check --base origin/main # exit 3 when the change does not conform
      - name: Stop CodeTrellis
        if: always()
        run: codetrellis stop
`;

git('init', '-q', '-b', 'main');
git('config', 'user.email', 'alex@acme.test');
git('config', 'user.name', 'Alex Kim');
for (const [rel, body] of Object.entries(PREFS_API_FILES)) write(rel, body);
write(PREFS_RULES, PREFS_API_FILES[PREFS_RULES].replace('strength: warn', 'strength: block'));
write('.github/workflows/conformity.yml', WORKFLOW);
commit('Customers API: endpoints, services, db');

git('checkout', '-q', '-b', 'prefs-save');
const service = PREFS_API_FILES[PREFS_SERVICE];
write(PREFS_SERVICE, service.replace('  const current = readPreferences(customerId);', "  if (change.language !== undefined && change.language.length !== 2) throw new Error('language is a two-letter code');\n  const current = readPreferences(customerId);"));
commit('Validate the language in savePreferences\n\nagent: claude-code');
write(PREFS_ENDPOINT, ENDPOINT_BREACH);
commit('Add the preferences endpoint\n\nagent: claude-code');
git('tag', 'breach');
write(PREFS_ENDPOINT, ENDPOINT_FIXED);
commit('Save preferences through the service\n\nagent: claude-code');
git('tag', 'fixed');
console.log(dir);
