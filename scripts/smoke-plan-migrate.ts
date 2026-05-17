/**
 * Phase 15 §15.B — runtime smoke test for the plan migrator.
 *
 * Boots the DB in-process, seeds a realistic legacy-shape plan
 * (plan + plan_documents + plan_phases + tasks + subtasks +
 * attachments + comments), runs the migrator in dry-run, then for
 * real, then a third time to prove idempotency.
 *
 * Asserts:
 *   - Dry-run reports correct counts but writes nothing.
 *   - Write actually inserts plan_items + backfills events.
 *   - Uids preserved (attachments + comments still resolve).
 *   - Doc nesting (parent_doc_uid) survives the migration.
 *   - Subtask nesting (parent_task_uid) survives.
 *   - Phase tasks land under the phase via parent_uid.
 *   - target_type retargeted: 'task' / 'plan_doc' → 'item'.
 *   - Re-running migrator → 0 new rows, all skipped.
 *   - Synthetic plan_events have the *original* timestamps, not the
 *     migration-time timestamp.
 *   - Phase body composes scope + prereqs + acceptance + git checkpoint.
 *
 * Run with `npm run smoke:plan-migrate`. Exits 0 on success.
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

import { initDatabase, getDb } from '../src/backend/services/database';
import { getItem, listAllItems } from '../src/backend/services/plan-item-service';
import { listPlanEvents, listItemEvents } from '../src/backend/services/plan-event-service';
import { migratePlan } from '../src/backend/services/plan-migrate-service';

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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-migrate-'));
  process.env.CODETRELLIS_DATA_DIR = tmpDir;
  console.log(`[smoke-migrate] tmp dir: ${tmpDir}`);

  await initDatabase();
  const db = getDb();

  // --- Seed a realistic legacy plan ---------------------------------------
  console.log('\n--- §1 seed legacy DB shape (pre-V2) ---');

  const planUid = randomUUID();
  const t0 = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days ago

  db.run(
    `INSERT INTO plans (uid, title, description, status, author, author_type, project_path, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', ?, 'human', '/tmp/proj', ?, ?)`,
    [planUid, 'Add 2FA to login', 'Spec for 2FA rollout', 'me', t0, t0],
  );

  // Two top-level docs + one nested under "Architecture"
  const docArchUid = randomUUID();
  const docDataUid = randomUUID();
  const docOverviewUid = randomUUID();

  db.run(
    `INSERT INTO plan_documents (uid, plan_uid, doc_type, title, body, version, author, author_type, order_hint, parent_doc_uid, created_at, updated_at)
     VALUES (?, ?, 'executive_summary', 'Overview', '# Goal\nShip 2FA.', 1, 'me', 'human', '00', NULL, ?, ?)`,
    [docOverviewUid, planUid, t0, t0],
  );
  db.run(
    `INSERT INTO plan_documents (uid, plan_uid, doc_type, title, body, version, author, author_type, order_hint, parent_doc_uid, created_at, updated_at)
     VALUES (?, ?, 'architecture', 'Architecture', '# Components', 1, 'me', 'human', '01', NULL, ?, ?)`,
    [docArchUid, planUid, t0, t0],
  );
  db.run(
    `INSERT INTO plan_documents (uid, plan_uid, doc_type, title, body, version, author, author_type, order_hint, parent_doc_uid, created_at, updated_at)
     VALUES (?, ?, 'architecture', 'Data model', '# Users table', 1, 'me', 'human', '01.1', ?, ?, ?)`,
    [docDataUid, planUid, docArchUid, t0, t0],
  );

  // Two phases
  const phase1Uid = randomUUID();
  const phase2Uid = randomUUID();
  db.run(
    `INSERT INTO plan_phases (uid, plan_uid, phase_number, title, scope, prerequisites, git_checkpoint, acceptance_criteria, status, created_at, updated_at)
     VALUES (?, ?, 1, 'Foundation', 'Backend models + endpoints.', 'Auth is JWT-based.', 'v1.0-pre-2fa', '- [ ] Routes return 200', 'in_progress', ?, ?)`,
    [phase1Uid, planUid, t0 + 1000, t0 + 1000],
  );
  db.run(
    `INSERT INTO plan_phases (uid, plan_uid, phase_number, title, scope, prerequisites, git_checkpoint, acceptance_criteria, status, created_at, updated_at)
     VALUES (?, ?, 2, 'Migration', 'Move existing users to 2FA-enrolled.', '', NULL, '', 'pending', ?, ?)`,
    [phase2Uid, planUid, t0 + 2000, t0 + 2000],
  );

  // Tasks: one in phase 1, one subtask of that, one unphased
  const taskWireUid = randomUUID();
  const taskWireSubUid = randomUUID();
  const taskUnphasedUid = randomUUID();

  db.run(
    `INSERT INTO tasks (uid, plan_uid, sort_order, description, status, assignee, assignee_type, assignee_model,
                         affected_files, affected_symbols, new_connections, removed_connections, dependencies,
                         file_spec, symbol_specs, phase_uid, parent_task_uid, body, prompt, scope_path, file_specs,
                         progress_percent, blocked_reason, created_at, updated_at)
     VALUES (?, ?, 0, 'Wire types', 'in_progress', 'codex', 'agent', 'codex-test',
             '["src/auth/types.ts"]', '[]', '[]', '[]', '[]',
             NULL, '[]', ?, NULL, 'Adds AuthProvider', 'Build out the types', 'src/auth/',
             '[{"path":"src/auth/types.ts","action":"create"}]', 50, NULL, ?, ?)`,
    [taskWireUid, planUid, phase1Uid, t0 + 3000, t0 + 3000],
  );
  db.run(
    `INSERT INTO tasks (uid, plan_uid, sort_order, description, status, affected_files, affected_symbols,
                         new_connections, removed_connections, dependencies, file_spec, symbol_specs,
                         phase_uid, parent_task_uid, file_specs, created_at, updated_at)
     VALUES (?, ?, 0, 'Sub: validate input', 'pending', '[]', '[]', '[]', '[]', '[]', NULL, '[]',
             NULL, ?, '[]', ?, ?)`,
    [taskWireSubUid, planUid, taskWireUid, t0 + 4000, t0 + 4000],
  );
  db.run(
    `INSERT INTO tasks (uid, plan_uid, sort_order, description, status, affected_files, affected_symbols,
                         new_connections, removed_connections, dependencies, file_spec, symbol_specs,
                         phase_uid, parent_task_uid, file_specs, created_at, updated_at)
     VALUES (?, ?, 0, 'Cleanup unused imports', 'pending', '[]', '[]', '[]', '[]', '[]', NULL, '[]',
             NULL, NULL, '[]', ?, ?)`,
    [taskUnphasedUid, planUid, t0 + 5000, t0 + 5000],
  );

  // Attachments: one on a task (legacy target_type='task'), one on a doc
  const attTaskUid = randomUUID();
  const attDocUid = randomUUID();
  db.run(
    `INSERT INTO attachments (uid, target_type, target_uid, kind, value, label, content_type, author, author_type, created_at)
     VALUES (?, 'task', ?, 'url', 'https://design.example/2fa', 'Spec', NULL, 'me', 'human', ?)`,
    [attTaskUid, taskWireUid, t0 + 6000],
  );
  db.run(
    `INSERT INTO attachments (uid, target_type, target_uid, kind, value, label, content_type, author, author_type, created_at)
     VALUES (?, 'plan_doc', ?, 'url', 'https://rfc.example/2fa', 'RFC', NULL, 'me', 'human', ?)`,
    [attDocUid, docArchUid, t0 + 6500],
  );

  // Comments: one task-scoped (legacy target_type='task'), one plan-scoped (stays 'plan')
  const cmtTaskUid = randomUUID();
  const cmtPlanUid = randomUUID();
  db.run(
    `INSERT INTO comments (uid, target_type, target_uid, parent_uid, author, author_type, body, comment_type, kind, source, metadata, created_at)
     VALUES (?, 'task', ?, NULL, 'codex', 'agent', 'Halfway through.', 'status_update', 'progress', 'agent', '{"progressPercent":50}', ?)`,
    [cmtTaskUid, taskWireUid, t0 + 7000],
  );
  db.run(
    `INSERT INTO comments (uid, target_type, target_uid, parent_uid, author, author_type, body, comment_type, kind, source, metadata, created_at)
     VALUES (?, 'plan', ?, NULL, 'me', 'human', 'Approving this plan.', 'approval', NULL, 'human', NULL, ?)`,
    [cmtPlanUid, planUid, t0 + 7500],
  );

  console.log('[smoke-migrate] seeded: 1 plan, 3 docs, 2 phases, 3 tasks (1 subtask), 2 attachments, 2 comments');

  // --- §2 Dry-run reports counts but doesn't write ---
  console.log('\n--- §2 dry-run reports counts but writes nothing ---');
  const before = listAllItems(planUid).length;
  assertEq(before, 0, 'no plan_items before migration');

  const dry = migratePlan(planUid, { dryRun: true });
  assertEq(dry.objectsCreated, 3, 'dry-run counts 3 Objects');
  assertEq(dry.phaseActionsCreated, 2, 'dry-run counts 2 phase Actions');
  assertEq(dry.taskActionsCreated, 3, 'dry-run counts 3 task Actions');

  const afterDry = listAllItems(planUid).length;
  assertEq(afterDry, 0, 'dry-run did NOT write any plan_items');

  const eventsAfterDry = listPlanEvents(planUid);
  assertEq(eventsAfterDry.length, 0, 'dry-run did NOT emit events');

  // --- §3 Real migration ---
  console.log('\n--- §3 write run actually persists ---');
  const live = migratePlan(planUid, { dryRun: false });
  assertEq(live.objectsCreated, 3, 'live: 3 Objects');
  assertEq(live.phaseActionsCreated, 2, 'live: 2 phase Actions');
  assertEq(live.taskActionsCreated, 3, 'live: 3 task Actions');
  assertEq(live.docReparented, 1, 'live: Data model nested under Architecture');
  assertEq(live.subtaskReparented, 1, 'live: subtask nested under Wire types');
  assertEq(live.attachmentsRetargeted, 2, 'live: 2 attachments retargeted to item');
  assertEq(live.commentsRetargeted, 1, 'live: 1 comment retargeted (task-only)');
  assertEq(live.syntheticEvents, 8, 'live: 8 synthetic item_created events (3+2+3)');
  assertEq(live.skipped, 0, 'live: nothing skipped on first pass');

  // --- §4 Uid preservation ---
  console.log('\n--- §4 uids preserved end-to-end ---');
  const overview = getItem(docOverviewUid);
  assert(!!overview, 'docOverviewUid resolves in plan_items');
  assertEq(overview!.kind, 'object', 'overview is Object');
  assertEq(overview!.template, 'executive_summary', 'template = doc_type');

  const archDoc = getItem(docArchUid);
  assertEq(archDoc!.parentUid, null, 'Architecture is top-level');

  const dataDoc = getItem(docDataUid);
  assertEq(dataDoc!.parentUid, docArchUid, 'Data model nested under Architecture');

  const phase1 = getItem(phase1Uid);
  assert(!!phase1, 'phase1 resolves');
  assertEq(phase1!.kind, 'action', 'phase is Action');
  assertEq(phase1!.template, 'phase', 'template = phase');
  assertEq(phase1!.status, 'in_progress', 'phase status preserved');
  assert(phase1!.body.includes('## Scope'), 'phase body has Scope section');
  assert(phase1!.body.includes('Backend models'), 'phase body preserves scope text');
  assert(phase1!.body.includes('Auth is JWT-based.'), 'phase body has prerequisites');
  assert(phase1!.body.includes('## Acceptance criteria'), 'phase body has acceptance');
  assert(phase1!.body.includes('v1.0-pre-2fa'), 'phase body preserves git_checkpoint');

  const wireTask = getItem(taskWireUid);
  assertEq(wireTask!.kind, 'action', 'wire task is Action');
  assertEq(wireTask!.parentUid, phase1Uid, 'wire task bound to phase 1');
  assertEq(wireTask!.status, 'in_progress', 'task status preserved');
  assertEq(wireTask!.assignee, 'codex', 'task assignee preserved');
  assertEq(wireTask!.progressPercent, 50, 'task progressPercent preserved');
  assertEq(
    wireTask!.fileSpecs?.[0]?.path,
    'src/auth/types.ts',
    'task fileSpecs preserved',
  );

  const subtask = getItem(taskWireSubUid);
  assertEq(subtask!.parentUid, taskWireUid, 'subtask nested under wire task');

  const unphased = getItem(taskUnphasedUid);
  assertEq(unphased!.parentUid, null, 'unphased task is top-level');

  // --- §5 attachments + comments retargeted but uids preserved ---
  console.log('\n--- §5 attachments + comments retarget cleanly ---');
  const attTaskRow = db.exec(
    `SELECT target_type, target_uid FROM attachments WHERE uid = ?`,
    [attTaskUid],
  );
  assertEq((attTaskRow[0]?.values[0]?.[0] as string), 'item', 'task attachment retargeted to item');
  assertEq((attTaskRow[0]?.values[0]?.[1] as string), taskWireUid, 'attachment still points at the same uid');

  const attDocRow = db.exec(
    `SELECT target_type FROM attachments WHERE uid = ?`,
    [attDocUid],
  );
  assertEq((attDocRow[0]?.values[0]?.[0] as string), 'item', 'doc attachment retargeted to item');

  const cmtTaskRow = db.exec(
    `SELECT target_type FROM comments WHERE uid = ?`,
    [cmtTaskUid],
  );
  assertEq((cmtTaskRow[0]?.values[0]?.[0] as string), 'item', 'task comment retargeted to item');

  const cmtPlanRow = db.exec(
    `SELECT target_type FROM comments WHERE uid = ?`,
    [cmtPlanUid],
  );
  assertEq((cmtPlanRow[0]?.values[0]?.[0] as string), 'plan', 'plan-level comment stays plan');

  // --- §6 Synthetic events have original timestamps ---
  console.log('\n--- §6 synthetic events carry original timestamps ---');
  const wireTaskEvents = listItemEvents(taskWireUid);
  const created = wireTaskEvents.find((e) => e.eventType === 'item_created');
  assert(!!created, 'wire task has item_created event');
  assertEq(created!.createdAt, t0 + 3000, 'event uses original created_at, not migration-time');

  const allEvents = listPlanEvents(planUid);
  // Sort ascending — should match seed order in source data.
  const earliest = Math.min(...allEvents.map((e) => e.createdAt));
  assert(earliest <= t0 + 3000, 'earliest synthetic event is in the past (legacy timestamp)');

  // --- §7 Idempotency — second run no-ops ---
  console.log('\n--- §7 re-running migrator no-ops ---');
  const second = migratePlan(planUid, { dryRun: false });
  assertEq(second.objectsCreated, 0, 'second run: 0 new Objects');
  assertEq(second.phaseActionsCreated, 0, 'second run: 0 new phase Actions');
  assertEq(second.taskActionsCreated, 0, 'second run: 0 new task Actions');
  assertEq(second.skipped, 8, 'second run: 8 rows skipped (3+2+3)');

  const totalEventsAfterSecond = listPlanEvents(planUid).length;
  // Should be the same as after the first run — no double-emission.
  assertEq(totalEventsAfterSecond, 8, 'no duplicate events on re-run');

  // --- §8 Tree integrity post-migration ---
  console.log('\n--- §8 tree integrity ---');
  const all = listAllItems(planUid);
  assertEq(all.length, 8, 'plan has 8 items total');
  for (const item of all) {
    if (item.parentUid !== null) {
      assert(
        all.some((p) => p.uid === item.parentUid),
        `parent_uid ${item.parentUid} resolves (item: ${item.title})`,
      );
    }
    assert(!!item.migratedFrom, `item ${item.title} has migrated_from`);
  }

  console.log('\n=================================================================');
  if (failed > 0) {
    console.error(`✗ ${failed} assertion${failed === 1 ? '' : 's'} failed`);
    process.exit(1);
  } else {
    console.log('✓ all 15.B migrator smoke checks passed');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('[smoke-migrate] uncaught:', err);
  process.exit(2);
});
