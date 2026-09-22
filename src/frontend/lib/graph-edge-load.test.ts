/**
 * The graph rendered empty over a database holding fifty edges.
 *
 * Nothing reported it. The canvas drew an empty grid — visually
 * identical to a project with no dependencies — `graph_snapshot`
 * answered `{nodeCount: 0}`, and the demo flagged the snapshot tool for
 * lying. The snapshot tool was correct; so was the endpoint, which
 * returned all fifty when asked directly. Only the renderer's copy was
 * empty, and only a screenshot showed it.
 *
 * Five defects in one eleven-line effect, each survivable alone:
 *
 *   1. the catch swallowed every failure — no log, no state, no message
 *   2. "already fetched" was recorded BEFORE the request, so a failure
 *      counted as a success
 *   3. the effect re-ran only on [scanStatus, root], neither of which
 *      changes while you sit on a project, so one lost fetch stayed lost
 *   4. no cancellation, so a response for a project you had left could
 *      land after one for the project you were on
 *   5. `r.json()` with no `r.ok` check — an error body is valid JSON, so
 *      `{error: …}` went straight into state where `.length` is
 *      undefined and every downstream guard silently reads false
 *
 * The component is not mounted here; the RULES are extracted and pinned,
 * because every one of these is a decision rather than a rendering
 * detail, and decisions are what regress.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/** Defect 5: only a list is a graph. */
function isGraphPayload(body: unknown): body is unknown[] {
  return Array.isArray(body);
}

/** Defect 2 + 3: a fetch counts as done only when it succeeded. */
function nextFetchedMarker(
  outcome: 'success' | 'failure',
  root: string,
): string | null {
  return outcome === 'success' ? root : null;
}

/** Defect 4: a response belongs to the project it was asked for. */
function shouldApply(responseForRoot: string, currentRoot: string | null, cancelled: boolean): boolean {
  return !cancelled && responseForRoot === currentRoot;
}

/** Defect 3: would the effect try again after a failure? */
function willRetry(markerAfterFailure: string | null, root: string, edgeCount: number): boolean {
  // The guard is: skip when we have fetched for this root AND hold edges.
  const skip = markerAfterFailure === root && edgeCount > 0;
  return !skip;
}

describe('only a list of edges is a graph', () => {
  test('an array is accepted', () => {
    assert.equal(isGraphPayload([{ source: 'a', target: 'b' }]), true);
    assert.equal(isGraphPayload([]), true);
  });

  test('an error body that happens to parse is refused', () => {
    // This is what went into state. `.length` on it is undefined, so
    // `depEdges.length === 0` reads false and the "no edges" branch is
    // never taken — the graph builder gets an object and draws nothing.
    assert.equal(isGraphPayload({ error: 'Missing or invalid capability token' }), false);
    assert.equal(isGraphPayload(null), false);
    assert.equal(isGraphPayload('[]'), false);
  });
});

describe('a failed fetch is not a completed one', () => {
  test('success records the project', () => {
    assert.equal(nextFetchedMarker('success', '/repo'), '/repo');
  });

  test('failure records nothing, so the guard cannot mistake it for done', () => {
    assert.equal(nextFetchedMarker('failure', '/repo'), null);
  });

  test('after a failure the next run tries again', () => {
    const marker = nextFetchedMarker('failure', '/repo');
    assert.equal(willRetry(marker, '/repo', 0), true);
  });

  test('after a success with edges it does not', () => {
    const marker = nextFetchedMarker('success', '/repo');
    assert.equal(willRetry(marker, '/repo', 50), false);
  });

  test('a success that returned nothing still allows a retry', () => {
    // An empty array is a legitimate answer for a project with no
    // imports, but it is indistinguishable from a lost fetch, so the
    // cheaper mistake is to allow another attempt.
    const marker = nextFetchedMarker('success', '/repo');
    assert.equal(willRetry(marker, '/repo', 0), true);
  });
});

describe('a late response is not always ours', () => {
  test('a response for the project we are on applies', () => {
    assert.equal(shouldApply('/repo/a', '/repo/a', false), true);
  });

  test('a response for a project we have left is dropped', () => {
    // The demo opens four throwaway fixtures in a row. Without this, one
    // of them lands on top of the project you are actually looking at.
    assert.equal(shouldApply('/repo/a', '/repo/b', false), false);
  });

  test('a cancelled request never applies', () => {
    assert.equal(shouldApply('/repo/a', '/repo/a', true), false);
  });

  test('nothing applies when no project is open', () => {
    assert.equal(shouldApply('/repo/a', null, false), false);
  });
});
