import fs from 'node:fs';
import path from 'node:path';
import ignore, { type Ignore } from 'ignore';
import type { FileTreeNode } from '../../shared/types';

// Always-ignored directory names. Only used as a SAFETY FLOOR — any heavy
// non-source dir that's commonly missing from .gitignore lives here. The
// real ignore decisions come from .gitignore + .codetrellis-ignore via
// the `ignore` library, which understands globs, negation (!path), and
// nested patterns.
const ALWAYS_IGNORED = new Set([
  // JS / Node
  'node_modules',
  // Python
  '__pycache__', 'venv', 'env',
  // Rust
  'target',
  // PHP / Go vendored deps
  'vendor',
  // Go — `testdata` is the language's convention for fixture input that
  // is deliberately not valid source. Parsing it produces pure noise.
  'testdata',
]);

const LANG_MAP: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.php': 'php',
  '.rb': 'ruby',
  '.cs': 'csharp',
  '.kt': 'kotlin', '.kts': 'kotlin',
  '.swift': 'swift',
  '.json': 'json',
  '.css': 'css',
  '.scss': 'css',
  '.html': 'html',
  '.md': 'markdown',
  '.yaml': 'yaml', '.yml': 'yaml',
  '.toml': 'toml',
  '.sql': 'sql',
};

/**
 * Every language tag this scanner can attach to a file.
 *
 * Exported so the parser registry can cross-check it — see
 * `findUnparsedLanguages`. A language that is tagged here but parsed
 * nowhere renders as a file with no symbols and no edges, which looks
 * like a working scan of an empty file.
 */
export function listTaggedLanguages(): string[] {
  return [...new Set(Object.values(LANG_MAP))];
}

function isSourceFile(name: string): boolean {
  return path.extname(name).toLowerCase() in LANG_MAP;
}

function getLanguage(name: string): string | undefined {
  return LANG_MAP[path.extname(name).toLowerCase()];
}

/**
 * Build an `ignore`-library matcher from any `.gitignore` and
 * `.codetrellis-ignore` files in the directory. Returns null if the
 * directory has no ignore files (caller falls back to the parent
 * matcher).
 *
 * Why both files: `.gitignore` reflects "what isn't checked in" which
 * is usually right for analysis but sometimes too aggressive (a project
 * might gitignore `dist/` while still wanting to scan it). The
 * `.codetrellis-ignore` file lets a project add CodeTrellis-specific
 * exclusions or overrides via negation (`!some/path`).
 */
function loadIgnoreFiles(dirPath: string): Ignore | null {
  const ig = ignore();
  let any = false;
  for (const filename of ['.gitignore', '.codetrellis-ignore']) {
    const filePath = path.join(dirPath, filename);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      ig.add(content);
      any = true;
    } catch { /* file doesn't exist — skip */ }
  }
  return any ? ig : null;
}

interface ScanContext {
  /** Project root — patterns are matched relative to this. */
  root: string;
  /** Stack of ignore matchers from ancestors, root-most first. */
  matchers: Array<{ baseDir: string; ig: Ignore }>;
}

/**
 * True if the path (relative to its matcher's baseDir) is ignored by
 * any matcher on the stack. We test against every ancestor matcher
 * because nested .gitignore files apply to their subtree.
 */
function isIgnoredByPatterns(absolutePath: string, isDir: boolean, ctx: ScanContext): boolean {
  for (const { baseDir, ig } of ctx.matchers) {
    let rel = path.relative(baseDir, absolutePath);
    if (!rel || rel.startsWith('..')) continue;
    // The `ignore` library expects directory paths to end with '/'.
    if (isDir) rel = rel.replace(/\/?$/, '/');
    if (ig.ignores(rel)) return true;
  }
  return false;
}

/**
 * Recursively scans a directory and builds a FileTreeNode tree.
 * Honors .gitignore + .codetrellis-ignore at every level (proper
 * gitignore semantics including globs and negation), plus a small
 * always-ignored safety floor.
 */
export function scanDirectory(
  dirPath: string,
  parent?: ScanContext,
  maxDepth = 10,
): FileTreeNode[] {
  const ctx: ScanContext = parent ?? { root: dirPath, matchers: [] };

  if (maxDepth <= 0) return [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  // Stack on this directory's ignore matchers (if any) for its descendants.
  const localIgnore = loadIgnoreFiles(dirPath);
  const childCtx: ScanContext = localIgnore
    ? { root: ctx.root, matchers: [...ctx.matchers, { baseDir: dirPath, ig: localIgnore }] }
    : ctx;

  const nodes: FileTreeNode[] = [];

  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    // Always skip git internals and the always-ignored safety floor.
    if (entry.name === '.git') continue;
    if (entry.isDirectory() && ALWAYS_IGNORED.has(entry.name)) continue;

    const fullPath = path.join(dirPath, entry.name);

    if (isIgnoredByPatterns(fullPath, entry.isDirectory(), childCtx)) continue;

    if (entry.isDirectory()) {
      const children = scanDirectory(fullPath, childCtx, maxDepth - 1);
      if (children.length === 0) continue;

      nodes.push({
        name: entry.name,
        path: fullPath,
        type: 'directory',
        children,
      });
    } else if (isSourceFile(entry.name)) {
      nodes.push({
        name: entry.name,
        path: fullPath,
        type: 'file',
        language: getLanguage(entry.name),
      });
    }
  }

  return nodes;
}

export function countFiles(nodes: FileTreeNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.type === 'file') count++;
    if (node.children) count += countFiles(node.children);
  }
  return count;
}

/**
 * Collect all file paths from a FileTreeNode tree.
 */
export function collectFilePaths(nodes: FileTreeNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.type === 'file') paths.push(node.path);
    if (node.children) paths.push(...collectFilePaths(node.children));
  }
  return paths;
}
