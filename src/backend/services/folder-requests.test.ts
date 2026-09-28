/**
 * Pending folder requests (Phase 32 A1.7c): what counts as a folder, one
 * request per folder, and taking one by the id the server gave it. The
 * "not now" memory is in the database and proven by the harness.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseReportedFolder, recordFolderRequest, listFolderRequests, takeFolderRequest, clearFolderRequests, setFolderRequestsListener } from './folder-requests';

beforeEach(() => {
  clearFolderRequests();
  setFolderRequestsListener(() => {});
});

describe('normaliseReportedFolder', () => {
  test('an absolute path, tidied lexically — nothing is read', () => {
    assert.equal(normaliseReportedFolder('/work/app-2/../app-3/'), '/work/app-3');
  });

  test('not a folder a person could have: relative, empty, NUL, absurdly long, not a string', () => {
    for (const bad of ['app-2', '', '/work/a\0b', `/${'x'.repeat(5000)}`, 42, null, undefined]) {
      assert.equal(normaliseReportedFolder(bad), null, String(bad).slice(0, 20));
    }
  });
});

describe('recordFolderRequest', () => {
  test('one request per folder; later sessions join it; the listener hears only the new request', () => {
    let heard = 0;
    setFolderRequestsListener(() => { heard++; });
    const a = recordFolderRequest({ folder: '/work/app-2', sessionId: 's1', agentType: 'claude-code' }, 1);
    const b = recordFolderRequest({ folder: '/work/app-2/', sessionId: 's2', agentType: 'codex' }, 2);
    recordFolderRequest({ folder: '/work/app-2', sessionId: 's1', agentType: 'claude-code' }, 3);
    assert.equal(a?.id, b?.id);
    assert.deepEqual(listFolderRequests().map((r) => [r.folder, r.sessionIds]), [['/work/app-2', ['s1', 's2']]]);
    assert.equal(heard, 1);
    assert.match(a!.id, /^[0-9a-f]{16}$/);
  });

  test('nothing to ask about a path that is not a folder', () => {
    assert.equal(recordFolderRequest({ folder: 'relative/path', sessionId: 's', agentType: 'x' }), null);
    assert.deepEqual(listFolderRequests(), []);
  });

  test('taken by id once; an unknown id takes nothing', () => {
    const r = recordFolderRequest({ folder: '/work/app-9', sessionId: 's', agentType: 'x' })!;
    assert.equal(takeFolderRequest('/work/app-9'), null, 'a path is not an id');
    assert.equal(takeFolderRequest(r.id)?.folder, '/work/app-9');
    assert.equal(takeFolderRequest(r.id), null);
  });
});
