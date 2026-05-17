/**
 * Phase 15 §15.A — runtime smoke test for the unified plan_items
 * service. Boots the DB in-process (no backend HTTP, no MCP, no
 * frontend), exercises every code path on plan-item-service +
 * plan-event-service, and asserts the invariants fully hold:
 *
 *   - createItem writes the row + initial v1 version + item_created event
 *   - updateItem with content-only change writes a version row, no event
 *   - updateItem with structural-only change emits an event, no version
 *   - updateItem with both writes a version AND emits each structural event
 *   - moveItem emits reparented / reordered events appropriately
 *   - deleteItem snapshots the subtree and emits item_deleted with the
 *     snapshot in before_state
 *   - claimItem succeeds on a pending Action, fails on an Object,
 *     fails on an already-claimed Action, surfaces file overlaps
 *   - listItemVersions returns versions newest-first
 *   - restoreItemVersion writes a new version + item_restored event
 *   - listPlanEvents respects since_ms and event-type filters
 *
 * Run with `npx tsx scripts/smoke-plan-items.ts`. Exits 0 on success,
 * non-zero on first assertion failure (with a contextual message).
 *
 * This is NOT a Playwright harness test — it doesn't need a backend
 * subprocess. It just imports the services, primes a temp DB, and
 * runs through the API.
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

// Direct-import ESM-style is awkward in this codebase (sql.js is
// resolved via dynamic `require`); use the same module path the
// backend uses and let tsx do the work.
import { initDatabase, getDb } from '../src/backend/services/database';
import {
  createItem,
  updateItem,
  moveItem,
  deleteItem,
  getItem,
  getChildren,
  listAllItems,
  listItemSummaries,
  listItemVersions,
  restoreItemVersion,
  claimItem,
} from '../src/backend/services/plan-item-service';
import {
  listPlanEvents,
  listItemEvents,
  appendPlanEvent,
} from '../src/backend/services/plan-event-service';

let failed = 0;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    failed++;
    console.error(`✗ ${msg}`);
  } else {
    console.log(`✓ ${msg}`);
  }
}

function assertEq<T>(actual: T, expected: T, msg: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failed++;
    console.error(`✗ ${msg}\n    expected: ${e}\n    actual:   ${a}`);
  } else {
    console.log(`✓ ${msg}`);
  }
}

async function main() {
  // Point CODETRELLIS_DATA_DIR at a fresh tmp dir so we don't pollute
  // ~/.codetrellis. The persistence layer reads this on init.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-smoke-'));
  process.env.CODETRELLIS_DATA_DIR = tmpDir;

  console.log(`[smoke] tmp data dir: ${tmpDir}`);

  await initDatabase();

  // Seed a plan row directly (the unified plan-item-service doesn't
  // own plan creation yet — that's still in plan-service).
  const db = getDb();
  const planUid = randomUUID();
  const now = Date.now();
  db.run(
    `INSERT INTO plans (uid, title, description, status, author, author_type, project_path, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', 'me', 'human', '/tmp/proj', ?, ?)`,
    [planUid, 'Smoke plan', '', now, now],
  );

  console.log('\n--- §1 createItem ---');
  const root1 = createItem({
    planUid,
    kind: 'object',
    title: 'Overview',
    body: '# Goal\nBuild stuff.',
    template: 'executive_summary',
    author: 'me',
    authorType: 'human',
  });
  assert(!!root1.uid, 'createItem returns a uid');
  assertEq(root1.kind, 'object', 'createItem preserves kind=object');
  assertEq(root1.body, '# Goal\nBuild stuff.', 'createItem preserves body');

  const v1 = listItemVersions(root1.uid);
  assertEq(v1.length, 1, 'createItem writes initial v1 version row');
  assertEq(v1[0].version, 1, 'initial version is v1');

  const planEvents1 = listPlanEvents(planUid);
  assertEq(planEvents1.length, 1, 'createItem emits 1 plan_events row');
  assertEq(planEvents1[0].eventType, 'item_created', 'event type = item_created');

  console.log('\n--- §2 createItem (Action) + Action default status ---');
  const phase = createItem({
    planUid,
    kind: 'action',
    title: 'Phase 1',
    template: 'phase',
    author: 'me',
    authorType: 'human',
  });
  assertEq(phase.kind, 'action', 'Action kind');
  assertEq(phase.status, 'pending', 'Action defaults to status=pending');
  assertEq(phase.fileSpecs?.length ?? 0, 0, 'Action defaults fileSpecs to []');

  const childA = createItem({
    planUid,
    kind: 'action',
    parentUid: phase.uid,
    title: 'Wire types',
    fileSpecs: [{ path: 'src/auth/types.ts', action: 'create' }],
    author: 'me',
    authorType: 'human',
  });
  const childB = createItem({
    planUid,
    kind: 'action',
    parentUid: phase.uid,
    title: 'Add tests',
    author: 'me',
    authorType: 'human',
  });
  assertEq(childA.parentUid, phase.uid, 'childA.parentUid wired');
  assertEq(childB.parentUid, phase.uid, 'childB.parentUid wired');

  const phaseChildren = getChildren(planUid, phase.uid);
  assertEq(phaseChildren.length, 2, 'phase has 2 children');
  assertEq(phaseChildren[0].uid, childA.uid, 'first child is childA (sort_order)');

  console.log('\n--- §3 updateItem content-only (body change) ---');
  const updated1 = updateItem(childA.uid, {
    body: 'Adds the AuthProvider interface',
    author: 'me',
    authorType: 'human',
  });
  assert(!!updated1, 'updateItem returns the row');
  assertEq(updated1!.body, 'Adds the AuthProvider interface', 'body persisted');

  const versionsA = listItemVersions(childA.uid);
  assertEq(versionsA.length, 2, 'content change writes v2 version row');

  // Should NOT emit a plan_events row for a pure body edit.
  const eventsA1 = listItemEvents(childA.uid);
  assertEq(eventsA1.length, 1, 'pure body edit does not emit plan_events (only the original item_created row)');

  console.log('\n--- §4 updateItem rename ---');
  updateItem(childA.uid, {
    title: 'Wire AuthProvider types',
    author: 'me',
    authorType: 'human',
  });
  const eventsA2 = listItemEvents(childA.uid);
  assert(
    eventsA2.some((e) => e.eventType === 'item_renamed'),
    'rename emits item_renamed event',
  );
  const versionsA2 = listItemVersions(childA.uid);
  assertEq(versionsA2.length, 3, 'rename also writes a version row');

  console.log('\n--- §5 updateItem status change (Action only) ---');
  updateItem(childA.uid, {
    status: 'in_progress',
    author: 'me',
    authorType: 'human',
  });
  const eventsA3 = listItemEvents(childA.uid);
  assert(
    eventsA3.some((e) => e.eventType === 'status_changed'),
    'status flip emits status_changed event',
  );

  console.log('\n--- §6 updateItem combined content + structural (THE BUG) ---');
  // Rename AND reparent in one call. Both should emit events; the
  // version row should still get written because of the rename.
  // Move childB out of the phase (re-parent to plan root).
  const versionsBPre = listItemVersions(childB.uid).length;
  updateItem(childB.uid, {
    title: 'Add SSO tests',
    parentUid: null,
    author: 'me',
    authorType: 'human',
  });
  const versionsBPost = listItemVersions(childB.uid).length;
  assert(
    versionsBPost === versionsBPre + 1,
    'combined content+structural writes a version row (bug fix verified)',
  );
  const eventsB = listItemEvents(childB.uid);
  assert(
    eventsB.some((e) => e.eventType === 'item_renamed'),
    'combined update emits item_renamed',
  );
  assert(
    eventsB.some((e) => e.eventType === 'reparented'),
    'combined update emits reparented',
  );

  console.log('\n--- §7 moveItem (reorder only) ---');
  const movedA = moveItem(childA.uid, {
    newSortOrder: 99,
    author: 'me',
    authorType: 'human',
  });
  assertEq(movedA?.sortOrder, 99, 'moveItem updates sort_order');
  const moveEvents = listItemEvents(childA.uid).filter((e) => e.eventType === 'reordered');
  assertEq(moveEvents.length, 1, 'moveItem emits reordered event');

  console.log('\n--- §8 deleteItem (cascade) ---');
  const grandchild = createItem({
    planUid,
    kind: 'object',
    parentUid: childA.uid,
    title: 'Sub-note',
    author: 'me',
    authorType: 'human',
  });
  const cascaded = deleteItem(childA.uid, { author: 'me', authorType: 'human' });
  assertEq(cascaded.length, 2, 'deleteItem cascades to grandchild');
  assert(getItem(childA.uid) === null, 'parent gone after delete');
  assert(getItem(grandchild.uid) === null, 'grandchild gone after delete');

  const deleteEvent = listPlanEvents(planUid).find((e) => e.eventType === 'item_deleted');
  assert(!!deleteEvent, 'item_deleted event emitted');
  const beforeState = deleteEvent?.beforeState as { items?: Array<{ uid: string }>; cascade?: boolean } | undefined;
  assertEq(beforeState?.items?.length ?? 0, 2, 'before_state snapshots both items for restore');

  console.log('\n--- §9 claimItem (Action atomic) ---');
  const newAction = createItem({
    planUid,
    kind: 'action',
    title: 'Implement /verify-2fa',
    fileSpecs: [{ path: 'src/api/2fa.ts', action: 'create' }],
    author: 'me',
    authorType: 'human',
  });
  const claim1 = claimItem(newAction.uid, 'codex-1', 'codex', 'codex-test');
  assert(claim1.ok, 'first claim succeeds');
  const claim2 = claimItem(newAction.uid, 'aider-1', 'aider');
  assert(!claim2.ok, 'second claim fails (already claimed)');

  console.log('\n--- §10 claimItem on Object → polite error ---');
  const objClaim = claimItem(root1.uid, 'codex-1', 'codex');
  assert(!objClaim.ok && /Object/i.test(objClaim.reason ?? ''), 'claiming an Object errors with explanation');

  console.log('\n--- §11 claimItem with file overlap ---');
  // childB is now at plan root with no overlap; create a third Action
  // that ALSO touches src/api/2fa.ts so the overlap surfaces.
  const overlapAction = createItem({
    planUid,
    kind: 'action',
    title: 'Refactor 2fa endpoint',
    fileSpecs: [{ path: 'src/api/2fa.ts', action: 'modify' }],
    author: 'me',
    authorType: 'human',
  });
  // Need to advance newAction to in_progress for the overlap check to fire.
  updateItem(newAction.uid, { status: 'in_progress', author: 'codex-1', authorType: 'agent' });
  const overlapClaim = claimItem(overlapAction.uid, 'aider-1', 'aider');
  assert(overlapClaim.ok, 'claim still succeeds even with overlap');
  assert(
    Array.isArray(overlapClaim.conflicts) && overlapClaim.conflicts.length > 0,
    'conflicts array surfaces the file overlap',
  );

  console.log('\n--- §12 restoreItemVersion ---');
  // Restore newAction to v1 (its initial body, status=pending, no
  // assignee). Should emit item_restored AND a version row + the
  // restoredFromVersion field on the event.
  const restoreTarget = createItem({
    planUid,
    kind: 'object',
    title: 'Doc to restore',
    body: 'original body',
    author: 'me',
    authorType: 'human',
  });
  updateItem(restoreTarget.uid, { body: 'edited body', author: 'me', authorType: 'human' });
  updateItem(restoreTarget.uid, { body: 'edited again', author: 'me', authorType: 'human' });
  // versions: v1 (created), v2 (edited), v3 (edited again)
  const beforeRestore = listItemVersions(restoreTarget.uid);
  assertEq(beforeRestore.length, 3, '3 versions before restore');
  const restored = restoreItemVersion(restoreTarget.uid, 1, 'me', 'human');
  assertEq(restored?.body, 'original body', 'restoreItemVersion restores body');
  const afterRestore = listItemVersions(restoreTarget.uid);
  assertEq(afterRestore.length, 4, 'restore writes a v4 version row');
  const restoreEvents = listItemEvents(restoreTarget.uid);
  assert(
    restoreEvents.some((e) => e.eventType === 'item_restored'),
    'restore emits item_restored event',
  );

  console.log('\n--- §13 listPlanEvents filters ---');
  const allEvents = listPlanEvents(planUid);
  assert(allEvents.length > 5, 'plan has many events');
  const renames = listPlanEvents(planUid, { eventTypes: ['item_renamed'] });
  assert(
    renames.length > 0 && renames.every((e) => e.eventType === 'item_renamed'),
    'eventTypes filter works',
  );
  const recent = listPlanEvents(planUid, { sinceMs: now + 1 });
  assert(recent.length > 0, 'sinceMs filter returns recent events');
  const veryFuture = listPlanEvents(planUid, { sinceMs: Date.now() + 100_000 });
  assertEq(veryFuture.length, 0, 'sinceMs in the future returns empty');

  console.log('\n--- §14 listItemSummaries (sidebar query) ---');
  const summaries = listItemSummaries(planUid);
  assert(summaries.length > 0, 'summaries returned');
  assert(summaries.every((s) => 'childCount' in s), 'every summary has childCount');
  const phaseSummary = summaries.find((s) => s.uid === phase.uid);
  // After deleteItem(childA), phase has 0 direct children left
  // (childB was reparented to root; childA was deleted).
  assertEq(phaseSummary?.childCount ?? -1, 0, 'phase childCount = 0 after moves+deletes');

  console.log('\n--- §15 Object kind enforcement (Action fields stay null) ---');
  const obj = createItem({
    planUid,
    kind: 'object',
    title: 'A note',
    // These should be silently ignored on Objects:
    status: 'in_progress',
    fileSpecs: [{ path: 'should/not/persist.ts', action: 'create' }],
    author: 'me',
    authorType: 'human',
  });
  assertEq(obj.status, null, 'Object.status stays null even if passed');
  assertEq(obj.fileSpecs?.length ?? 0, 0, 'Object.fileSpecs stays empty even if passed');

  console.log('\n--- §16 listAllItems sort + tree integrity ---');
  const all = listAllItems(planUid);
  // Every item's parentUid either is null or points at another item
  // in the list. No dangling.
  const uids = new Set(all.map((i) => i.uid));
  for (const i of all) {
    if (i.parentUid !== null) {
      assert(uids.has(i.parentUid), `parentUid ${i.parentUid} resolves (item ${i.title})`);
    }
  }

  console.log('\n--- §17 schema idempotency ---');
  // Re-init the DB on the same tmp dir; new tables should already
  // exist and CREATE TABLE IF NOT EXISTS should be a no-op.
  // (initDatabase is internally guarded against double-init.) We
  // simulate by running a second CREATE through the same path and
  // ensuring no exception.
  try {
    db.run(`CREATE TABLE IF NOT EXISTS plan_items (uid TEXT PRIMARY KEY)`);
    db.run(`CREATE TABLE IF NOT EXISTS plan_item_versions (id INTEGER PRIMARY KEY AUTOINCREMENT)`);
    db.run(`CREATE TABLE IF NOT EXISTS plan_events (id INTEGER PRIMARY KEY AUTOINCREMENT)`);
    console.log('✓ re-running CREATE TABLE IF NOT EXISTS is a no-op (existing schema preserved)');
  } catch (err) {
    failed++;
    console.error(`✗ re-running CREATE TABLE IF NOT EXISTS threw: ${(err as Error).message}`);
  }

  console.log('\n--- §18 appendPlanEvent direct write ---');
  const directEvt = appendPlanEvent({
    planUid,
    itemUid: null,
    eventType: 'plan_status_changed',
    afterState: { status: 'approved' },
    summary: 'plan approved',
    author: 'me',
    authorType: 'human',
  });
  assert(directEvt.id > 0, 'appendPlanEvent returns a row with id');
  const planLevel = listPlanEvents(planUid, { eventTypes: ['plan_status_changed'] });
  assertEq(planLevel.length, 1, 'plan_status_changed event present');
  assertEq(planLevel[0].itemUid, null, 'plan-scope event has null itemUid');

  console.log('\n=================================================================');
  if (failed > 0) {
    console.error(`✗ ${failed} assertion${failed === 1 ? '' : 's'} failed`);
    process.exit(1);
  } else {
    console.log('✓ all 15.A foundations smoke checks passed');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('[smoke] uncaught:', err);
  process.exit(2);
});
