// A mix spec in, one audio file out; and the audio put onto a video.
//
// It does not know where the spec came from. A composition's build writes one
// from its beats, a conversation script could write one turn after turn, or a
// person can write it by hand: tracks of clips at times, and how loud.
//
// Mix spec (paths relative to the spec file):
//   { "duration": 160.2,                       seconds; the video's length
//     "loudness": { "target": -16, "truePeak": -1.5 },   LUFS / dBTP (-16 web, -14 YouTube)
//     "tracks": [
//       { "name": "vo", "exclusive": true,     no two clips may overlap (check.mjs)
//         "gain": 0,                           dB for the whole track
//         "compress": { "threshold": -24, "ratio": 4, "attack": 5, "release": 150, "makeup": 6 },  dB / ms
//         "clips": [ { "id": "07-1", "file": "assets/vo/lines/07-1-….wav", "at": 41.3,
//                      "gain": 0, "fadeIn": 0.02, "fadeOut": 0.05 } ] },
//       { "name": "music", "gain": -18,
//         "duck": { "under": "vo", "ratio": 8, "threshold": 0.03, "attack": 20, "release": 400 },
//         "clips": [ { "file": "music/bed.wav", "at": 0, "loop": true, "fadeOut": 3 } ] } ],
//     "windows": [ { "id": "07", "start": 40.0, "end": 45.5, "clips": ["07-1"] } ] }
//   `duck` lowers a track while another one sounds (music under the voice).
//   `windows` are for check.mjs: where each clip is meant to sit (a beat, a scene).
//
// Usage:
//   node audio/mix.mjs <spec.json> <out.wav>
//   node audio/mix.mjs --mux <video.mp4> <audio.wav> <out.mp4>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ff, duration } from './wav.mjs';

const RATE = 48000;

/** The FFmpeg inputs and filter graph for a spec (exported for tests and for check.mjs). */
export function graph(spec, base) {
  const inputs = [];
  const lines = [];
  const trackOut = new Map();
  const D = spec.duration;
  if (!(D > 0)) throw new Error('a mix spec needs a positive duration');
  for (const track of spec.tracks ?? []) {
    const parts = [];
    for (const clip of track.clips ?? []) {
      const file = path.resolve(base, clip.file);
      if (!fs.existsSync(file)) throw new Error(`track ${track.name}: ${clip.file} is not there`);
      inputs.push(...(clip.loop ? ['-stream_loop', '-1'] : []), '-i', file);
      const i = inputs.filter((x) => x === '-i').length - 1;
      const ms = Math.max(0, Math.round((clip.at ?? 0) * 1000));
      const len = clip.loop ? D - (clip.at ?? 0) : null;
      // Stereo throughout: a mono voice or effect sits in the centre, music keeps its width.
      const f = [`aformat=sample_fmts=fltp:channel_layouts=stereo`, `aresample=${RATE}`];
      if (len !== null) f.push(`atrim=0:${len.toFixed(3)}`);
      if (clip.gain) f.push(`volume=${clip.gain}dB`);
      if (clip.fadeIn) f.push(`afade=t=in:d=${clip.fadeIn}`);
      if (clip.fadeOut) {
        // Fade where the clip ends, or where the video does if that is sooner.
        const end = len ?? Math.min(duration(file), D - (clip.at ?? 0));
        f.push(`afade=t=out:st=${Math.max(0, end - clip.fadeOut).toFixed(3)}:d=${clip.fadeOut}`);
      }
      f.push(`adelay=${ms}`, 'apad', `atrim=0:${D.toFixed(3)}`);
      const label = `c${i}`;
      lines.push(`[${i}:a]${f.join(',')}[${label}]`);
      parts.push(label);
    }
    if (!parts.length) continue;
    const t = `t_${track.name.replace(/\W/g, '_')}`;
    // amix divides by its input count; every input runs the full length, so
    // multiplying back by the count leaves each clip at its own level.
    const sum = parts.length > 1 ? `${parts.map((p) => `[${p}]`).join('')}amix=inputs=${parts.length}:duration=longest:dropout_transition=0,volume=${parts.length}` : `[${parts[0]}]anull`;
    // A compressor evens a track out (speech especially: a voice peaks some
    // 20 dB over its average, and the mix could not reach its loudness).
    const c = track.compress;
    const comp = c ? `,acompressor=threshold=${Math.pow(10, (c.threshold ?? -24) / 20).toFixed(4)}:ratio=${c.ratio ?? 4}:attack=${c.attack ?? 5}:release=${c.release ?? 150}:makeup=${Math.pow(10, (c.makeup ?? 0) / 20).toFixed(3)}` : '';
    lines.push(`${sum}${comp},volume=${track.gain ?? 0}dB[${t}]`);
    trackOut.set(track.name, t);
  }
  if (!trackOut.size) throw new Error('the mix has no clips');
  // Ducking: a track that should dip under another gets that one as a sidechain.
  const uses = new Map();
  for (const track of spec.tracks ?? []) if (track.duck && trackOut.has(track.name)) {
    if (!trackOut.has(track.duck.under)) throw new Error(`track ${track.name} ducks under "${track.duck.under}", which has no clips`);
    uses.set(track.duck.under, (uses.get(track.duck.under) ?? 0) + 1);
  }
  for (const [name, n] of uses) {
    const t = trackOut.get(name);
    lines.push(`[${t}]asplit=${n + 1}[${t}_m]${Array.from({ length: n }, (_, k) => `[${t}_sc${k}]`).join('')}`);
    trackOut.set(name, `${t}_m`);
  }
  const used = new Map();
  for (const track of spec.tracks ?? []) if (track.duck && trackOut.has(track.name)) {
    const d = track.duck;
    const k = used.get(d.under) ?? 0; used.set(d.under, k + 1);
    const sc = `t_${d.under.replace(/\W/g, '_')}_sc${k}`;
    const t = trackOut.get(track.name);
    // sidechaincompress cannot pick a format on its own (FFmpeg 4.4): pin both inputs.
    const fmt = `aformat=sample_fmts=fltp:sample_rates=${RATE}:channel_layouts=stereo`;
    lines.push(`[${t}]${fmt}[${t}_f]`, `[${sc}]${fmt}[${sc}_f]`);
    lines.push(`[${t}_f][${sc}_f]sidechaincompress=threshold=${d.threshold ?? 0.03}:ratio=${d.ratio ?? 8}:attack=${d.attack ?? 20}:release=${d.release ?? 400}[${t}_d]`);
    trackOut.set(track.name, `${t}_d`);
  }
  const outs = [...trackOut.values()];
  const all = outs.length > 1 ? `${outs.map((o) => `[${o}]`).join('')}amix=inputs=${outs.length}:duration=longest:dropout_transition=0,volume=${outs.length}` : `[${outs[0]}]anull`;
  lines.push(`${all}[mix]`);
  return { inputs, filter: lines.join(';\n') };
}

