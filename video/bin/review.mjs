// Photographs every beat of a composition at the moment it should show its
// claim (60% of the way in), into out/<name>-review/, with a list of what each
// beat says beside it. Run after a render or a re-recording, and look: a beat
// whose picture does not show its words is cut wrong.
//
// Usage: node bin/review.mjs <composition> [--audio]   (compositions with a build.mjs)
//   --audio: the narrated cut (beats stretched to hold their speech), into
//   out/<name>-narrated-review/, with each beat's spoken line in beats.txt.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const name = process.argv[2];
if (!name) { console.error('usage: node bin/review.mjs <composition>'); process.exit(2); }
const dir = path.join(root, 'compositions', name);
if (!fs.existsSync(path.join(dir, 'build.mjs'))) { console.error(`${name} has no build.mjs to time its beats`); process.exit(1); }

execFileSync('node', [path.join(root, 'bin', 'stage.mjs'), name], { stdio: 'inherit' });
const audio = process.argv.includes('--audio');
execFileSync('node', [path.join(dir, 'build.mjs'), ...(audio ? ['--audio'] : [])], { stdio: 'inherit' });
const beats = JSON.parse(fs.readFileSync(path.join(dir, 'timing.json'), 'utf8'));
const out = path.join(root, 'out', `${name}${audio ? '-narrated' : ''}-review`);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const at = beats.map((b) => +(b.at + b.dur * 0.6).toFixed(2));
execFileSync('hyperframes', ['snapshot', dir, '-o', out, '--at', at.join(','), '--no-end'], { stdio: 'inherit' });
const list = beats.map((b, i) => `${String(i).padStart(2, '0')}  ${at[i].toFixed(1).padStart(6)} s  ${b.act.padEnd(6)} ${b.layout.padEnd(8)} ${b.words}${b.media ? `   [${b.media}]` : ''}${audio && b.vo ? `\n                       says: ${b.vo}` : ''}`).join('\n');
fs.writeFileSync(path.join(out, 'beats.txt'), list + '\n');
console.log(`\n${list}\n\nout/${name}${audio ? '-narrated' : ''}-review/: one frame per beat (frame-NN-at-*.png, contact-sheet-*.jpg) and beats.txt. Check each picture shows its words.`);
