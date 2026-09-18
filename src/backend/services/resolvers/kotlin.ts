import path from 'node:path';
import type { ResolverPlugin, ResolveContext } from './base';
import { findContainingSystem, pickRepresentativeFile } from './base';

/**
 * Kotlin resolver — Phase 27.
 *
 * See [docs/PHASE-27-LANGUAGE-EXPANSION.md](../../../../docs/PHASE-27-LANGUAGE-EXPANSION.md).
 *
 * Kotlin's import is Java's import with one difference that matters
 * here: **the file name is not required to match the declaration**.
 * `com.acme.billing.Invoice` is very often `Invoice.kt`, but it is just
 * as legal in `Models.kt` alongside four other classes, and top-level
 * functions have no class to be named after at all.
 *
 * So the package part is resolved as a directory — which *is* a hard
 * rule, since a Kotlin package must live in its own directory under a
 * source root for the compiler to find it in a Gradle build — and the
 * final segment is treated as a preference rather than a requirement:
 *
 *   import com.acme.billing.Invoice
 *          └──── package ────┘ └ decl ┘
 *   → <system>/src/main/kotlin/com/acme/billing/{Invoice.kt, else any .kt}
 *
 * Wildcard imports (`import com.acme.billing.*`) name the package
 * directly and are resolved the same way, with no preferred file.
 *
 * Source roots cover Gradle JVM, Gradle Android and Kotlin Multiplatform
 * layouts. `src/main/java` is included deliberately: a Kotlin file in the
 * Java source root is legal, common in codebases mid-migration, and the
 * one place a purely conventional resolver would silently miss half a
 * project.
 */

const SOURCE_ROOTS = [
  'src/main/kotlin',
  'src/main/java',
  'src/test/kotlin',
  'src/test/java',
  // Kotlin Multiplatform
  'src/commonMain/kotlin',
  'src/jvmMain/kotlin',
  'src/androidMain/kotlin',
  'src/iosMain/kotlin',
  'src/commonTest/kotlin',
  // Plain / script layouts
  'src',
  '',
];

/**
 * The Kotlin and Java standard libraries plus the ecosystem's ubiquitous
 * external packages. These are dependencies, not project files.
 */
const EXTERNAL_PREFIXES = [
  'kotlin', 'kotlinx', 'java', 'javax', 'jakarta', 'android', 'androidx',
  'org.jetbrains', 'org.junit', 'org.gradle', 'com.google', 'io.ktor',
  'org.springframework', 'dagger', 'retrofit2', 'okhttp3',
];

function isExternal(importSource: string): boolean {
  return EXTERNAL_PREFIXES.some(
    (prefix) => importSource === prefix || importSource.startsWith(prefix + '.'),
  );
}

const EXTENSIONS = ['.kt', '.kts'] as const;

function resolve(ctx: ResolveContext): string | null {
  const { importSource, importerPath, knownFiles, systems } = ctx;
  if (!importSource) return null;
  if (isExternal(importSource)) return null;

  const containing = findContainingSystem(importerPath, systems);
  if (!containing) return null;

  const segments = importSource.split('.').filter(Boolean);
  if (segments.length === 0) return null;

  const last = segments[segments.length - 1];
  // A capitalised final segment is a declaration name (`Invoice`); a
  // lower-case one is almost always another package segment. Kotlin has
  // no rule here, only a convention as strong as any in the language.
  const looksLikeDeclaration = last !== last.toLowerCase();
  const packageSegments = looksLikeDeclaration ? segments.slice(0, -1) : segments;
  if (packageSegments.length === 0) return null;

  for (const root of SOURCE_ROOTS) {
    const dir = path.join(containing.rootPath, root, ...packageSegments);
    const hit = pickRepresentativeFile(dir, knownFiles, {
      extensions: EXTENSIONS,
      prefer: looksLikeDeclaration ? last : null,
    });
    if (hit) return hit;
  }

  return null;
}

export const kotlinResolver: ResolverPlugin = {
  languages: ['kotlin'],
  resolve,
};
