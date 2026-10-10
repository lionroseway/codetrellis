// The engines a voice can name. Add one by writing a module with the same
// shape as kokoro.mjs ({ name, version, open() -> { synth() | copy(), close() } })
// and listing it here; voices.json then refers to it by name.
import kokoro from './kokoro.mjs';
import file from './file.mjs';

export const ENGINES = { kokoro, file };

export function engine(name) {
  const e = ENGINES[name];
  if (!e) throw new Error(`no audio engine "${name}"; there are: ${Object.keys(ENGINES).join(', ')} (audio/engines/index.mjs)`);
  return e;
}
