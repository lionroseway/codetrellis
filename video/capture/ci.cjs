// Records a real conformity-gate run for the "CI fails on architecture drift"
// beat: a throwaway copy of the sample app with the team's architecture rule
// committed, a branch whose change imports across it, `codetrellis check`
// failing (exit 3) and naming why, then the fix and the same check passing.
//
// Nothing is drawn: every line a composition shows comes from what the CLI
// printed, with the time it printed it, in captures/<name>/transcript.json.
//
// Usage: node ci.cjs [--out=../captures/ci-gate]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { flags } = require('./chromium.cjs');

const f = flags(process.argv.slice(2));
const OUT = path.resolve(f.out ?? path.join(__dirname, '..', 'captures', 'ci-gate'));
const REPO = path.resolve(__dirname, '..', '..');
const BIN = path.join(REPO, 'bin', 'codetrellis.mjs');

const RULE = {
  id: 'routes-not-config',
  from: 'services/api/app/routes/',
  mayNotImport: 'services/api/app/config.py',
  because: 'routes read settings through the app',
};
const USERS = 'services/api/app/routes/users.py';

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ci-'));
const root = path.join(work, 'acme-shop');
const home = path.join(work, 'home');
fs.mkdirSync(home, { recursive: true });
const ENV = {
  ...process.env,
  HOME: home, XDG_CACHE_HOME: path.join(home, '.cache'), CODETRELLIS_DATA_DIR: '',
  CODETRELLIS_CLAUDE_DIR: path.join(home, '.claude'),
  // Clear of a running app or capture.
  CODETRELLIS_BACKEND_PORT: '3191', CODETRELLIS_MCP_PORT: '19591',
  GITHUB_BASE_REF: '', CODETRELLIS_AGENT: '',
  GIT_AUTHOR_NAME: 'Sam Lee', GIT_AUTHOR_EMAIL: 'sam@example.test', GIT_COMMITTER_NAME: 'Sam Lee', GIT_COMMITTER_EMAIL: 'sam@example.test',
};
const git = (...args) => execFileSync('git', ['-C', root, ...args], { env: ENV, stdio: 'pipe' });

const t0 = Date.now();
const transcript = [];
/** Run one command as a person would type it; keep what it printed and when. */
function run(shown, argv, { record = true } = {}) {
  const at = (Date.now() - t0) / 1000;
  const r = spawnSync(argv[0], argv.slice(1), { cwd: root, env: ENV, encoding: 'utf8', timeout: 180_000 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trimEnd();
  if (record) transcript.push({ at: +at.toFixed(2), took: +((Date.now() - t0) / 1000 - at).toFixed(2), command: shown, output: out, exit: r.status });
  return { out, code: r.status };
}

try {
  fs.cpSync(path.join(REPO, 'tests', 'fixtures', 'sample-app'), root, { recursive: true });
  fs.mkdirSync(path.join(root, '.codetrellis'), { recursive: true });
  fs.writeFileSync(path.join(root, '.codetrellis', 'config.json'), JSON.stringify({ rules: [{ ...RULE, since: new Date().toISOString(), by: 'Sam Lee' }] }, null, 2));
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'The shop, and the team\'s architecture rule');

  const node = process.execPath;
  const ct = (...args) => [node, BIN, ...args];
  const started = run('codetrellis start --quiet', ct('start', '--quiet'), { record: false });
  if (started.code !== 0) throw new Error(`codetrellis start failed: ${started.out}`);

  // The branch an agent pushed: the users routes now read the config directly.
  git('checkout', '-qb', 'exports-v2');
  const usersAbs = path.join(root, USERS);
  const before = fs.readFileSync(usersAbs, 'utf8');
  if (!before.includes('from app.db import')) throw new Error(`${USERS} changed under the scene`);
  fs.writeFileSync(usersAbs, before.replace('from app.db import', 'from app.config import DATABASE_URL\nfrom app.db import'));
  git('commit', '-qam', 'Export users with the database URL');

  const failed = run('codetrellis check --base main', ct('check', '--base', 'main'));
  if (failed.code !== 3) throw new Error(`the check should fail with exit 3; it exited ${failed.code}: ${failed.out}`);

  // The fix: the export stays, the setting is read through the app, as the
  // rule says; so the branch still changes the file, and now conforms.
  fs.writeFileSync(usersAbs, before.replace('router = APIRouter()', 'router = APIRouter()  # exports-v2: settings come through the app'));
  git('commit', '-qam', 'Read the database URL through the app');
  const passed = run('codetrellis check --base main', ct('check', '--base', 'main'));
  if (passed.code !== 0) throw new Error(`after the fix the check should pass; it exited ${passed.code}: ${passed.out}`);

  run('codetrellis stop', ct('stop'), { record: false });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'transcript.json'), JSON.stringify({ rule: RULE, branch: 'exports-v2', steps: transcript }, null, 2));
  for (const s of transcript) console.log(`$ ${s.command}\n${s.output}\n[exit ${s.exit}]\n`);
  console.log(`ci: ${path.relative(process.cwd(), path.join(OUT, 'transcript.json'))}`);
} finally {
  spawnSync(process.execPath, [BIN, 'stop'], { cwd: root, env: ENV, stdio: 'ignore' });
  fs.rmSync(work, { recursive: true, force: true });
}
