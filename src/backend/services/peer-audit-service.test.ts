/**
 * Unit tests for the peer audit trail (Phase 19, finding 15).
 *
 * The one that matters is "never records terminal content". An audit trail
 * that copies the sensitive data is a second place to steal it from, and
 * `terminal.write` params carry keystrokes.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let tmp: string;
let audit: typeof import('./peer-audit-service');

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'peer-audit-'));
  process.env.CODETRELLIS_DATA_DIR = tmp;
  audit = await import('./peer-audit-service');
  audit._resetAuditCache();
});

afterEach(() => {
  audit._resetAuditCache();
  delete process.env.CODETRELLIS_DATA_DIR;
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
});

const entry = (over: Partial<Parameters<typeof audit.recordPeerAudit>[0]> = {}) => ({
  kind: 'terminal-access' as const,
  fingerprint: 'AA:BB',
  alias: 'Phone',
  method: 'terminal.read',
  ...over,
});

describe('recording', () => {
  test('keeps what was recorded, newest first', () => {
    audit.recordPeerAudit(entry({ method: 'terminal.list' }));
    audit.recordPeerAudit(entry({ method: 'terminal.read' }));

    const all = audit.listPeerAudit();
    assert.equal(all.length, 2);
    assert.equal(all[0].method, 'terminal.read', 'newest first — the recent entries are the interesting ones');
    assert.ok(all[0].at, 'every entry is timestamped');
  });

  test('filters by device', () => {
    audit.recordPeerAudit(entry({ fingerprint: 'AA:BB' }));
    audit.recordPeerAudit(entry({ fingerprint: 'CC:DD' }));
    assert.equal(audit.listPeerAudit({ fingerprint: 'CC:DD' }).length, 1);
  });

  test('records the alias AS IT WAS, so a rename cannot rewrite history', () => {
    audit.recordPeerAudit(entry({ alias: 'Old name' }));
    assert.equal(audit.listPeerAudit()[0].alias, 'Old name');
  });

  test('is bounded — a networked peer must not be able to fill the disk', () => {
    for (let i = 0; i < 2500; i++) audit.recordPeerAudit(entry({ method: `m${i}` }));
    const all = audit.listPeerAudit({ limit: 2000 });
    assert.ok(all.length <= 2000, `capped, got ${all.length}`);
    assert.equal(all[0].method, 'm2499', 'and it is the OLDEST that is dropped');
  });
});

describe('what must never be in it', () => {
  test('a corrupt file does not take the app down', () => {
    fs.writeFileSync(path.join(tmp, 'peer-audit.json'), 'not json at all');
    audit._resetAuditCache();
    assert.deepEqual(audit.listPeerAudit(), []);
    assert.doesNotThrow(() => audit.recordPeerAudit(entry()));
  });

  test('survives a round trip through disk', () => {
    audit.recordPeerAudit(entry({ detail: 'terminal abc' }));
    audit.flushAudit();
    audit._resetAuditCache();
    const all = audit.listPeerAudit();
    assert.equal(all.length, 1);
    assert.equal(all[0].detail, 'terminal abc');
  });
});

describe('terminalAuditDetail — what is safe to write down', () => {
  test('records which terminal, by id or index', () => {
    assert.equal(audit.terminalAuditDetail({ terminalId: 'abc123' }), 'terminal abc123');
    assert.equal(audit.terminalAuditDetail({ id: 'xyz' }), 'terminal xyz');
    assert.equal(audit.terminalAuditDetail({ index: 2 }), 'terminal #2');
  });

  test('NEVER records the payload', () => {
    // `terminal.write` params carry keystrokes. A detail field that took
    // whatever it was handed would put those in a file kept for months.
    const params = { terminalId: 't1', data: 'export AWS_SECRET_ACCESS_KEY=hunter2\n' };
    const detail = audit.terminalAuditDetail(params) ?? '';
    assert.equal(detail, 'terminal t1');
    assert.ok(!detail.includes('hunter2'), 'the payload must not reach the audit trail');
  });

  test('an id is an opaque handle — anything else in that field is stripped', () => {
    assert.equal(
      audit.terminalAuditDetail({ terminalId: 'ok-1 <script>alert(1)</script>' }),
      'terminal ok-1scriptalert1script',
    );
    assert.ok((audit.terminalAuditDetail({ terminalId: 'x'.repeat(500) }) ?? '').length < 100);
  });

  test('says nothing rather than guessing', () => {
    assert.equal(audit.terminalAuditDetail({}), undefined);
    assert.equal(audit.terminalAuditDetail({ data: 'whatever' }), undefined);
    assert.equal(audit.terminalAuditDetail({ index: NaN }), undefined);
  });
});
