// Lines in, audio clips out: one WAV per line, and a manifest saying how long
// each one is. It knows nothing about compositions; whatever made the lines
// (a beat list, a conversation script, a hand-written file) reads the
// manifest back to place them.
//
// Lines file:
//   { "lines": [
//       { "id": "07-1", "voice": "narrator", "text": "See which agent wrote every line." },
//       { "id": "17-1", "voice": "you",      "text": "Show me where they overlap." },
//       { "id": "17-2", "voice": "agent",    "text": "Here: both change one function." },
//       { "id": "intro", "file": "recorded/intro.wav" } ] }
//   `voice` names an entry in voices.json (engine, its voice, speed); `speed`
//   on a line overrides the voice's. `file` is an already-recorded line,
//   relative to the lines file. Text is said through lexicon.json first.
//
// Manifest (out-dir/vo.json):
//   { "lines": [ { "id", "voice", "text", "spoken", "engine", "file", "duration" } ] }
//   `file` is relative to the manifest. A line is spoken again only when what
//   is said, or how, changes (the cache key is in its file name).
//
// Usage: node audio/speak.mjs <lines.json> <out-dir>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { engine } from './engines/index.mjs';
import { writeWav, duration } from './wav.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const notes = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_')));

/** A line's text as it should be said: lexicon.json's whole-word replacements. */
export function spoken(text, lexicon) {
  return Object.entries(lexicon).reduce(
    (s, [word, say]) => s.replace(new RegExp(`(?<![\\w-])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'g'), say), text);
}

/**
 * Speaks `lines` into `outDir`, reusing clips whose cache key is unchanged.
 * Returns the manifest (also written to outDir/vo.json).
 */
export async function speak(lines, {
  outDir, base = process.cwd(),
  voices = notes(readJson(path.join(here, 'voices.json'))),
  lexicon = notes(readJson(path.join(here, 'lexicon.json'))),
  log = console.log,
} = {}) {
  const clipsDir = path.join(outDir, 'lines');
  fs.mkdirSync(clipsDir, { recursive: true });
  const ids = new Set();
  const sessions = new Map();
  const session = async (name) => {
    if (!sessions.has(name)) sessions.set(name, await engine(name).open());
    return sessions.get(name);
  };
  const out = [];
  let made = 0;
  try {
    for (const line of lines) {
      if (!line.id) throw new Error(`a line has no id: ${JSON.stringify(line).slice(0, 80)}`);
      if (ids.has(line.id)) throw new Error(`two lines have the id ${line.id}`);
      ids.add(line.id);
      const recorded = line.file !== undefined;
      const v = recorded ? { engine: 'file' } : voices[line.voice];
      if (!v) throw new Error(`line ${line.id} uses voice "${line.voice}", which voices.json does not have (${Object.keys(voices).join(', ')})`);
      const say = recorded ? null : spoken(line.text ?? '', lexicon);
      if (!recorded && !say.trim()) throw new Error(`line ${line.id} has no text`);
      const e = engine(v.engine);
      const how = recorded
        ? { engine: e.name, version: e.version, file: line.file, mtime: fs.statSync(path.resolve(base, line.file)).mtimeMs }
        : { engine: e.name, version: e.version, voice: v.voice, speed: line.speed ?? v.speed ?? 1, say };
      const key = crypto.createHash('sha256').update(JSON.stringify(how)).digest('hex').slice(0, 12);
      const file = path.join(clipsDir, `${line.id}-${key}.wav`);
      if (!fs.existsSync(file)) {
        const s = await session(e.name);
        if (recorded) await s.copy(line, file, base);
        else {
          const { samples, sampleRate } = await s.synth({ text: say, voice: v.voice, speed: how.speed });
          writeWav(file, samples, sampleRate);
        }
        made += 1;
        log(`  ${line.id.padEnd(8)} ${recorded ? `recorded ${line.file}` : `${line.voice}: ${say}`}`);
      }
      out.push({ id: line.id, voice: line.voice ?? null, text: line.text ?? null, spoken: say, engine: e.name,
        file: path.relative(outDir, file), duration: duration(file) });
    }
  } finally {
    for (const s of sessions.values()) await s.close();
  }
  // Clips no line uses any more: an old wording, a removed line.
  const keep = new Set(out.map((l) => path.basename(l.file)));
  for (const f of fs.readdirSync(clipsDir)) if (!keep.has(f)) fs.rmSync(path.join(clipsDir, f));
  const manifest = { lines: out };
  fs.writeFileSync(path.join(outDir, 'vo.json'), JSON.stringify(manifest, null, 2) + '\n');
  const total = out.reduce((n, l) => n + l.duration, 0);
  log(`speak: ${out.length} lines (${made} new, ${out.length - made} cached), ${total.toFixed(1)} s of speech -> ${path.relative(process.cwd(), path.join(outDir, 'vo.json'))}`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [linesFile, outDir] = process.argv.slice(2);
  if (!linesFile || !outDir) { console.error('usage: node audio/speak.mjs <lines.json> <out-dir>'); process.exit(2); }
  await speak(readJson(linesFile).lines, { outDir: path.resolve(outDir), base: path.dirname(path.resolve(linesFile)) });
}
