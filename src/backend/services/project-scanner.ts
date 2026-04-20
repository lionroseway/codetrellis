import fs from 'node:fs';
import path from 'node:path';
import type { FileTreeNode } from '../../shared/types';

const ALWAYS_IGNORED = new Set([
  'node_modules', '.git', '.vite', 'dist', 'out',
  '.next', '.nuxt', '.turbo', '.cache', 'coverage',
  '__pycache__', '.pytest_cache', 'target',
]);

const LANG_MAP: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.php': 'php',
  '.json': 'json',
  '.css': 'css',
  '.html': 'html',
  '.md': 'markdown',
  '.yaml': 'yaml', '.yml': 'yaml',
};

function isSourceFile(name: string): boolean {
  return path.extname(name).toLowerCase() in LANG_MAP;
}

function getLanguage(name: string): string | undefined {
  return LANG_MAP[path.extname(name).toLowerCase()];
}

/**
 * Parse a .gitignore file into a set of directory/file patterns.
 * Handles basic patterns — not full glob, but covers common cases.
 */
function parseGitignore(gitignorePath: string): Set<string> {
  const patterns = new Set<string>();
  try {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      // Strip trailing slashes and leading slashes
      const clean = trimmed.replace(/^\//, '').replace(/\/$/, '');
      patterns.add(clean);
    }
  } catch { /* file doesn't exist or can't read */ }
  return patterns;
}

function isIgnored(name: string, gitignorePatterns: Set<string>): boolean {
  if (ALWAYS_IGNORED.has(name)) return true;
  if (name.startsWith('.')) return true;
  if (gitignorePatterns.has(name)) return true;
  return false;
}

/**
 * Recursively scans a directory and builds a FileTreeNode tree.
 * Reads .gitignore at each level and merges patterns down.
 */
export function scanDirectory(
  dirPath: string,
  parentPatterns?: Set<string>,
  maxDepth = 10,
): FileTreeNode[] {
  if (maxDepth <= 0) return [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  // Merge parent gitignore patterns with local .gitignore
  const localPatterns = parseGitignore(path.join(dirPath, '.gitignore'));
  const patterns = parentPatterns
    ? new Set([...parentPatterns, ...localPatterns])
    : localPatterns;

  const nodes: FileTreeNode[] = [];

  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    if (isIgnored(entry.name, patterns)) continue;

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      const children = scanDirectory(fullPath, patterns, maxDepth - 1);
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
