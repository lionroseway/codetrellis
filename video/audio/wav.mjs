// Small audio helpers the other modules share: write samples as WAV, ask
// FFprobe how long a file is, run FFmpeg. Nothing here knows about voices,
// compositions or mixes.
import fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';

const ffmpeg = () => process.env.FFMPEG || 'ffmpeg';
const ffprobe = () => process.env.FFPROBE || 'ffprobe';

/** Mono float samples (-1..1) to a 16-bit PCM WAV file. */
export function writeWav(file, samples, sampleRate) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(sampleRate, 24); head.writeUInt32LE(sampleRate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([head, data]));
}

/** Seconds of audio in a file, from FFprobe. */
export function duration(file) {
  const out = execFileSync(ffprobe(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim();
  const d = Number(out);
  if (!Number.isFinite(d)) throw new Error(`could not read the duration of ${file}`);
  return +d.toFixed(3);
}

/**
 * FFmpeg with these arguments. Returns what it printed to stderr, which is
 * where its measurements (loudness, peaks) go; throws with the tail of it on
 * failure. Pass `['-f', 'null', '-']` as the output to measure only.
 */
export function ff(args) {
  const r = spawnSync(ffmpeg(), ['-hide_banner', '-nostats', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`ffmpeg failed:\n${String(r.stderr).split('\n').slice(-12).join('\n')}`);
  return r.stderr;
}
