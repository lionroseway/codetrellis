import {continueRender, delayRender, staticFile} from 'remotion';

// Local woff2 only — nothing is fetched from the network at render time.
const faces: Array<[string, string, string]> = [
  ['Geist', '400', 'fonts/geist-sans-latin-400-normal.woff2'],
  ['Geist', '500', 'fonts/geist-sans-latin-500-normal.woff2'],
  ['Geist', '600', 'fonts/geist-sans-latin-600-normal.woff2'],
  ['Geist', '700', 'fonts/geist-sans-latin-700-normal.woff2'],
  ['Geist Mono', '400', 'fonts/geist-mono-latin-400-normal.woff2'],
  ['Geist Mono', '500', 'fonts/geist-mono-latin-500-normal.woff2'],
];

if (typeof document !== 'undefined') {
  const handle = delayRender('Loading Geist fonts');
  Promise.all(
    faces.map(([family, weight, file]) => {
      const face = new FontFace(family, `url(${staticFile(file)}) format('woff2')`, {weight});
      return face.load().then((loaded) => {
        document.fonts.add(loaded);
      });
    }),
  )
    .then(() => continueRender(handle))
    .catch((err) => {
      console.error(err);
      continueRender(handle);
    });
}
