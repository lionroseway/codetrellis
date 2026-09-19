import path from 'node:path';
import type { ResolverPlugin, ResolveContext } from './base';
import { findContainingSystem, pickRepresentativeFile } from './base';

/**
 * Swift resolver — Phase 27.
 *
 * See [docs/PHASE-27-LANGUAGE-EXPANSION.md](../../../../docs/PHASE-27-LANGUAGE-EXPANSION.md).
 *
 * ## Swift imports almost nothing
 *
 * Within a module, every file sees every other file with **no import
 * statement at all**. `import` crosses a module boundary and nothing
 * else. That has two consequences worth stating plainly rather than
 * discovering later:
 *
 * 1. A single-module app — which is most iOS apps — produces essentially
 *    no internal import edges, no matter how good this resolver is. The
 *    file-to-file coupling is real but unwritten, so it is not there to
 *    read. Swift's value in the graph is its symbols and its callsites,
 *    not its import edges.
 * 2. The edges that *do* exist are module-level and therefore coarse:
 *    `import BillingCore` is one edge to a target holding fifty files.
 *
 * Pretending otherwise would mean inferring edges from type usage, which
 * needs a symbol table we do not have. Under-claiming is the honest
 * failure here.
 *
 * ## What it does resolve
 *
 * SwiftPM's layout is a hard convention enforced by the build system:
 *
 *   Package.swift
 *   Sources/<TargetName>/…        ← `import <TargetName>`
 *   Tests/<TargetName>Tests/…
 *
 * so a module name maps to a directory, and one representative file in
 * it carries the edge — the same treatment Go packages and C#
 * namespaces get.
 */

/** Apple's SDK frameworks and the common third-party modules. */
const EXTERNAL_MODULES = new Set([
  'Foundation', 'UIKit', 'AppKit', 'SwiftUI', 'Combine', 'CoreData',
  'CoreGraphics', 'CoreLocation', 'CoreImage', 'AVFoundation', 'MapKit',
  'WebKit', 'Network', 'OSLog', 'Dispatch', 'XCTest', 'Testing',
  'Swift', 'ObjectiveC', 'Darwin', 'Security', 'CryptoKit', 'StoreKit',
  'WidgetKit', 'ActivityKit', 'Charts', 'PhotosUI', 'UserNotifications',
  'Alamofire', 'SnapKit', 'RxSwift', 'Kingfisher',
]);

const SOURCE_ROOTS = ['Sources', 'Tests', 'src', ''];

function resolve(ctx: ResolveContext): string | null {
  const { importSource, importerPath, knownFiles, systems } = ctx;
  if (!importSource) return null;
  if (EXTERNAL_MODULES.has(importSource)) return null;

  const containing = findContainingSystem(importerPath, systems);
  const searchRoots = containing ? [containing.rootPath, ctx.projectRoot] : [ctx.projectRoot];

  for (const base of searchRoots) {
    for (const root of SOURCE_ROOTS) {
      const dir = path.join(base, root, importSource);
      const hit = pickRepresentativeFile(dir, knownFiles, {
        extensions: ['.swift'],
        // `Sources/BillingCore/BillingCore.swift` is the SwiftPM
        // template's own entry file, so it is the best representative
        // when it exists.
        prefer: importSource,
      });
      if (hit) return hit;
    }
  }

  return null;
}

export const swiftResolver: ResolverPlugin = {
  languages: ['swift'],
  resolve,
};
