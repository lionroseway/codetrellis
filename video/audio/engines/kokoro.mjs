// Kokoro (82M parameters, Apache-2.0 weights): a local text-to-speech model
// that runs on the CPU through ONNX. No account, no request per line: the
// model is downloaded once into video/.models, and speaking is offline.
//
//   npm run setup:voice      downloads the model (about 100 MB), once
//
// An engine is { name, open(options) -> { synth(line) -> { samples, sampleRate }, close() } }.
// `line` is { text, voice, speed }; `voice` is one of Kokoro's names
// (af_heart, am_michael, bf_emma, bm_george, …: `npm run setup:voice` lists them).
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

async function load({ download = false, dtype = 'q8' } = {}) {
  const { env } = await import('@huggingface/transformers');
  env.cacheDir = path.join(root, '.models');
  // Speaking never reaches the network: only `setup:voice` may fetch the model.
  env.allowRemoteModels = download;
  const { KokoroTTS } = await import('kokoro-js');
  try {
    return await KokoroTTS.from_pretrained(MODEL, { dtype, device: 'cpu' });
  } catch (err) {
    if (!download) throw new Error(`Kokoro's model is not in video/.models: run npm run setup:voice first.\n(${err.message})`);
    throw err;
  }
}

const kokoro = {
  name: 'kokoro',
  /** Identifies the model in a line's cache key, so a new model re-speaks every line. */
  version: `${MODEL}@q8`,
  async open(options = {}) {
    const tts = await load(options);
    return {
      voices: Object.keys(tts.voices ?? {}),
      async synth({ text, voice = 'af_heart', speed = 1 }) {
        if (tts.voices && !tts.voices[voice]) throw new Error(`Kokoro has no voice "${voice}". It has: ${Object.keys(tts.voices).join(', ')}`);
        const out = await tts.generate(text, { voice, speed });
        return { samples: out.audio, sampleRate: out.sampling_rate };
      },
      async close() {},
    };
  },
};
export default kokoro;

// `node audio/engines/kokoro.mjs --download`: fetch the model and list the voices.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const engine = await kokoro.open({ download: process.argv.includes('--download') });
  console.log(`Kokoro is ready in video/.models. Voices:\n  ${engine.voices.join(' ')}`);
}