/** Renders the spec to `out` (48 kHz stereo WAV) at its loudness target, peaks limited. */
export function mix(spec, out, { base = process.cwd(), log = console.log } = {}) {
  const { inputs, filter } = graph(spec, base);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mix-'));
  try {
    const script = path.join(tmp, 'graph.txt');
    fs.writeFileSync(script, filter);
    const raw = path.join(tmp, 'raw.wav');
    ff(['-y', '-loglevel', 'error', ...inputs, '-filter_complex_script', script, '-map', '[mix]', '-c:a', 'pcm_s24le', raw]);
    const { target = -16, truePeak = -1.5 } = spec.loudness ?? {};
    // The limiter takes a little back from transients, so measure the result
    // and correct the gain; two or three passes land within 0.3 LU.
    const ceiling = Math.pow(10, (truePeak - 1) / 20).toFixed(4);
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    let gain = target - integrated(raw);
    for (let pass = 0; pass < 4; pass++) {
      ff(['-y', '-loglevel', 'error', '-i', raw, '-af',
        `volume=${gain.toFixed(2)}dB,alimiter=limit=${ceiling}:attack=1:release=50:level=0,aresample=${RATE},aformat=sample_fmts=s16:sample_rates=${RATE}:channel_layouts=stereo`,
        '-c:a', 'pcm_s16le', out]);
      const off = target - integrated(out);
      if (Math.abs(off) <= 0.3) break;
      gain += off;
    }
    log(`mix: ${spec.tracks.filter((t) => t.clips?.length).map((t) => `${t.name} ×${t.clips.length}`).join(', ')}; ${spec.duration} s at ${target} LUFS -> ${path.relative(process.cwd(), out)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Integrated loudness of a file in LUFS (EBU R128). */
export function integrated(file) {
  const out = ff(['-i', file, '-af', 'ebur128', '-f', 'null', '-']);
  const I = Number(/I:\s+(-?[\d.]+) LUFS/.exec(out.slice(out.lastIndexOf('Summary:')))?.[1]);
  if (!Number.isFinite(I)) throw new Error(`could not measure the loudness of ${file}`);
  return I;
}

/** The video's picture with this audio, as AAC; the picture is copied, not re-encoded. */
export function mux(video, audio, out, { log = console.log } = {}) {
  ff(['-y', '-loglevel', 'error', '-i', video, '-i', audio, '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out]);
  log(`mux: ${path.relative(process.cwd(), out)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const a = process.argv.slice(2);
  if (a[0] === '--mux') {
    if (a.length !== 4) { console.error('usage: node audio/mix.mjs --mux <video.mp4> <audio.wav> <out.mp4>'); process.exit(2); }
    mux(a[1], a[2], a[3]);
  } else {
    if (a.length !== 2) { console.error('usage: node audio/mix.mjs <spec.json> <out.wav>'); process.exit(2); }
    mix(JSON.parse(fs.readFileSync(a[0], 'utf8')), path.resolve(a[1]), { base: path.dirname(path.resolve(a[0])) });
  }
}
