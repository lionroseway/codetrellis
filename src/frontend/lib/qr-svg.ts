/**
 * QR Code SVG generator — thin wrapper around the `qrcode` library.
 *
 * Produces a QR Code as an SVG string for embedding in the pairing
 * modal. Uses error correction level L (sufficient for the ~150-byte
 * slim v2 pairing payload).
 *
 * Replaced the previous hand-rolled Reed-Solomon implementation with
 * a battle-tested library to guarantee scannability.
 */

import QRCode from 'qrcode';

/**
 * Generate a QR code as an SVG string.
 *
 * @param text - The text/data to encode
 * @param moduleSize - Approximate module size (controls `width`)
 * @param margin - Quiet zone in modules (default 2)
 * @returns SVG markup string
 */
export function generateQrSvg(
  text: string,
  moduleSize = 5,
  margin = 2,
): string {
  // `qrcode` has a synchronous toString for SVG in the browser build,
  // but the canonical API is callback-based. We use the sync path that
  // the library exposes via `QRCode.create` + manual SVG construction
  // so the caller doesn't need to be async.

  const qr = QRCode.create(text, {
    errorCorrectionLevel: 'L',
  });

  const modules = qr.modules;
  const size = modules.size; // modules per side
  const data = modules.data; // Uint8Array, 1 = black

  const totalModules = size + margin * 2;
  const totalPx = totalModules * moduleSize;

  const paths: string[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (data[r * size + c]) {
        const x = (c + margin) * moduleSize;
        const y = (r + margin) * moduleSize;
        paths.push(`M${x},${y}h${moduleSize}v${moduleSize}h-${moduleSize}z`);
      }
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalPx} ${totalPx}" width="${totalPx}" height="${totalPx}" shape-rendering="crispEdges">` +
    `<rect width="${totalPx}" height="${totalPx}" fill="white"/>` +
    `<path d="${paths.join('')}" fill="black"/>` +
    `</svg>`
  );
}
