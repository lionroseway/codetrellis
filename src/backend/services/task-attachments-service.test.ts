/**
 * Attachments: where a stored value may be read from, and what a plan file
 * may say about one (Phase 31 §4.2).
 *
 * A plan file arrives through `git pull` from anyone who can push to the
 * repository, so these are the rules for untrusted input.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-attachments-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });

let db: typeof import('./database');
let att: typeof import('./task-attachments-service');

const ITEM = 'a77a0000-0000-4000-8000-000000000001';
const OTHER = 'a77a0000-0000-4000-8000-000000000002';

before(async () => {
  db = await import('./database');
  await db.initDatabase();
  att = await import('./task-attachments-service');
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('resolveAttachmentLocation', () => {
  test('an upload resolves inside this item\'s own folder, not the data directory', () => {
    const loc = att.resolveAttachmentLocation(`userdata://attachments/${ITEM}/shot.png`, ITEM, null);
    assert.equal(loc?.root, path.join(process.env.CODETRELLIS_DATA_DIR!, 'attachments', ITEM));
    assert.equal(loc?.rel, 'shot.png');
  });

  test('an upload value naming another item, or the wider data directory, resolves to nothing', () => {
    assert.equal(att.resolveAttachmentLocation(`userdata://attachments/${OTHER}/shot.png`, ITEM, null), null);
    assert.equal(att.resolveAttachmentLocation('userdata://capability-token', ITEM, null), null);
    assert.equal(att.resolveAttachmentLocation('userdata://data.db', ITEM, null), null);
  });

  test('a relative path resolves only against a trusted project root', () => {
    assert.deepEqual(att.resolveAttachmentLocation('out/report.xlsx', ITEM, '/repo'), { root: '/repo', rel: 'out/report.xlsx' });
    assert.equal(att.resolveAttachmentLocation('out/report.xlsx', ITEM, null), null);
  });

  test('absolute paths and URLs are not served', () => {
    assert.equal(att.resolveAttachmentLocation(path.join(os.homedir(), '.ssh', 'id_ed25519'), ITEM, '/repo'), null);
    assert.equal(att.resolveAttachmentLocation('file:///etc/passwd', ITEM, '/repo'), null);
  });

  test('the served type comes from the extension', () => {
    assert.equal(att.servedContentType('a/b.PNG'), 'image/png');
    assert.equal(att.servedContentType('a/b.mov'), 'video/quicktime');
    assert.equal(att.servedContentType('a/b.html'), null);
    assert.equal(att.servedContentType('a/b'), null);
  });
});

describe('validateImportedAttachment — a plan file is untrusted input', () => {
  const ok = (r: ReturnType<typeof att.validateImportedAttachment>) => {
    assert.ok(!('refused' in r), 'refused' in r ? r.refused : '');
    return r as Exclude<typeof r, { refused: string }>;
  };
  const refused = (r: ReturnType<typeof att.validateImportedAttachment>) => assert.ok('refused' in r);

  test('ordinary attachments round-trip', () => {
    assert.equal(ok(att.validateImportedAttachment({ kind: 'file_ref', value: 'src/index.ts' }, ITEM)).value, 'src/index.ts');
    assert.equal(ok(att.validateImportedAttachment({ kind: 'url', value: 'https://example.com/pr/1' }, ITEM)).kind, 'url');
    assert.equal(
      ok(att.validateImportedAttachment({ kind: 'image', value: `userdata://attachments/${ITEM}/a.png`, contentType: 'image/png' }, ITEM)).contentType,
      'image/png',
      'your own export, re-imported, still shows its screenshots',
    );
    ok(att.validateImportedAttachment({ kind: 'code_block', value: 'const x = 1;' }, ITEM));
  });

  test('paths outside the project, and other items\' uploads, are refused', () => {
    refused(att.validateImportedAttachment({ kind: 'file_ref', value: '/home/someone/.aws/credentials' }, ITEM));
    refused(att.validateImportedAttachment({ kind: 'file_ref', value: '../../outside.txt' }, ITEM));
    refused(att.validateImportedAttachment({ kind: 'image', value: 'userdata://capability-token' }, ITEM));
    refused(att.validateImportedAttachment({ kind: 'image', value: `userdata://attachments/${OTHER}/a.png` }, ITEM));
    refused(att.validateImportedAttachment({ kind: 'image', value: `userdata://attachments/${ITEM}/../../data.db` }, ITEM));
  });

  test('script URLs, unknown kinds and stated content types are not taken on trust', () => {
    refused(att.validateImportedAttachment({ kind: 'url', value: 'javascript:alert(1)' }, ITEM));
    refused(att.validateImportedAttachment({ kind: 'executable', value: 'x' }, ITEM));
    assert.equal(ok(att.validateImportedAttachment({ kind: 'file_ref', value: 'a.png', contentType: 'text/html' }, ITEM)).contentType, null);
  });
});

describe('upsertAttachment never re-homes', () => {
  test('a uid owned by another item is left alone', () => {
    const base = {
      uid: 'a77a0000-1111-4000-8000-000000000001', targetType: 'item' as const, kind: 'file_ref' as const,
      author: 't', authorType: 'human', createdAt: Date.now(),
    };
    assert.equal(att.upsertAttachment({ ...base, targetUid: ITEM, value: 'mine.txt' }), true);
    assert.equal(att.upsertAttachment({ ...base, targetUid: OTHER, value: 'stolen.txt' }), false);
    const row = db.getDb().exec(`SELECT target_uid, value FROM attachments WHERE uid = ?`, [base.uid])[0].values[0];
    assert.deepEqual(row, [ITEM, 'mine.txt']);
    assert.equal(att.upsertAttachment({ ...base, targetUid: ITEM, value: 'renamed.txt' }), true, 'its own item may update it');
  });
});
