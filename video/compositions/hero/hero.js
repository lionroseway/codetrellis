/*
 * Shared by every act: placing the camera on a point of the footage, and the
 * small motions every act uses. Deterministic: no clocks, no randomness.
 */
(function () {
  const HERO = {};

  /**
   * A camera shot on a window at (L, T) in a `.cam` (transform-origin 0 0):
   * footage point (fx, fy), in the 1600x900 layout, lands on screen point
   * (sx, sy) at scale s.
   */
  HERO.cam = (L, T, fx, fy, s, sx = 960, sy = 540) => ({ x: sx - (L + fx) * s, y: sy - (T + fy) * s, scale: s });

  /** The whole window, scaled to `s` and placed with its top-left at (x, y). */
  HERO.place = (L, T, x, y, s) => ({ x: x - L * s, y: y - T * s, scale: s });

  /**
   * A mosaic tile's source, showing footage region (fx, fy, fw) filling a
   * tile `tw` wide: returns the transform for `.tile .src`.
   */
  HERO.region = (fx, fy, fw, tw) => { const s = tw / fw; return { x: -fx * s, y: -fy * s, scale: s }; };

  /** Fade and rise in. */
  HERO.rise = (tl, sel, at, opts = {}) => tl.from(sel, { opacity: 0, y: opts.y ?? 28, duration: opts.d ?? 0.6, ease: 'expo.out', stagger: opts.stagger ?? 0, immediateRender: opts.immediate ?? true }, at);

  /** Fade and drift out. */
  HERO.leave = (tl, sel, at, opts = {}) => tl.to(sel, { opacity: 0, y: opts.y ?? -14, duration: opts.d ?? 0.35, ease: 'power2.in' }, at);

  /** A caption card in, then out after `hold` seconds. Captions are centred with xPercent. */
  HERO.caption = (tl, sel, at, hold) => {
    tl.fromTo(sel, { opacity: 0, y: 24, xPercent: -50 }, { opacity: 1, y: 0, xPercent: -50, duration: 0.5, ease: 'expo.out', immediateRender: false }, at);
    tl.to(sel, { opacity: 0, y: -10, duration: 0.3, ease: 'power2.in' }, at + hold);
  };

  window.HERO = HERO;
})();
