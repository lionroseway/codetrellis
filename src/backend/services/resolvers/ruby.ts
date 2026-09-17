import path from 'node:path';
import type { ResolverPlugin, ResolveContext } from './base';
import { findContainingSystem, tryExtensions } from './base';

/**
 * Ruby resolver — Phase 27.
 *
 * See [docs/PHASE-27-LANGUAGE-EXPANSION.md](../../../../docs/PHASE-27-LANGUAGE-EXPANSION.md).
 *
 * Ruby has three ways of reaching another file, and they resolve very
 * differently:
 *
 *   require_relative 'lib/ledger'   relative to THIS file — resolvable
 *   require 'json'                  load-path lookup — usually a gem
 *   User                            Rails autoloading — nothing to see
 *
 * ## The honest limitation, stated up front
 *
 * **In a Rails application, most real dependencies are invisible here.**
 * Rails autoloads by naming convention: referencing `User` loads
 * `app/models/user.rb` with no `require` anywhere. So a Rails repo will
 * show `require_relative` edges and little else, and the graph will look
 * sparser than the codebase really is.
 *
 * That is a known gap, not a bug to be surprised by later. Closing it
 * means a convention-based resolver that maps constant references to
 * `app/**` paths — real work, and a separate change. Until then the
 * absence should be read as "not yet extracted", not "not coupled".
 *
 * `require` with a project-relative path is still worth trying, because
 * plenty of non-Rails Ruby does `require './lib/thing'` or relies on a
 * `$LOAD_PATH` that includes `lib/`.
 */

const RB_EXTS = ['.rb', '.rake'] as const;

/** Ruby stdlib / common gems — never in-project, so don't probe for them. */
const STDLIB = new Set([
  'json', 'yaml', 'set', 'date', 'time', 'uri', 'net/http', 'fileutils',
  'logger', 'digest', 'openssl', 'base64', 'csv', 'stringio', 'pathname',
  'securerandom', 'singleton', 'forwardable', 'ostruct', 'erb', 'tempfile',
  'rails', 'active_record', 'active_support', 'action_controller',
  'rspec', 'minitest', 'sinatra', 'rack', 'sidekiq',
]);

function isLikelyGem(source: string): boolean {
  if (STDLIB.has(source)) return true;
  // `active_support/core_ext/...` — a gem's subpath.
  const head = source.split('/')[0];
  return STDLIB.has(head);
}

function resolve(ctx: ResolveContext): string | null {
  const { importSource, importerPath, knownFiles, systems } = ctx;
  if (!importSource) return null;

  const source = importSource.replace(/\.rb$/, '');

  // `require_relative` is the one form with unambiguous semantics:
  // relative to the requiring file, always.
  if (ctx.isRelative || source.startsWith('.')) {
    const base = path.resolve(path.dirname(importerPath), source);
    return tryExtensions(base, knownFiles, RB_EXTS);
  }

  if (isLikelyGem(source)) return null;

  // A bare `require` against a load path. The load path is a runtime
  // property we cannot see, so probe the conventional roots instead:
  // the containing gem/app root, then its `lib/` and `app/`.
  const containing = findContainingSystem(importerPath, systems);
  const roots: string[] = [];
  if (containing) {
    roots.push(containing.rootPath);
    roots.push(path.join(containing.rootPath, 'lib'));
    roots.push(path.join(containing.rootPath, 'app'));
  }
  roots.push(ctx.projectRoot, path.join(ctx.projectRoot, 'lib'), path.join(ctx.projectRoot, 'app'));

  for (const root of roots) {
    const hit = tryExtensions(path.join(root, source), knownFiles, RB_EXTS);
    if (hit) return hit;
  }

  return null;
}

export const rubyResolver: ResolverPlugin = {
  languages: ['ruby'],
  resolve,
};
