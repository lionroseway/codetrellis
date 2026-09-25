/**
 * Paint one raw bitmap over another — the screenshot's half of §7.3.
 *
 * An HTML report is drawn in its own WebContentsView laid over the viewer
 * (html-view.ts), and `webContents.capturePage()` sees only the window's
 * own page. So the `screenshot` tool returned the white box the report sits
 * on while `ui_ready` correctly said the report was open: a picture that
 * disagreed with the screen, which is the one thing a screenshot is for.
 * Measured on a packaged build; the report was on screen the whole time.
 *
 * Pure, so it is tested without Electron. Both bitmaps are 4 bytes a pixel
 * in the same channel order (NativeImage.toBitmap gives both the same).
 */

export interface Raster {
  data: Buffer;
  width: number;
  height: number;
}

/** `base` with `top` copied over it at (x, y), clipped to `base`. `base` is not modified. */
export function overlay(base: Raster, top: Raster, x: number, y: number): Buffer {
  const out = Buffer.from(base.data);
  const left = Math.max(0, Math.round(x));
  const upper = Math.max(0, Math.round(y));
  const skipX = left - Math.round(x);
  const skipY = upper - Math.round(y);
  const cols = Math.min(top.width - skipX, base.width - left);
  const rows = Math.min(top.height - skipY, base.height - upper);
  if (cols <= 0 || rows <= 0) return out;
  for (let r = 0; r < rows; r++) {
    const from = ((skipY + r) * top.width + skipX) * 4;
    const to = ((upper + r) * base.width + left) * 4;
    top.data.copy(out, to, from, from + cols * 4);
  }
  return out;
}
