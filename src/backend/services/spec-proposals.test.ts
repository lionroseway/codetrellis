/**
 * Who is told of a proposed spec change (Phase 32 B7.3).
 *
 * A session is told when it holds a task relying on the proposal's page or
 * section at the moment of its call, once, and never when it made the
 * proposal. A task that stopped relying on the page, or relies on another
 * section, is not told; neither is anyone once the proposal is decided.
 */

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-spec-proposals-'));
process.env.CODETRELLIS_DATA_DIR = tmp;

let db: typeof import('./database');
let items: typeof import('./plan-item-service');
let links: typeof import('./spec-links-service');
let proposals: typeof import('./spec-proposals-service');
const SPEC = 'b7300000-0000-4000-8000-000000000001';
const WORK = 'b7300000-0000-4000-8000-000000000002';
const BODY = '# Invoice format\n\n## Fields\n\n- amount\n\n## Totals\n\nSum of lines.\n';
const by = { author: 't', authorType: 'human' };
let page: string;

before(async () => {
  db = await import('./database');
  await db.initDatabase();
  items = await import('./plan-item-service');
  links = await import('./spec-links-service');
  proposals = await import('./spec-proposals-service');
  const now = Date.now();
  for (const [uid, title] of [[SPEC, 'Invoicing spec'], [WORK, 'Checkout']]) {
    db.getDb().run(
      `INSERT INTO plans (uid, title, status, author, author_type, project_path, created_at, updated_at)
       VALUES (?, ?, 'in_progress', 't', 'human', ?, ?, ?)`,
      [uid, title, tmp, now, now],
    );
  }
  page = items.createItem({ planUid: SPEC, kind: 'object', title: 'Invoice format', body: BODY, ...by } as never).uid;
});

/** A task in Checkout, relying on `section` (or the whole page), held by `session`. */
function task(title: string, session: string, section?: string): string {
  const uid = items.createItem({ planUid: WORK, kind: 'action', title, ...by } as never).uid;
  links.setReliesOn(uid, [{ page, ...(section ? { section } : {}) }], by);
  assert.equal(items.claimItem(uid, 'codex', 'codex', undefined, undefined, session).ok, true);
  return uid;
}

const propose = (section: string, text: string, sessionId: string | null) =>
  proposals.proposeSpecChange({ page, section, text, why: 'Amounts are ambiguous.' }, { author: 'codex', authorType: 'mcp', sessionId });

test('a session holding a relying task is told once; one relying on another section is not', () => {
  task('Show totals', 's-fields', 'fields');
  task('Sum lines', 's-totals', 'totals');
  const p = propose('fields', '## Fields\n\n- amount\n- currency', 's-proposer');

  const told = proposals.proposalNoticeFor('s-fields', 'claude-code');
  assert.ok(told);
  assert.match(told!, /^── CodeTrellis: spec change proposed ──\n/);
  assert.match(told!, /Your task "Show totals" \(Checkout\) relies on it\./);
  assert.match(told!, new RegExp(`reply_to_spec_proposal\\("${p.uid}"`));
  assert.equal(proposals.proposalNoticeFor('s-fields', 'claude-code'), null, 'once');
  assert.equal(proposals.proposalNoticeFor('s-totals', 'cursor'), null, 'Totals is not Fields');
  assert.deepEqual(proposals.proposalReads(p.uid).map((r) => [r.sessionId, r.agentType]), [['s-fields', 'claude-code']]);
});

test('never the proposer, even when its own task relies on the page', () => {
  task('Add currency', 's-author');
  const own = propose('', `${BODY}\n## Notes\n`, 's-author');
  // Told of the earlier Fields proposal, which its whole-page reliance covers; not of its own.
  const told = proposals.proposalNoticeFor('s-author', 'codex') ?? '';
  assert.match(told, /change to § Fields/);
  assert.ok(!told.includes(own.uid));
  assert.ok(!proposals.proposalReads(own.uid).some((r) => r.sessionId === 's-author'));
});

test('a proposal made by a person reaches every relying session; one that stopped relying is not told', () => {
  const kept = task('Export invoices', 's-export');
  const dropped = task('Print invoices', 's-print');
  links.setReliesOn(dropped, [], by);
  propose('totals', '## Totals\n\nSum of lines, per currency.', null);
  assert.match(proposals.proposalNoticeFor('s-export', null) ?? '', /"Export invoices"/);
  assert.equal(proposals.proposalNoticeFor('s-print', null), null);
  void kept;
});

test('a session with no tasks, or a decided proposal, gets nothing', () => {
  assert.equal(proposals.proposalNoticeFor('s-nobody', null), null);
  task('Tax lines', 's-late', 'fields');
  db.getDb().run(`UPDATE spec_proposals SET status = 'rejected'`);
  assert.equal(proposals.proposalNoticeFor('s-late', null), null);
});

test('accepted, the relying task\'s agent is told on its next call, and the window is told which task, once', () => {
  const held = task('Format totals', 's-told', 'fields');
  const p = propose('fields', '## Fields\n\n- amount\n- vat', 's-proposer-2');
  proposals.decideProposal({ uid: p.uid, decision: 'accept' }, { author: 'Sam', authorType: 'human' });
  const told: string[][] = [];
  const notice = proposals.proposalNoticeFor('s-told', 'codex', Date.now(), (uids) => told.push(uids)) ?? '';
  assert.match(notice, /── CodeTrellis: spec changed ──/);
  assert.deepEqual(told, [[held]]);
  assert.equal(proposals.specChangedFor(held)[0].toldAt !== null, true);
  // Told once: the next call says nothing and tells the window nothing.
  proposals.proposalNoticeFor('s-told', 'codex', Date.now(), (uids) => told.push(uids));
  assert.deepEqual(told, [[held]]);
});
