// Sounds made, not sourced: FFmpeg generates each one from noise and tones,
// so there is no sample library to license and the same parameters always
// give the same file. Each is cached by its parameters.
//
//   whoosh  a move: pink noise, band-limited, swept by a flanger, swelling
//           and falling over its duration (a window gliding between layouts)
//   push    a softer, darker whoosh (a camera push inside the window)
//   tap     a short bright click (a tap on the phone, a button)
//   pop     a soft round blip (text arriving)
//   rise    a swell that builds to its end (into an end card)
//   pad     an ambient chord bed, slowly breathing: music when no track is
//           chosen (it is a fallback, not a composition)
//
// generate(kind, { duration, seed, ... }, dir) -> { file, duration }
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ff } from './wav.mjs';

const RATE = 48000;
/** dBFS every generated sound peaks at. */
const PEAK = -3;
const env = (expr) => `volume=eval=frame:volume='${expr}'`;
const n = (x, d = 3) => Number(x).toFixed(d);

/** Each kind: its default duration, and the FFmpeg source + filters for it. */
export const KINDS = {
  whoosh: {
    duration: 0.9,
    build: ({ duration: d, seed = 1, bright = 4500 }) => ({
      src: `anoisesrc=d=${n(d)}:c=pink:r=${RATE}:a=0.9:seed=${seed}`,
      af: [`highpass=f=220`, `lowpass=f=${bright}`, `flanger=delay=2:depth=8:speed=${n(Math.max(0.1, 0.8 / d))}:width=90`,
        env(`pow(sin(PI*min(t/${n(d)},1)),2)`), `afade=t=out:st=${n(d * 0.85)}:d=${n(d * 0.15)}`],
    }),
  },
  push: {
    duration: 1.2,
    build: ({ duration: d, seed = 2 }) => ({
      src: `anoisesrc=d=${n(d)}:c=brown:r=${RATE}:a=0.9:seed=${seed}`,
      af: [`highpass=f=120`, `lowpass=f=1600`, env(`0.8*pow(sin(PI*min(t/${n(d)},1)),2)`)],
    }),
  },
  tap: {
    duration: 0.07,
    build: ({ duration: d, pitch = 2100 }) => ({
      src: `aevalsrc=exprs='0.7*sin(2*PI*${pitch}*t)*exp(-t*95)+0.25*sin(2*PI*${pitch * 2.03}*t)*exp(-t*140)':s=${RATE}:d=${n(d)}`,
      af: [],
    }),
  },
  pop: {
    duration: 0.2,
    build: ({ duration: d, pitch = 620 }) => ({
      src: `aevalsrc=exprs='0.6*sin(2*PI*(${pitch}*t+${pitch * 0.6}*t*t))*exp(-t*22)':s=${RATE}:d=${n(d)}`,
      af: [`lowpass=f=3000`],
    }),
  },
  rise: {
    duration: 1.6,
    build: ({ duration: d, seed = 3 }) => ({
      src: `aevalsrc=exprs='0.25*sin(2*PI*(180*t+160*t*t/${n(d)}))':s=${RATE}:d=${n(d)}`,
      mix: `anoisesrc=d=${n(d)}:c=pink:r=${RATE}:a=0.5:seed=${seed}`,
      af: [`highpass=f=150`, `lowpass=f=5000`, env(`pow(t/${n(d)},2.2)`), `afade=t=out:st=${n(d - 0.04)}:d=0.04`],
    }),
  },
  pad: {
    duration: 30,
    build: ({ duration: d, root = 220 }) => {
      // A minor-ninth-ish chord; each voice breathes at its own slow rate.
      const voices = [[1, 0.05], [1.2, 0.071], [1.5, 0.043], [1.782, 0.059], [2.25, 0.037]];
      const sum = voices.map(([r, lfo], i) => `${n(0.07 / (1 + i * 0.25))}*sin(2*PI*${n(root * r, 2)}*t)*(0.65+0.35*sin(2*PI*${lfo}*t+${i}))`).join('+');
      return {
        src: `aevalsrc=exprs='${sum}':s=${RATE}:d=${n(d)}`,
        af: [`lowpass=f=1800`, `aecho=0.7:0.6:180|310:0.35|0.25`, `afade=t=in:d=3`, `afade=t=out:st=${n(Math.max(0, d - 3))}:d=3`],
      };
    },
  },
};

/** A generated sound in `dir`, made only if this exact one is not there yet. */
export function generate(kind, params = {}, dir) {
  const k = KINDS[kind];
  if (!k) throw new Error(`no generated sound "${kind}"; there are: ${Object.keys(KINDS).join(', ')}`);
  const p = { ...params, duration: +(params.duration ?? k.duration).toFixed(3) };
  const key = crypto.createHash('sha256').update(JSON.stringify({ kind, p, v: 2 })).digest('hex').slice(0, 12);
  const file = path.join(dir, `${kind}-${key}.wav`);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dir, { recursive: true });
    const { src, mix, af } = k.build(p);
    const inputs = ['-f', 'lavfi', '-i', src, ...(mix ? ['-f', 'lavfi', '-i', mix] : [])];
    const head = mix ? `[0:a][1:a]amix=inputs=2:duration=first,volume=2,` : '[0:a]';
    const chain = [...af, `atrim=0:${n(p.duration)}`, `aformat=sample_fmts=s16:sample_rates=${RATE}:channel_layouts=mono`].join(',');
    const raw = `${file}.raw.wav`;
    ff(['-y', '-loglevel', 'error', ...inputs, '-filter_complex', `${head}${chain}[o]`, '-map', '[o]', raw]);
    // Every kind peaks at the same level, so a gain in a mix config means the
    // same thing for a whoosh as for a tap.
    const peak = Number(/max_volume: (-?[\d.]+) dB/.exec(ff(['-i', raw, '-af', 'volumedetect', '-f', 'null', '-']))?.[1] ?? 0);
    ff(['-y', '-loglevel', 'error', '-i', raw, '-af', `volume=${n(PEAK - peak, 2)}dB`, '-c:a', 'pcm_s16le', file]);
    fs.rmSync(raw);
  }
  return { file, duration: p.duration };
}
