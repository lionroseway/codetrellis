/**
 * Minimal ANSI → styled-span parser for rendering PTY output in React Native.
 *
 * Handles SGR colour/bold/dim sequences (incl. 256-colour and truecolour),
 * and strips the non-display escape sequences a shell emits (cursor moves,
 * erase, bracketed-paste `\x1b[?2004h`, OSC title sets) so they don't leak
 * as literal text like `[?2004h`.
 *
 * It is NOT a full terminal emulator — it doesn't honour cursor moves or
 * `\r` overwrites — but it's enough to colour normal shell output.
 */

export interface AnsiSpan {
  text: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
}

const ESC = '\x1b';

// Dark-terminal-friendly 16-colour palette (matches the app accent set).
const BASE = ['#3f3f46', '#ef4444', '#22c55e', '#eab308', '#3b82f6', '#a855f7', '#06b6d4', '#d4d4d8'];
const BRIGHT = ['#71717a', '#f87171', '#4ade80', '#facc15', '#60a5fa', '#c084fc', '#22d3ee', '#fafafa'];

function rgbHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function xterm256(n: number): string {
  if (n < 8) return BASE[n];
  if (n < 16) return BRIGHT[n - 8];
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return rgbHex(v, v, v);
  }
  const c = n - 16;
  const r = Math.floor(c / 36);
  const g = Math.floor((c % 36) / 6);
  const b = c % 6;
  const conv = (x: number) => (x === 0 ? 0 : 55 + x * 40);
  return rgbHex(conv(r), conv(g), conv(b));
}

interface SgrState {
  color?: string;
  bold?: boolean;
  dim?: boolean;
}

function applySgr(params: string, prev: SgrState): SgrState {
  const codes = params.split(';').filter((p) => p !== '').map((p) => parseInt(p, 10));
  if (codes.length === 0) return {};
  const s: SgrState = { ...prev };
  for (let k = 0; k < codes.length; k++) {
    const c = codes[k];
    if (c === 0) {
      s.color = undefined; s.bold = false; s.dim = false;
    } else if (c === 1) {
      s.bold = true;
    } else if (c === 2) {
      s.dim = true;
    } else if (c === 22) {
      s.bold = false; s.dim = false;
    } else if (c === 39) {
      s.color = undefined;
    } else if (c >= 30 && c <= 37) {
      s.color = BASE[c - 30];
    } else if (c >= 90 && c <= 97) {
      s.color = BRIGHT[c - 90];
    } else if (c === 38) {
      if (codes[k + 1] === 5) { s.color = xterm256(codes[k + 2] ?? 0); k += 2; }
      else if (codes[k + 1] === 2) { s.color = rgbHex(codes[k + 2] ?? 0, codes[k + 3] ?? 0, codes[k + 4] ?? 0); k += 4; }
    } else if (c === 48) {
      // background — consume params, ignore colour
      if (codes[k + 1] === 5) k += 2;
      else if (codes[k + 1] === 2) k += 4;
    }
    // other codes (background 40-47/100-107, underline, etc.) ignored
  }
  return s;
}

export function parseAnsi(input: string): AnsiSpan[] {
  const spans: AnsiSpan[] = [];
  let state: SgrState = {};
  let buf = '';
  let i = 0;

  const flush = () => {
    if (buf) {
      spans.push({ text: buf, color: state.color, bold: state.bold, dim: state.dim });
      buf = '';
    }
  };

  while (i < input.length) {
    const ch = input[i];

    if (ch === ESC) {
      const next = input[i + 1];
      if (next === '[') {
        // CSI: ESC [ params... finalByte
        let j = i + 2;
        while (j < input.length && /[0-9;?]/.test(input[j])) j++;
        const finalByte = input[j];
        const params = input.slice(i + 2, j);
        if (finalByte === 'm') {
          flush();
          state = applySgr(params.replace(/\?/g, ''), state);
        }
        // else: cursor move / erase / bracketed-paste → strip
        i = j + 1;
        continue;
      }
      if (next === ']') {
        // OSC: ESC ] ... (BEL | ESC \)
        let j = i + 2;
        while (j < input.length && input[j] !== '\x07' && !(input[j] === ESC && input[j + 1] === '\\')) j++;
        i = input[j] === '\x07' ? j + 1 : j + 2;
        continue;
      }
      // lone/unknown escape → skip the ESC and following byte
      i += 2;
      continue;
    }

    // Drop lone control chars (CR, BEL, backspace, etc.); keep \n and \t.
    if (ch < ' ' && ch !== '\n' && ch !== '\t') { i++; continue; }

    buf += ch;
    i++;
  }

  flush();
  return spans;
}
