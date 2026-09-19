/**
 * Kotlin imports must resolve across modules.
 *
 * The resolver searched only the importer's own system and returned null when
 * there was none. In a multi-module Gradle or Android build that is fatal
 * rather than conservative: every module directory carries its own
 * `build.gradle(.kts)`, so system-discovery emits one system per module, and
 * `:core` importing from `:data` is by definition looking outside its own
 * system. The result was that no cross-module import ever produced an edge —
 * the graph showed a set of unconnected islands for exactly the projects where
 * the connections matter most.
 *
 * Widening is safe because `pickRepresentativeFile` verifies membership of
 * `knownFiles`: a path that is not a scanned file is not a hit, so a wider
 * search finds more real edges rather than inventing any.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { kotlinResolver } from './kotlin';
import type { ResolveContext } from './base';

const ROOT = '/repo';
const dataFile = path.join(ROOT, 'data/src/main/kotlin/com/acme/data/InvoiceRepo.kt');
const coreFile = path.join(ROOT, 'core/src/main/kotlin/com/acme/core/Billing.kt');
const looseFile = path.join(ROOT, 'scripts/Tooling.kt');

/** Two Gradle modules, as system-discovery would report them. */
const systems = [
  { rootPath: path.join(ROOT, 'core'), name: 'core' },
  { rootPath: path.join(ROOT, 'data'), name: 'data' },
] as unknown as ResolveContext['systems'];

function ctx(importerPath: string, importSource: string): ResolveContext {
  return {
    importSource,
    importerPath,
    projectRoot: ROOT,
    knownFiles: new Set([dataFile, coreFile, looseFile]),
    aliasMap: [],
    systems,
  } as unknown as ResolveContext;
}

describe('Kotlin resolver across Gradle modules (M21)', () => {
  test('an import from another module resolves', () => {
    // `:core` importing `:data`. Before the fix this returned null, because
    // the search never left core/.
    const hit = kotlinResolver.resolve(ctx(coreFile, 'com.acme.data.InvoiceRepo'));
    assert.equal(hit, dataFile);
  });

  test('an import inside the importer’s own module still resolves', () => {
    const hit = kotlinResolver.resolve(ctx(dataFile, 'com.acme.data.InvoiceRepo'));
    assert.equal(hit, dataFile);
  });

  test('a file outside every module resolves through the project root', () => {
    // Returning null when there was no containing system was the same mistake
    // in a stronger form: a file that belongs to no module resolved nothing.
    const hit = kotlinResolver.resolve(ctx(looseFile, 'com.acme.data.InvoiceRepo'));
    assert.equal(hit, dataFile);
  });

  test('an import naming nothing in the project is still unresolved', () => {
    // The widened search must find more REAL files, not invent hits — which is
    // what the knownFiles membership check is for.
    assert.equal(kotlinResolver.resolve(ctx(coreFile, 'com.acme.nowhere.Missing')), null);
    assert.equal(kotlinResolver.resolve(ctx(coreFile, 'kotlinx.coroutines.flow.Flow')), null);
  });
});
