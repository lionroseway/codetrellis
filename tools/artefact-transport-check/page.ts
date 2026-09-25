/** The page side: the real fetch shim, then the reads main.ts checks. */
import { installElectronIpcShim } from '../../src/frontend/lib/electron-ipc-shim';

installElectronIpcShim();
const q = new URLSearchParams(location.search);
const file = q.get('file');
const image = q.get('image');
const out: Record<string, unknown> = {};
(async () => {
  const res = await fetch(`ct-artefact://${file}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  out.status = res.status;
  out.type = res.headers.get('content-type');
  out.bytesIntact = bytes.length === 256 && bytes.every((v, i) => v === i);
  const rendition = await fetch(`ct-artefact://${file}?rendition=pdf`);
  out.renditionStatus = rendition.status;
  out.renditionFallback = (await rendition.json()).fallback;
  out.unknownStatus = (await fetch('ct-artefact://33333333-3333-4333-8333-333333333333')).status;
  out.img = await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve('loaded');
    img.onerror = () => resolve('error');
    img.src = `ct-artefact://${image}`;
  });
})()
  .catch((err) => { out.error = String(err); })
  .finally(() => { (window as unknown as { __result: unknown }).__result = out; });
