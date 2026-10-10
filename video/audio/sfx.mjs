// Cues in, a sound-effects track out.
//
// A cue says what happens, not how it sounds: { at, kind, dur, strength }.
// `kind` is the composition's word for it ("move", "push", "reveal", "tap",
// "end"); a sounds map (a composition's mix.json) says which generated sound
// each kind makes and how loud, so the same cues can sound different, or be
// switched off, without touching the composition:
//
//   { "move":   { "sound": "whoosh", "gain": 0 },
//     "reveal": { "sound": "pop", "gain": -10 },
//     "push":   null }                          off
//
// `strength` (0–1) scales a cue against others of its kind: a long glide
// louder than a nudge. A cue with `dur` gets a sound that long (a whoosh as
// long as its move), starting a little before it so it peaks mid-move.
import path from 'node:path';
import { generate, KINDS } from './synth.mjs';

const db = (x) => 20 * Math.log10(Math.max(x, 0.05));

/**
 * The track for `cues`: one clip per cue whose kind has a sound. `dir` is
 * where generated sounds are cached; clip files are relative to `base` (the
 * mix spec's folder).
 */
export function track(cues, { sounds, dir, base, gain = 0, name = 'sfx' }) {
  const clips = [];
  const unknown = new Set();
  for (const c of [...cues].sort((a, b) => a.at - b.at)) {
    const s = sounds[c.kind];
    if (s === undefined) { unknown.add(c.kind); continue; }
    if (s === null || s.gain === null) continue;
    if (!KINDS[s.sound]) throw new Error(`cue kind "${c.kind}" maps to sound "${s.sound}", which synth.mjs does not make`);
    const lead = c.dur ? Math.min(0.12, c.dur * 0.15) : 0;
    const g = generate(s.sound, { ...(s.params ?? {}), ...(c.dur ? { duration: c.dur + lead * 2 } : {}) }, dir);
    clips.push({
      file: path.relative(base, g.file), at: +Math.max(0, c.at - lead).toFixed(3),
      gain: +((s.gain ?? 0) + db(c.strength ?? 1)).toFixed(2), source: `synth:${s.sound}`, cue: c.kind,
    });
  }
  return { track: { name, gain, clips }, unknown: [...unknown] };
}
