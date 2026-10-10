/**
 * Whether a key or a paste belongs to the field that has the focus (Phase 33
 * follow-up): text being written, which the window's own shortcuts leave alone.
 *
 * Every `INPUT` was counted, so a ticked checkbox kept the focus and Escape
 * then did nothing: ticking "Ask me first" and pressing Escape left the plan
 * workspace open (the breakpoints test on #430, on a slow runner).
 * A checkbox, a radio or a button takes no text.
 */
const NO_TEXT = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image']);

export function isTypingTarget(el: { tagName?: string; type?: string; isContentEditable?: boolean } | null | undefined): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  return !NO_TEXT.has((el.type ?? 'text').toLowerCase());
}
