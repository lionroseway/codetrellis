// A music track for a mix: a licensed track from the library, or a generated
// pad when none is chosen.
//
//   { "source": "library:heavenly-loop", "fadeIn": 2.5, "fadeOut": 4,
//     "duck": { "ratio": 6, "threshold": 0.025, "attack": 30, "release": 700 } }
//   { "source": "synth:pad" }
//
// A library track shorter than the video loops; one the library does not mark
// as `loops` will have an audible seam each time round, so that is a warning.
// `duck` dips the music under the voice (mix.mjs's sidechain).
import path from 'node:path';
import { library, filePath } from './library.mjs';
import { generate } from './synth.mjs';
import { duration as lengthOf } from './wav.mjs';

export function track(music, { duration, dir, base, gain = 0, under = 'vo', name = 'music' }) {
  const warnings = [];
  const { source = 'synth:pad', fadeIn = 2, fadeOut = 3, duck } = music;
  let file;
  let loop = false;
  if (source.startsWith('library:')) {
    const id = source.slice(8);
    const e = library()[id];
    if (!e) throw new Error(`music source ${source} is not in audio/library/library.json`);
    file = filePath(id);
    const len = lengthOf(file);
    if (len < duration) {
      loop = true;
      if (!e.loops) warnings.push(`"${e.title}" is ${len.toFixed(0)} s and is not a seamless loop: it will repeat with a seam over ${duration.toFixed(0)} s`);
    }
  } else if (source.startsWith('synth:')) {
    file = generate(source.slice(6), { duration }, dir).file;
  } else throw new Error(`music source "${source}" is neither library:<id> nor synth:<sound>`);
  const clip = { file: path.relative(base, file), at: 0, fadeIn, fadeOut, source, ...(loop ? { loop: true } : {}) };
  // A clip that does not loop is trimmed by the mix to the video; fade it there.
  return { track: { name, gain, ...(duck ? { duck: { under, ...duck } } : {}), clips: [clip] }, warnings };
}
