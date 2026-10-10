// A line that is already recorded: a person's own voice, a clip from an
// interview, a stem from elsewhere. It goes through the same pipeline as a
// spoken line (cached, measured, mixed, checked) so a composition can mix
// recorded and generated speech in one track.
//
// A line is { id, file } with `file` relative to the lines file. FFmpeg
// converts it to mono WAV; nothing else is done to it.
import fs from 'node:fs';
import path from 'node:path';
import { ff } from '../wav.mjs';

export default {
  name: 'file',
  version: '1',
  async open() {
    return {
      /** Writes the line's audio to `out` and returns nothing: the caller measures it. */
      async copy({ file }, out, base) {
        const src = path.resolve(base, file);
        if (!fs.existsSync(src)) throw new Error(`recorded line ${file} is not at ${src}`);
        ff(['-y', '-loglevel', 'error', '-i', src, '-ac', '1', '-c:a', 'pcm_s16le', out]);
      },
      async close() {},
    };
  },
};
