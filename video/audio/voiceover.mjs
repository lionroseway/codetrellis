// Speech placed on segments: anything with a key, a start and a length that
// may carry what is said over it (a beat, a slide, a scene). Three steps,
// each usable on its own:
//
//   lines(segments)            -> the lines to speak (for speak.mjs)
//   fit(segments, manifest)    -> how long each segment must be to hold its speech
//   spec(segments, manifest)   -> a mix spec (for mix.mjs and check.mjs)
//
// A segment's `vo` is what is said over it:
//   "One line, in the default voice."
//   [ "Two lines,", "one after the other." ]
//   [ { "voice": "you", "text": "Show me." }, { "voice": "agent", "text": "Here.", "pause": 0.5 } ]
// `pause` is the silence before a line (after the first): a breath, or a turn
// in a conversation. Line ids are `<key>-<n>`, so speak.mjs caches per line.
//
// The speech starts `lead` seconds into its segment and must end `tail`
// seconds before the segment does (time for whatever moves into the next one).
const DEFAULTS = { voice: 'narrator', pause: 0.35, lead: 0.5, tail: 0.65 };

/** A segment's `vo`, as a list of { voice, text, pause }. */
export function said(vo, { voice = DEFAULTS.voice, pause = DEFAULTS.pause } = {}) {
  if (vo === undefined || vo === null || vo === '') return [];
  return [vo].flat().map((x, k) => {
    const line = typeof x === 'string' ? { text: x } : { ...x };
    if (!line.text && !line.file) throw new Error(`a vo line has neither text nor file: ${JSON.stringify(x)}`);
    return { voice: line.file ? undefined : (line.voice ?? voice), ...line, pause: k === 0 ? 0 : (line.pause ?? pause) };
  });
}

/** Every line the segments say, with stable ids, for speak.mjs. */
export function lines(segments, opts = {}) {
  return segments.flatMap((s) => said(s.vo, opts).map((l, k) => {
    const { pause: _pause, ...rest } = l;
    return { id: `${s.key}-${k + 1}`, ...rest };
  }));
}

const byId = (manifest) => new Map(manifest.lines.map((l) => [l.id, l]));

/** Seconds of speech in a segment, pauses included; null when it says nothing. */
export function speech(segment, manifest, opts = {}) {
  const ls = said(segment.vo, opts);
  if (!ls.length) return null;
  const m = byId(manifest);
  return ls.reduce((t, l, k) => {
    const got = m.get(`${segment.key}-${k + 1}`);
    if (!got) throw new Error(`no audio for line ${segment.key}-${k + 1}: speak the lines again (npm run narrate)`);
    return t + l.pause + got.duration;
  }, 0);
}

/**
 * The length each segment needs to hold its speech: its own `dur`, or longer
 * when the speech does not fit. Returns [{ key, dur, need, stretch }].
 */
export function fit(segments, manifest, { lead = DEFAULTS.lead, tail = DEFAULTS.tail, ...opts } = {}) {
  return segments.map((s) => {
    const sp = speech(s, manifest, opts);
    const need = sp === null ? s.dur : +(lead + sp + tail).toFixed(2);
    return { key: s.key, dur: s.dur, need: Math.max(s.dur, need), stretch: +Math.max(0, need - s.dur).toFixed(2) };
  });
}

/**
 * A mix spec with one exclusive voice track: every line at its time, and a
 * window per speaking segment (from just before its speech to its end) for
 * check.mjs. `dir` is where the manifest's files are, relative
 * to the spec. Segments need `at` and `dur` (after fit).
 */
export function spec(segments, manifest, {
  // `tail` is fit()'s concern; taken here so it is not passed on to said().
  dir, duration, lead = DEFAULTS.lead, tail: _tail = DEFAULTS.tail, loudness = { target: -16, truePeak: -1.5 }, track = 'vo',
  // Speech compression, as voiceover is usually done; false for none.
  compress = { threshold: -26, ratio: 4, attack: 5, release: 160, makeup: 6 }, ...opts
}) {
  const m = byId(manifest);
  const clips = [];
  const windows = [];
  for (const s of segments) {
    const ls = said(s.vo, opts);
    if (!ls.length) continue;
    let t = s.at + lead;
    const ids = [];
    ls.forEach((l, k) => {
      const id = `${s.key}-${k + 1}`;
      const got = m.get(id);
      t += l.pause;
      clips.push({ id, voice: got.voice, file: `${dir}/${got.file}`, at: +t.toFixed(3), fadeIn: 0.01, fadeOut: 0.04,
        source: got.engine === 'file' ? 'file' : `tts:${got.engine}` });
      ids.push(id);
      t += got.duration;
    });
    // The window is the segment itself; `tail` is the breath fit() leaves inside it.
    windows.push({ id: s.key, start: +(s.at + lead - 0.05).toFixed(3), end: +(s.at + s.dur).toFixed(3), clips: ids });
  }
  return { duration, loudness, tracks: [{ name: track, exclusive: true, compress, clips }], windows };
}
