// What can be checked about a mix without listening to it. Exits 1 on an
// error, so a script (or an agent) can stop on it; warnings are printed and
// let through.
//
// On the spec (mix.mjs's format):
//   - every clip says where it came from (`source`), and one from the
//     library is listed there with an allowed licence and is fetched;
//   - every clip's file exists, starts at or after 0 and ends inside the video;
//   - clips on an `exclusive` track (a voice) do not overlap;
//   - every clip a window lists sits inside that window (a line inside its
//     beat), and warns when one ends with almost no room left.
// On the rendered file (--rendered):
//   - it is as long as the spec says;
//   - integrated loudness is within 1 LU of the target, and the true peak is
//     under its ceiling.
//
// It cannot tell whether a line was said right, or whether the picture shows
// what the voice says: that is the review (npm run review <name> -- --audio).
//
// Usage: node audio/check.mjs <spec.json> [--rendered <audio>]
import fs from 'node:fs';
import path from 'node:path';
import { duration, ff } from './wav.mjs';
import { usable } from './library.mjs';

const TOL = 0.05;

export function checkSpec(spec, base) {
  const errors = [];
  const warnings = [];
  const where = new Map();
  for (const track of spec.tracks ?? []) {
    const spans = [];
    for (const clip of track.clips ?? []) {
      const name = `${track.name}/${clip.id ?? path.basename(clip.file)}`;
      // Where it came from decides whether it may be published.
      if (!clip.source) warnings.push(`${name} does not say where it came from (source): its licence cannot be checked`);
      else if (clip.source.startsWith('library:')) { const why = usable(clip.source.slice(8)); if (why) errors.push(`${name}: ${why}`); }
      else if (!/^(tts|synth):|^file$/.test(clip.source)) errors.push(`${name}: unknown source "${clip.source}" (library:<id>, tts:<engine>, synth:<sound> or file)`);
      const file = path.resolve(base, clip.file);
      if (!fs.existsSync(file)) { errors.push(`${name}: ${clip.file} is missing`); continue; }
      const len = clip.loop ? spec.duration - (clip.at ?? 0) : duration(file);
      const span = { name, start: clip.at ?? 0, end: (clip.at ?? 0) + len };
      if (span.start < 0) errors.push(`${name} starts before the video (${span.start.toFixed(2)} s)`);
      if (span.end > spec.duration + TOL) errors.push(`${name} runs ${(span.end - spec.duration).toFixed(2)} s past the end of the video`);
      spans.push(span);
      if (clip.id) where.set(clip.id, span);
    }
    if (track.exclusive) {
      spans.sort((a, b) => a.start - b.start);
      for (let i = 1; i < spans.length; i++) {
        const over = spans[i - 1].end - spans[i].start;
        if (over > TOL) errors.push(`${spans[i - 1].name} and ${spans[i].name} overlap by ${over.toFixed(2)} s on ${track.name}, which is one voice at a time`);
      }
    }
  }
  for (const w of spec.windows ?? []) {
    for (const id of w.clips ?? []) {
      const s = where.get(id);
      if (!s) { errors.push(`window ${w.id} lists ${id}, which no track has`); continue; }
      if (s.start < w.start - TOL) errors.push(`${s.name} starts ${(w.start - s.start).toFixed(2)} s before its window ${w.id}`);
      if (s.end > w.end + TOL) errors.push(`${s.name} ends ${(s.end - w.end).toFixed(2)} s after its window ${w.id} (${w.start.toFixed(1)}–${w.end.toFixed(1)} s)`);
      else if (w.end - s.end < 0.25) warnings.push(`${s.name} ends ${(w.end - s.end).toFixed(2)} s before its window ${w.id} closes: no breath before the next`);
    }
  }
  return { errors, warnings };
}

export function checkRendered(spec, file) {
  const errors = [];
  const warnings = [];
  const d = duration(file);
  if (Math.abs(d - spec.duration) > TOL) errors.push(`the rendered audio is ${d.toFixed(2)} s; the spec says ${spec.duration} s`);
  const out = ff(['-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const summary = out.slice(out.lastIndexOf('Summary:'));
  const I = Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]);
  const peak = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1]);
  const { target = -16, truePeak = -1.5 } = spec.loudness ?? {};
  if (!Number.isFinite(I)) errors.push('could not measure loudness');
  else if (Math.abs(I - target) > 1) errors.push(`integrated loudness is ${I} LUFS; the target is ${target}`);
  if (Number.isFinite(peak) && peak > truePeak + 0.5) errors.push(`true peak is ${peak} dBTP, over the ${truePeak} ceiling: it will clip on some players`);
  return { errors, warnings, measured: { duration: d, loudness: I, truePeak: peak } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const a = process.argv.slice(2);
  const specFile = a[0];
  if (!specFile) { console.error('usage: node audio/check.mjs <spec.json> [--rendered <audio>]'); process.exit(2); }
  const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
  const r = checkSpec(spec, path.dirname(path.resolve(specFile)));
  const ri = a.indexOf('--rendered');
  if (ri >= 0) {
    const m = checkRendered(spec, a[ri + 1]);
    r.errors.push(...m.errors); r.warnings.push(...m.warnings);
    console.log(`rendered: ${m.measured.duration} s, ${m.measured.loudness} LUFS, peak ${m.measured.truePeak} dBTP`);
  }
  for (const w of r.warnings) console.log(`warn  ${w}`);
  for (const e of r.errors) console.log(`ERROR ${e}`);
  const clips = (spec.tracks ?? []).reduce((n, t) => n + (t.clips?.length ?? 0), 0);
  console.log(r.errors.length ? `audio check: ${r.errors.length} error(s)` : `audio check: ${clips} clips, ${(spec.windows ?? []).length} windows, ok${r.warnings.length ? ` (${r.warnings.length} warning(s))` : ''}`);
  process.exit(r.errors.length ? 1 : 0);
}
