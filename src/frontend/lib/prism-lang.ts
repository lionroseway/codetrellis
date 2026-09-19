import { Prism } from 'prism-react-renderer';

/**
 * CodeTrellis language tag → the Prism grammar to highlight it with.
 *
 * **`prism-react-renderer` bundles its own cut-down Prism**, and that
 * bundle is much smaller than Prism's full component list. This map used
 * to name six grammars the bundle does not contain — `java`, `php`,
 * `ruby`, `bash`, `toml`, `scss` — and nothing anywhere said so: the
 * renderer's `useTokenize` treats a missing grammar as `null` and returns
 * the source as one plain token. So Java and PHP files have been
 * rendering unhighlighted while this map claimed otherwise, with no
 * error, no warning, and no way to tell from the code. Exactly the class
 * of silent list-drift that Phase 27's `findUnparsedLanguages` exists to
 * catch on the parser side.
 *
 * Two rules now hold it together:
 *
 * 1. Every value is checked against the bundled registry at module load
 *    (`resolvePrismLanguage`), so a name that is not really there falls
 *    back to plain instead of pretending.
 * 2. A language may borrow a *related* grammar only when the result is
 *    genuinely right for it. `clike` covers the brace-and-semicolon
 *    languages (Java, C#) correctly for comments, strings, numbers and
 *    the shared keyword core. Ruby is not one of those and is mapped to
 *    plain on purpose — a wrong grammar is worse than no grammar.
 */
const PRISM_LANG: Record<string, string> = {
  typescript: 'tsx', tsx: 'tsx', javascript: 'jsx', jsx: 'jsx',
  json: 'json', css: 'css', markup: 'markup',
  python: 'python', rust: 'rust', go: 'go',
  markdown: 'markdown', yaml: 'yaml', sql: 'sql',
  // Phase 27 — these three ARE in the bundle.
  kotlin: 'kotlin', swift: 'swift',
  // Bundled as `css`; SCSS's extra syntax degrades, it does not misfire.
  scss: 'css',
  // No dedicated grammar in the bundle; `clike` is correct as far as it
  // goes for all three.
  java: 'clike', csharp: 'clike', php: 'clike',
  // Deliberately absent, and therefore plain: ruby, bash, toml.
  plaintext: 'plain',
};

/**
 * The grammar to actually pass to `<Highlight>`, having checked it
 * exists. Returns `'plain'` rather than a name the bundle cannot honour.
 */
export function resolvePrismLanguage(tag: string | undefined): string {
  const mapped = PRISM_LANG[tag || 'plaintext'];
  if (!mapped || mapped === 'plain') return 'plain';
  return (Prism.languages as Record<string, unknown>)[mapped] ? mapped : 'plain';
}

/**
 * Language tags we claim to highlight but cannot. Exported for the unit
 * test that asserts this map never again names a grammar that is not
 * there.
 */
export function unhighlightablePrismTags(): string[] {
  return Object.entries(PRISM_LANG)
    .filter(([, grammar]) => grammar !== 'plain' && !(Prism.languages as Record<string, unknown>)[grammar])
    .map(([tag]) => tag)
    .sort();
}

/** Every language tag this map knows, for tests and for diagnostics. */
export function knownPrismTags(): string[] {
  return Object.keys(PRISM_LANG).sort();
}
