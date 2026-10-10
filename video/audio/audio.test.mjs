// The audio modules, without a voice model: speech placement and fitting
// (voiceover.mjs), the lexicon (speak.mjs), the checks (check.mjs) and one
// small real mix (mix.mjs) on generated tones.
//
// Run: npm test   (in video/; FFmpeg comes from bin/env.sh)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { said, lines, fit, spec } from './voiceover.mjs';
import { spoken } from './speak.mjs';
import { checkSpec, checkRendered } from './check.mjs';
import { mix, graph } from './mix.mjs';
import { writeWav, duration } from './wav.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-test-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
/** A tone `secs` long, as a WAV file in the temp dir. */
function tone(name, secs, hz = 220, amp = 0.3) {
  const rate = 24000;
  const s = new Float32Array(Math.round(secs * rate));
  for (let i = 0; i < s.length; i++) s[i] = amp * Math.sin((2 * Math.PI * hz * i) / rate);
  const f = path.join(tmp, name);
  writeWav(f, s, rate);
  return f;
}

test('a vo is one line, several, or a conversation with voices and pauses', () => {
  assert.deepEqual(said('Hello.'), [{ voice: 'narrator', text: 'Hello.', pause: 0 }]);
  assert.deepEqual(said(['One.', 'Two.']).map((l) => l.pause), [0, 0.35]);
  const talk = said([{ voice: 'you', text: 'Show me.' }, { voice: 'agent', text: 'Here.', pause: 0.5 }]);
  assert.deepEqual(talk.map((l) => [l.voice, l.pause]), [['you', 0], ['agent', 0.5]]);
  assert.deepEqual(said(undefined), []);
  assert.throws(() => said([{ voice: 'you' }]), /neither text nor file/);
});

test('lines get stable ids per segment, and a recorded line keeps its file', () => {
  const ls = lines([{ key: '03', vo: ['A.', { file: 'rec/b.wav' }] }, { key: '04' }]);
  assert.deepEqual(ls, [{ id: '03-1', voice: 'narrator', text: 'A.' }, { id: '03-2', file: 'rec/b.wav', voice: undefined }]);
});

test('fit stretches only a segment whose speech does not fit, by exactly the shortfall', () => {
  const manifest = { lines: [{ id: 'a-1', duration: 2 }, { id: 'a-2', duration: 1 }, { id: 'b-1', duration: 1 }] };
  const [a, b, c] = fit([{ key: 'a', dur: 3, vo: ['x', 'y'] }, { key: 'b', dur: 4, vo: 'z' }, { key: 'c', dur: 2 }], manifest, { lead: 0.5, tail: 0.5 });
  assert.equal(a.need, 4.35); // 0.5 + 2 + 0.35 + 1 + 0.5
  assert.equal(a.stretch, 1.35);
  assert.equal(b.need, 4); assert.equal(b.stretch, 0);
  assert.equal(c.need, 2);
  assert.throws(() => fit([{ key: 'd', dur: 1, vo: 'q' }], manifest), /no audio for line d-1/);
});

test('spec places each line after the one before, inside its segment window', () => {
  const manifest = { lines: [{ id: 'a-1', voice: 'you', file: 'lines/a-1.wav', duration: 1 }, { id: 'a-2', voice: 'agent', file: 'lines/a-2.wav', duration: 1 }] };
  const s = spec([{ key: 'a', at: 10, dur: 4, vo: [{ voice: 'you', text: 'x' }, { voice: 'agent', text: 'y', pause: 0.5 }] }], manifest, { dir: 'vo', duration: 20, lead: 0.5, tail: 0.5 });
  assert.deepEqual(s.tracks[0].clips.map((c) => [c.id, c.at, c.file]), [['a-1', 10.5, 'vo/lines/a-1.wav'], ['a-2', 12, 'vo/lines/a-2.wav']]);
  assert.deepEqual(s.windows, [{ id: 'a', start: 10.45, end: 14, clips: ['a-1', 'a-2'] }]);
  assert.equal(s.tracks[0].exclusive, true);
});

