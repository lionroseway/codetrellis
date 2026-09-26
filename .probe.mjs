import chokidar from 'chokidar';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-'));
const plans = path.join(root, 'plans'); fs.mkdirSync(plans);
const w = chokidar.watch(plans, { ignoreInitial: true, persistent: true, awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 }, depth: 10 });
const seen = new Set();
w.on('all', (ev, p) => { if (ev === 'add' || ev === 'change') seen.add(p); });
await new Promise((r) => w.on('ready', r));
const N = Number(process.argv[2] || 60);
let missed = 0;
for (let i = 0; i < N; i++) {
  const dir = path.join(plans, `plan-${i}`);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'plan.yaml'), 'uid: x\n');
  await new Promise((r) => setTimeout(r, 50));
  // Our own first channel export creates channels/ (as exportChannelEvent does)...
  const ch = path.join(dir, 'channels'); fs.mkdirSync(ch, { recursive: true });
  fs.writeFileSync(path.join(ch, 'own.yaml'), 'a: 1\n');
  // ...then a few ms later a teammate's file arrives.
  await new Promise((r) => setTimeout(r, Number(process.argv[3] || 20)));
  const ext = path.join(ch, 'external.yaml');
  fs.writeFileSync(ext, 'b: 2\n');
  const start = Date.now();
  while (!seen.has(ext) && Date.now() - start < 3000) await new Promise((r) => setTimeout(r, 25));
  if (!seen.has(ext)) missed++;
}
console.log(`missed ${missed} of ${N}`);
await w.close();
