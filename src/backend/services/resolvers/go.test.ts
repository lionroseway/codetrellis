/**
 * A Go module path does not have to contain a dot.
 *
 * The resolver short-circuited on "no dot in the first segment = stdlib"
 * BEFORE consulting the module index, justified by "every module path is
 * domain-prefixed". That is a convention of published modules, not a rule
 * of the language: `go mod init billing` is legal, `go build` is happy,
 * and it is what internal repositories that never intend to publish
 * actually do.
 *
 * The consequence was total and silent — a project whose own `go.mod`
 * declares a dotless module resolved NONE of its own imports, so the
 * graph showed every Go file as an island. Nothing errored; there was
 * simply an absence of edges, which looks the same as a project that has
 * none.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { goResolver } from './go';
import type { ResolveContext } from './base';

const ROOT = '/repo';
const ledger = path.join(ROOT, 'internal/ledger/ledger.go');
const cmd = path.join(ROOT, 'cmd/api/main.go');

function ctx(
  importSource: string,
  modulePath: string,
  rootPath: string = ROOT,
): ResolveContext {
  return {
    importSource,
    importerPath: cmd,
    projectRoot: ROOT,
    knownFiles: new Set([ledger, cmd]),
    aliasMap: [],
    systems: [
      { rootPath, name: 'api', manifestKind: 'go.mod', packageName: modulePath },
    ],
  } as unknown as ResolveContext;
}

describe('Go resolver and dotless module paths (m13)', () => {
  test('a dotless declared module resolves its own imports', () => {
    // `module billing` + `import "billing/internal/ledger"`. Before the
    // fix: null, because `billing` has no dot.
    assert.equal(goResolver.resolve(ctx('billing/internal/ledger', 'billing')), ledger);
  });

  test('a domain-prefixed module still resolves', () => {
    assert.equal(
      goResolver.resolve(ctx('github.com/org/billing/internal/ledger', 'github.com/org/billing')),
      ledger,
    );
  });

  test('a real stdlib import still resolves to nothing', () => {
    // Removing the dot test must not start inventing edges. It does not,
    // because the index is the authority: no declared module claims
    // `net/http`, so there is nothing to resolve against.
    for (const std of ['fmt', 'net/http', 'encoding/json', 'os']) {
      assert.equal(goResolver.resolve(ctx(std, 'billing')), null, std);
    }
  });

  test('a third-party import no module declares is still unresolved', () => {
    assert.equal(
      goResolver.resolve(ctx('github.com/stretchr/testify/assert', 'billing')),
      null,
    );
  });

  test('a prefix match with no known file in the directory resolves to nothing', () => {
    // The module claims the prefix but the package was never scanned —
    // a wider search must not manufacture a path.
    assert.equal(goResolver.resolve(ctx('billing/internal/nowhere', 'billing')), null);
  });
});