test('the lexicon replaces whole words only, case-sensitively', () => {
  const lex = { CodeTrellis: 'Code Trellis', CI: 'C I', 'codetrellis.dev': 'code trellis dot dev' };
  assert.equal(spoken('CodeTrellis runs in CI.', lex), 'Code Trellis runs in C I.');
  assert.equal(spoken('CIRCLE and CodeTrellises', lex), 'CIRCLE and CodeTrellises');
  assert.equal(spoken('Visit codetrellis.dev', lex), 'Visit code trellis dot dev');
});

test('check finds overlaps on a voice track, clips past the end, and lines outside their window', () => {
  tone('one.wav', 1); tone('two.wav', 1);
  const base = { duration: 5, tracks: [{ name: 'vo', exclusive: true, clips: [{ id: 'a', file: 'one.wav', at: 0.5 }, { id: 'b', file: 'two.wav', at: 2 }] }], windows: [{ id: 'w', start: 0, end: 5, clips: ['a', 'b'] }] };
  assert.deepEqual(checkSpec(base, tmp).errors, []);
  const overlap = structuredClone(base); overlap.tracks[0].clips[1].at = 1.2;
  assert.match(checkSpec(overlap, tmp).errors.join('\n'), /overlap by 0\.30 s/);
  const late = structuredClone(base); late.tracks[0].clips[1].at = 4.5;
  assert.match(checkSpec(late, tmp).errors.join('\n'), /runs 0\.50 s past the end/);
  const tight = structuredClone(base); tight.windows[0].end = 2.5;
  assert.match(checkSpec(tight, tmp).errors.join('\n'), /b ends 0\.50 s after its window w/);
  const missing = structuredClone(base); missing.windows[0].clips.push('zz');
  assert.match(checkSpec(missing, tmp).errors.join('\n'), /lists zz, which no track has/);
});

test('a real mix: two tracks, a looped bed ducked under the voice, loudness on target', () => {
  tone('voice.wav', 1.5, 330, 0.5); tone('bed.wav', 1, 110, 0.4);
  const s = {
    duration: 4, loudness: { target: -16, truePeak: -1.5 },
    tracks: [
      { name: 'vo', exclusive: true, clips: [{ id: 'v', file: 'voice.wav', at: 1, fadeOut: 0.05 }] },
      { name: 'music', gain: -10, duck: { under: 'vo' }, clips: [{ file: 'bed.wav', at: 0, loop: true, fadeOut: 0.5 }] },
    ],
  };
  assert.match(graph(s, tmp).filter, /sidechaincompress/);
  const out = path.join(tmp, 'mix.wav');
  mix(s, out, { base: tmp, log: () => {} });
  const r = checkRendered(s, out);
  assert.deepEqual(r.errors, []);
  assert.ok(Math.abs(r.measured.duration - 4) < 0.05);
});

test('a real mix with one voice track and nothing else (the narrated hero\'s shape)', () => {
  tone('only.wav', 1, 300, 0.5);
  const s = { duration: 2, tracks: [{ name: 'vo', exclusive: true, clips: [{ id: 'v', file: 'only.wav', at: 0.5 }] }] };
  const out = path.join(tmp, 'solo.wav');
  mix(s, out, { base: tmp, log: () => {} });
  assert.deepEqual(checkRendered(s, out).errors, []);
});

// ── Sound effects, music and the library ──────────────────────────────────
import { generate } from './synth.mjs';
import { track as sfxTrack } from './sfx.mjs';
import { track as musicTrack } from './music.mjs';
import { LICENCES, usable, credits, library } from './library.mjs';
import { ff } from './wav.mjs';

const peakOf = (f) => Number(/max_volume: (-?[\d.]+) dB/.exec(ff(['-i', f, '-af', 'volumedetect', '-f', 'null', '-']))[1]);

