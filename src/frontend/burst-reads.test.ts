/**
 * A listener for a burst event runs its read one at a time (Phase 32 HD4).
 *
 * The backend broadcasts these on every file change in any watched worktree,
 * so a handler that reads per event starts dozens of reads in a burst. It
 * happened twice in Wave 2 (the awareness store in E1, source control in
 * E2b), each found only when a person's click waited behind the reads. Like
 * `reachable.test.ts` for rendering, this guards what no other test sees:
 * every `addEventListener` for one of these events, anywhere in the window,
 * names a handler made by `singleFlight` in the same file.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname);
/** Broadcast per file change (workstream watcher, signals, the stack). */
const BURST = ['workstreams-changed', 'awareness-changed', 'stack-changed'];

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : files(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

test('each burst event is still bridged from the server to the window', () => {
  const bridge = fs.readFileSync(path.join(ROOT, 'hooks', 'useWebSocket.ts'), 'utf8');
  for (const e of BURST) assert.ok(bridge.includes(`new CustomEvent('${e}'`), `${e} is no longer dispatched by useWebSocket.ts; update BURST`);
});

test('every listener for a burst event is a single-flight read', () => {
  const offenders: string[] = [];
  let found = 0;
  for (const file of files(ROOT)) {
    const src = fs.readFileSync(file, 'utf8');
    const re = /addEventListener\(\s*'([a-z-]+)'\s*,\s*([^)]*?)\s*\)/g;
    for (const m of src.matchAll(re)) {
      if (!BURST.includes(m[1])) continue;
      found++;
      const handler = m[2];
      const rel = path.relative(ROOT, file);
      if (!/^[A-Za-z_$][\w$]*$/.test(handler)) {
        offenders.push(`${rel}: '${m[1]}' has an inline handler; name it and make it with singleFlight`);
        continue;
      }
      const made = new RegExp(`\\b${handler}\\s*=\\s*(?:useMemo\\(\\s*\\(\\)\\s*=>\\s*)?singleFlight\\(`);
      if (!made.test(src)) offenders.push(`${rel}: '${m[1]}' → ${handler}, which singleFlight did not make`);
    }
  }
  assert.ok(found > 0, 'no burst listeners found: the pattern no longer matches the code');
  assert.deepEqual(offenders, [], `Reads started by a burst event must run one at a time (lib/single-flight.ts):\n${offenders.join('\n')}`);
});
