/**
 * No literal colour in a graph component (Phase 33 G1).
 *
 * The 0.3 colour audit found the graph's colours written inline, file by
 * file, until amber meant about twenty things and a cross-system edge was
 * drawn exactly like an import. G1 moved every state's colour, glyph, dash
 * and word into one module, `lib/visual-language.ts`. This guard keeps them
 * there: a hex, an `rgb()`/`hsl()` or a Tailwind palette class
 * (`text-amber-400`, `bg-red-500/20`, `border-violet-300`) in a file under
 * `components/graph/` fails here, and the fix is to name the state in the
 * vocabulary and read it from there.
 *
 * One allowance, small and on purpose: `text-zinc-*`. Zinc is the app's
 * neutral grey, and in these files it only ever sets chrome text (a file
 * name, a path, a link count, a menu label) that carries no state. Every
 * other palette, and every zinc that is not text, is refused.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GRAPH = path.dirname(fileURLToPath(import.meta.url));

const PALETTE = [
  'slate', 'gray', 'zinc', 'neutral', 'stone', 'red', 'orange', 'amber', 'yellow', 'lime', 'green',
  'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
];

const UTILITIES = [
  'text', 'bg', 'border', 'border-[trblxyse]', 'ring', 'ring-offset', 'outline', 'from', 'via', 'to',
  'fill', 'stroke', 'shadow', 'decoration', 'divide', 'accent', 'caret', 'placeholder', 'drop-shadow',
];

/** The only palette classes allowed: neutral chrome text. See the header. */
const ALLOWED = /^text-zinc-\d{2,3}$/;

const HEX = /(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;
const COLOUR_FN = /(?<![A-Za-z])(?:rgba?|hsla?|oklch|oklab|hwb|lab|lch)\(/g;
const PALETTE_CLASS = new RegExp(
  `\\b(?:${UTILITIES.join('|')})-(?:${PALETTE.join('|')})-(?:50|[1-9]00|950)\\b`,
  'g',
);

/** Comments may name a colour (the header above does); only code is checked. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/** Every literal colour in a source, as `line: match`. */
function literalColours(source: string): string[] {
  const found: string[] = [];
  const lines = stripComments(source).split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(HEX)) found.push(`${i + 1}: ${m[0]}`);
    for (const m of line.matchAll(COLOUR_FN)) found.push(`${i + 1}: ${m[0]}`);
    for (const m of line.matchAll(PALETTE_CLASS)) {
      if (!ALLOWED.test(m[0])) found.push(`${i + 1}: ${m[0]}`);
    }
  });
  return found;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('graph components hold no literal colour', () => {
  test('the patterns catch what they are meant to, and pass what they are not', () => {
    // A guard that matches nothing passes on everything.
    for (const bad of [
      "className='text-amber-400'", "className='bg-red-500/20'", "className='border-violet-300'",
      "className='hover:border-l-sky-400'", "className='!bg-blue-100'", "className='bg-zinc-900'",
      "color: '#4ade80'", "color: '#fff'", "stroke: 'rgba(96, 165, 250, 0.7)'", "c = 'hsl(0 0% 0%)'",
      "className='shadow-[0_0_8px_rgba(0,0,0,0.3)]'", "className='bg-[#0e1422]'",
    ]) {
      assert.notDeepEqual(literalColours(bad), [], `should be caught: ${bad}`);
    }
    for (const fine of [
      "className='text-zinc-400 hover:text-zinc-200'", "className='border-white/10 bg-white/[0.05] bg-black/16'",
      "className='text-foreground-muted border-warning/80 text-accent'", "href={`#${pathId}`}",
      '<span>&#xFE0E;</span>', '// a comment saying text-amber-400 and #ff0000',
      'className={GRAPH_MARK.breakpoint}',
    ]) {
      assert.deepEqual(literalColours(fine), [], `should pass: ${fine}`);
    }
  });

  test('no file under components/graph/ writes a colour of its own', () => {
    const files = walk(GRAPH);
    assert.ok(files.length >= 10, `expected the graph components, walked ${files.length} files`);
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(GRAPH, file).split(path.sep).join('/');
      for (const hit of literalColours(fs.readFileSync(file, 'utf-8'))) offenders.push(`${rel}:${hit}`);
    }
    assert.deepEqual(
      offenders,
      [],
      'Literal colours in graph components. Name the state in lib/visual-language.ts and read it from there:\n'
      + offenders.join('\n'),
    );
  });
});