test('generated sounds are cached by their parameters, sized to them, and all peak at the same level', () => {
  const dir = path.join(tmp, 'synth');
  const a = generate('whoosh', { duration: 0.8 }, dir);
  const b = generate('whoosh', { duration: 0.8 }, dir);
  const c = generate('whoosh', { duration: 1.4 }, dir);
  assert.equal(a.file, b.file);
  assert.notEqual(a.file, c.file);
  assert.ok(Math.abs(duration(a.file) - 0.8) < 0.02 && Math.abs(duration(c.file) - 1.4) < 0.02);
  for (const k of ['whoosh', 'tap', 'pop']) assert.ok(Math.abs(peakOf(generate(k, {}, dir).file) + 3) < 0.2, `${k} peaks at -3 dBFS`);
  assert.throws(() => generate('bell', {}, dir), /no generated sound "bell"/);
});

test('cues become clips through the sounds map: strength lowers the gain, null switches a kind off, unknown kinds are reported', () => {
  const sounds = { move: { sound: 'whoosh', gain: -2 }, reveal: null };
  const cues = [{ at: 2, kind: 'move', dur: 1, strength: 0.5 }, { at: 1, kind: 'reveal' }, { at: 3, kind: 'zap' }];
  const { track, unknown } = sfxTrack(cues, { sounds, dir: path.join(tmp, 'synth'), base: tmp, gain: -12 });
  assert.equal(track.gain, -12);
  assert.equal(track.clips.length, 1);
  const [m] = track.clips;
  assert.equal(m.source, 'synth:whoosh');
  assert.ok(m.at < 2, 'a whoosh starts a little before its move');
  assert.equal(m.gain, -8.02); // -2 dB, and half strength is -6.02 dB
  assert.deepEqual(unknown, ['zap']);
});

test('music: a generated pad runs the length of the video; a short library track that is not a loop warns', () => {
  const pad = musicTrack({ source: 'synth:pad', duck: { ratio: 4 } }, { duration: 6, dir: path.join(tmp, 'synth'), base: tmp });
  assert.equal(pad.track.duck.under, 'vo');
  assert.ok(Math.abs(duration(path.join(tmp, pad.track.clips[0].file)) - 6) < 0.05);
  assert.throws(() => musicTrack({ source: 'library:nope' }, { duration: 6, dir: tmp, base: tmp }), /not in audio\/library/);
  assert.throws(() => musicTrack({ source: 'mp3:x' }, { duration: 6, dir: tmp, base: tmp }), /neither library/);
});

test('the library only lets allowed licences through, and credits only those that ask for it', () => {
  for (const [id, e] of Object.entries(library())) assert.ok(LICENCES[e.licence], `${id} has an allowed licence`);
  assert.match(usable('nope'), /not in audio\/library\/library.json/);
  assert.equal(LICENCES['CC-BY-NC-4.0'], undefined, 'non-commercial is not allowed');
  const spec = { tracks: [{ name: 'music', clips: [{ source: 'library:heavenly-loop' }] }] };
  assert.deepEqual(credits(spec), [], 'CC0 needs no credit');
});

test('check refuses a library clip it cannot vouch for, and warns on a clip with no source', () => {
  tone('m.wav', 1);
  const spec = { duration: 2, tracks: [{ name: 'music', clips: [{ file: 'm.wav', at: 0, source: 'library:not-listed' }, { file: 'm.wav', at: 0.5 }] }] };
  const r = checkSpec(spec, tmp);
  assert.match(r.errors.join('\n'), /not-listed" is not in audio\/library\/library.json/);
  assert.match(r.warnings.join('\n'), /does not say where it came from/);
  spec.tracks[0].clips[0].source = 'bootleg:x';
  assert.match(checkSpec(spec, tmp).errors.join('\n'), /unknown source "bootleg:x"/);
});
