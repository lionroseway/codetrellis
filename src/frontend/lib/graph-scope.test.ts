/**
 * An absolute scope path blanked the graph, permanently.
 *
 * `graph-builder` filters edges by comparing against `sourceRelative` /
 * `targetRelative`, which are project-relative. The graph toolbar sends a
 * relative path and always worked. `graph_set_scope` over MCP sends an
 * absolute one — the natural thing for an agent holding a real path —
 * and `'services/api/x.ts'.startsWith('/Users/…/services/')` is never
 * true, so every edge was filtered out.
 *
 * And it stayed blank. "Clearing" the scope by setting it back to the
 * project root is also absolute, so the reset filtered everything out
 * too. The graph stayed empty for the rest of the session with no error,
 * no log, and a canvas visually identical to a project with no
 * dependencies.
 *
 * It took: a screenshot to see the canvas was blank rather than the
 * snapshot tool lying, the web build to read the console, and a probe
 * that set the scope four ways to find which one did it.
 *
 * The rule is pinned here rather than in the store so it can be read
 * without mounting anything.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = '/Users/dev/work/sample-app';

/** The normalisation `graph-store.setScopePath` applies. */
function normaliseScope(scopePath: string | null, root: string | null): string | null {
  if (!scopePath) return null;
  let next = scopePath;
  if (root && next.startsWith(root)) {
    next = next.slice(root.length).replace(/^[/\\]+/, '');
  }
  next = next.replace(/^[./\\]+/, '').replace(/[/\\]+$/, '');
  return next === '' ? null : next;
}

describe('a scope is always stored project-relative', () => {
  test('an absolute subtree becomes relative', () => {
    assert.equal(normaliseScope(`${ROOT}/services`, ROOT), 'services');
    assert.equal(normaliseScope(`${ROOT}/services/notifier`, ROOT), 'services/notifier');
  });

  test('a relative path is left alone', () => {
    assert.equal(normaliseScope('services', ROOT), 'services');
    assert.equal(normaliseScope('services/notifier', ROOT), 'services/notifier');
  });

  test('the project root itself means no scope', () => {
    // This is the reset. Stored as a prefix it filters against the empty
    // string and matches nothing, which is how "clearing" the scope left
    // the graph emptier than before.
    assert.equal(normaliseScope(ROOT, ROOT), null);
    assert.equal(normaliseScope(`${ROOT}/`, ROOT), null);
  });

  test('empty and null both mean no scope', () => {
    assert.equal(normaliseScope('', ROOT), null);
    assert.equal(normaliseScope(null, ROOT), null);
  });

  test('a trailing slash does not change the subtree', () => {
    assert.equal(normaliseScope(`${ROOT}/services/`, ROOT), 'services');
    assert.equal(normaliseScope('services/', ROOT), 'services');
  });

  test('a leading ./ is stripped', () => {
    assert.equal(normaliseScope('./services', ROOT), 'services');
  });

  test('with no project open the path is left as given', () => {
    // Nothing to make it relative TO. Better to pass it through than to
    // invent a root and silently scope to the wrong subtree.
    assert.equal(normaliseScope('services', null), 'services');
  });

  test('a path outside the project is not mangled into one inside it', () => {
    // It will match nothing, and the canvas now says so rather than
    // rendering an empty graph.
    assert.equal(normaliseScope('/somewhere/else/lib', ROOT), 'somewhere/else/lib');
  });
});
