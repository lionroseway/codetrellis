// Makes every capture a composition uses, from captures.json: the one command
// a fresh machine needs before rendering.
//
//   node capture/all.mjs hero            # the missing ones
//   node capture/all.mjs hero --force    # all of them again
//   node capture/all.mjs clips           # what the site's short loops use
//
// Captures run one at a time (each starts its own app on the same ports).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const [name, ...flags] = process.argv.slice(2);
if (!name) { console.error('usage: node capture/all.mjs <composition> [--force]'); process.exit(2); }
const force = flags.includes('--force');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'captures.json'), 'utf8'));
// `clips` is the site's short loops (clips/site.json); anything else is a composition.
const needed = name === 'clips'
  ? (() => { const c = JSON.parse(fs.readFileSync(path.join(root, 'clips', 'site.json'), 'utf8')); return [...new Set([...c.clips, ...(c.transcripts ?? [])].map((x) => x.src))]; })()
  : [...new Set(Object.entries(JSON.parse(fs.readFileSync(path.join(root, 'compositions', name, 'media.json'), 'utf8')))
    .filter(([k]) => !k.startsWith('_'))
    .map(([, spec]) => (spec.from ?? spec.still).split('/')[1]))];

const run = (cmd, args) => {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) { console.error(`${cmd} ${args.join(' ')} exited ${r.status}`); process.exit(r.status ?? 1); }
};

for (const cap of needed) {
  const how = manifest[cap];
  if (!how) { console.error(`captures.json has no entry for ${cap}: add how it is made`); process.exit(1); }
  const done = fs.existsSync(path.join(root, 'captures', cap, how.ci ? 'transcript.json' : 'raw.mp4'));
  if (done && !force) { console.log(`${cap}: have it`); continue; }
  if (how.group) run('bash', ['capture/demo.sh', cap, `--group=${how.group}`, `--mode=${how.mode}`, `--pace=${how.pace}`, ...(how.grant ? [`--grant=${how.grant}`] : [])]);
  else if (how.phone) run('bash', ['capture/phone.sh', how.phone]);
  else if (how.ci) run('node', ['capture/ci.cjs', `--out=${path.join(root, 'captures', cap)}`]);
}
console.log(name === 'clips'
  ? '\nEvery capture the site loops use is in captures/. Next: npm run render:clips.'
  : `\nEvery capture ${name} uses is in captures/. Next: npm run render ${name}, then npm run review ${name}.`);
