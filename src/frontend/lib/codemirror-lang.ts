import type { Extension } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { go } from '@codemirror/lang-go';
import { java } from '@codemirror/lang-java';
import { php } from '@codemirror/lang-php';
import { sql } from '@codemirror/lang-sql';

/**
 * CodeTrellis language tag → CodeMirror 6 language extension.
 *
 * See [docs/PHASE-26-CODE-FIRST-SURFACE.md](../../../docs/PHASE-26-CODE-FIRST-SURFACE.md).
 *
 * Only loaded by the diff editor. The read-only inspector preview stays
 * on Prism: replacing a working component to have one fewer library is
 * not worth a regression, and CodeMirror earns its place where the diff
 * needs it.
 *
 * **A language with no CodeMirror package is not an error.** Ruby is the
 * live example — we parse it, `@codemirror/lang-ruby` does not exist on
 * the 6.x line — and the honest result is an unhighlighted diff, which is
 * still a perfectly readable diff. Falling back to a *wrong* grammar
 * would colour Ruby as JavaScript, which is worse than plain text.
 */
const LANGUAGE_EXTENSIONS: Record<string, () => Extension> = {
  typescript: () => javascript({ typescript: true, jsx: true }),
  javascript: () => javascript({ jsx: true }),
  python: () => python(),
  rust: () => rust(),
  go: () => go(),
  java: () => java(),
  php: () => php(),
  sql: () => sql(),
};

/** Extensions in the same tags the scanner uses, for file-extension lookup. */
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.php': 'php',
  '.sql': 'sql',
};

/**
 * The language extension for a tag, or `null` when we have none.
 *
 * Null rather than a default: see the note above about colouring Ruby as
 * JavaScript.
 */
export function languageExtensionFor(language: string | null | undefined): Extension | null {
  if (!language) return null;
  const factory = LANGUAGE_EXTENSIONS[language.toLowerCase()];
  return factory ? factory() : null;
}

/** Language tag for a path, when the caller only has a filename. */
export function languageForPath(filePath: string): string | null {
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) return null;
  return EXTENSION_TO_LANGUAGE[filePath.slice(dot).toLowerCase()] ?? null;
}

/** Languages the diff editor can highlight — for telling the user which cannot. */
export function highlightableLanguages(): string[] {
  return Object.keys(LANGUAGE_EXTENSIONS).sort();
}
