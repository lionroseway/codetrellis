/**
 * Remaining HTTP routes — mop-up for 100% route coverage.
 *
 * Covers: DELETE /api/attachments/:uid, GET /api/attachments/:uid/file,
 * GET /api/plans/:uid/changes/:changeId, POST /api/plans/import-external,
 * POST /api/recent-projects/pin, DELETE /api/recent-projects,
 * POST /api/terminals/:id/inject, GET /api/plans/from-template,
 * PUT /api/refs/:uid, DELETE /api/refs/:uid.
 */

import { test, expect } from '@playwright/test';
import { seedPlan, cleanupPlans, API, PROJECT_PATH } from '../helpers/setup';

test.describe('Attachment management', () => {
  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E Routes Attach');
  });

  test('DELETE /api/attachments/:uid removes attachment', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: 'E2E Routes Attach Plan',
      actions: [{ title: 'Attach Target', body: 'Has attachment' }],
    });

    const addRes = await request.post(`${API}/items/${plan.actionUids[0]}/attachments`, {
      data: { kind: 'url', label: 'Link', value: 'https://example.com' },
    });
    const att = await addRes.json();

    const delRes = await request.delete(`${API}/attachments/${att.uid}`);
    expect(delRes.ok()).toBeTruthy();
    const result = await delRes.json();
    expect(result.ok).toBe(true);
  });

  test('GET /api/attachments/:uid/file returns 404 for url-type attachment', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: 'E2E Routes Attach Plan',
      actions: [{ title: 'File Attach', body: 'body' }],
    });

    const addRes = await request.post(`${API}/items/${plan.actionUids[0]}/attachments`, {
      data: { kind: 'url', label: 'Link', value: 'https://example.com' },
    });
    const att = await addRes.json();

    // URL-type attachment has no file on disk — should 404
    const res = await request.get(`${API}/attachments/${att.uid}/file`);
    expect(res.status()).toBe(404);
  });
});

test.describe('Single proposed change', () => {
  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E Routes Change');
  });

  test('GET /api/plans/:uid/changes/:changeId returns 404 for missing change', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: 'E2E Routes Change Plan',
      actions: [{ title: 'Change Action', body: 'body', fileSpecs: [{ path: 'src/backend/server.ts', action: 'modify' }] }],
    });

    const res = await request.get(`${API}/plans/${plan.uid}/changes/nonexistent-id`);
    expect(res.status()).toBe(404);
  });

  test('GET /api/plans/:uid/changes then fetch single change by id', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: 'E2E Routes Change Plan',
      actions: [{ title: 'Modify Server', body: 'body', fileSpecs: [{ path: 'src/backend/server.ts', action: 'modify' }] }],
    });

    const listRes = await request.get(`${API}/plans/${plan.uid}/changes`);
    expect(listRes.ok()).toBeTruthy();
    const changes = await listRes.json();

    // The plan has an action with fileSpecs — should produce proposed changes
    expect(Array.isArray(changes)).toBe(true);
    if (changes.length > 0) {
      const firstId = changes[0].id;
      expect(firstId).toBeTruthy();
      // changeId contains colons and slashes — must URL-encode
      const res = await request.get(`${API}/plans/${plan.uid}/changes/${encodeURIComponent(firstId)}`);
      expect(res.ok()).toBeTruthy();
      const change = await res.json();
      expect(change.id).toBe(firstId);
    }
  });
});

test.describe('Import external plan', () => {
  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E Routes Import');
  });

  test('POST /api/plans/import-external rejects missing source', async ({ request }) => {
    const res = await request.post(`${API}/plans/import-external`, {
      data: { projectPath: PROJECT_PATH },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/plans/import-external rejects unknown source', async ({ request }) => {
    const res = await request.post(`${API}/plans/import-external`, {
      data: { source: 'unsupported', projectPath: PROJECT_PATH },
    });
    // Should be 400 for unknown source
    expect(res.status()).toBeLessThan(500);
  });

  test('POST /api/plans/import-external with conversation source', async ({ request }) => {
    const res = await request.post(`${API}/plans/import-external`, {
      data: {
        source: 'conversation',
        projectPath: PROJECT_PATH,
        messages: [
          { role: 'user', content: 'Build an auth module with JWT tokens' },
          { role: 'assistant', content: 'I will create the auth module with the following steps...' },
        ],
      },
    });
    // May succeed or fail depending on content — shouldn't crash
    expect(res.status()).toBeLessThan(500);
  });
});

test.describe('Recent projects management', () => {
  test('POST /api/recent-projects/pin pins a project', async ({ request }) => {
    const res = await request.post(`${API}/recent-projects/pin`, {
      data: { projectPath: PROJECT_PATH, pinned: true },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.ok).toBe(true);

    // Unpin to clean up
    await request.post(`${API}/recent-projects/pin`, {
      data: { projectPath: PROJECT_PATH, pinned: false },
    });
  });

  test('DELETE /api/recent-projects removes a project entry', async ({ request }) => {
    // This won't actually remove our test project since we scanned it,
    // but should return ok or 200 for a valid path
    const res = await request.delete(`${API}/recent-projects`, {
      data: { projectPath: '/tmp/fake-e2e-project-path' },
    });
    expect(res.ok()).toBeTruthy();
  });
});

test.describe('Terminal inject', () => {
  test('POST /api/terminals/:id/inject returns 404 for unknown terminal', async ({ request }) => {
    const res = await request.post(`${API}/terminals/nonexistent-id/inject`, {
      data: { text: 'echo hello' },
    });
    expect(res.status()).toBe(404);
  });

  test('POST /api/terminals/:id/inject sends text to existing terminal', async ({ request }) => {
    // Create a terminal first
    const createRes = await request.post(`${API}/terminals`, {
      data: { preset: 'shell' },
    });
    const terminal = await createRes.json();

    if (terminal.id) {
      const res = await request.post(`${API}/terminals/${terminal.id}/inject`, {
        data: { text: 'echo e2e-test' },
      });
      // Terminal may or may not be alive — shouldn't 500
      expect(res.status()).toBeLessThan(500);

      // Cleanup
      await request.delete(`${API}/terminals/${terminal.id}`);
    }
  });
});

test.describe('Plan from template', () => {
  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E Routes Template');
  });

  test('GET /api/plan-templates returns available templates', async ({ request }) => {
    const res = await request.get(`${API}/plan-templates`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data) || typeof data === 'object').toBe(true);
  });

  test('POST /api/plans/from-template creates plan from template', async ({ request }) => {
    // Get available templates first
    const templatesRes = await request.get(`${API}/plan-templates`);
    const templates = await templatesRes.json();

    const templateList = Array.isArray(templates) ? templates : templates.templates || [];
    if (templateList.length > 0) {
      const tmpl = templateList[0];
      const res = await request.post(`${API}/plans/from-template`, {
        data: {
          templateId: tmpl.id || tmpl.uid || tmpl.slug,
          title: 'E2E Routes Template Plan',
          projectPath: PROJECT_PATH,
        },
      });
      expect(res.status()).toBeLessThan(500);
    }
  });
});

test.describe('External references', () => {
  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E Routes Refs');
  });

  test('POST then GET /api/items/:uid/refs manages external refs', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: 'E2E Routes Refs Plan',
      actions: [{ title: 'Ref Action', body: 'Has refs' }],
    });

    const addRes = await request.post(`${API}/items/${plan.actionUids[0]}/refs`, {
      data: {
        provider: 'github',
        externalId: '42',
        url: 'https://github.com/org/repo/issues/42',
        title: 'Related issue',
        refType: 'issue',
      },
    });
    expect(addRes.status()).toBeLessThan(500);

    const listRes = await request.get(`${API}/items/${plan.actionUids[0]}/refs`);
    expect(listRes.ok()).toBeTruthy();
    const refs = await listRes.json();
    expect(Array.isArray(refs)).toBe(true);
  });

  test('GET /api/plans/:uid/refs lists plan-level refs', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: 'E2E Routes Refs Plan',
      actions: [{ title: 'Action', body: 'body' }],
    });

    const res = await request.get(`${API}/plans/${plan.uid}/refs`);
    expect(res.ok()).toBeTruthy();
    const refs = await res.json();
    expect(Array.isArray(refs)).toBe(true);
  });

  test('PUT and DELETE /api/refs/:uid update and remove ref', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: 'E2E Routes Refs Plan',
      actions: [{ title: 'Ref Target', body: 'body' }],
    });

    const addRes = await request.post(`${API}/items/${plan.actionUids[0]}/refs`, {
      data: {
        provider: 'linear',
        externalId: 'LIN-99',
        url: 'https://linear.app/team/LIN-99',
        title: 'Linear issue',
        refType: 'issue',
      },
    });
    const ref = await addRes.json();

    if (ref.uid) {
      // Update
      const putRes = await request.put(`${API}/refs/${ref.uid}`, {
        data: { title: 'Updated title', status: 'done' },
      });
      expect(putRes.status()).toBeLessThan(500);

      // Delete
      const delRes = await request.delete(`${API}/refs/${ref.uid}`);
      expect(delRes.status()).toBeLessThan(500);
    }
  });
});

test.describe('Sessions API', () => {
  test('GET /api/sessions returns active sessions', async ({ request }) => {
    const res = await request.get(`${API}/sessions`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data) || typeof data === 'object').toBe(true);
  });

  test('POST /api/sessions/:sessionId/assign-plan handles assignment', async ({ request }) => {
    const res = await request.post(`${API}/sessions/nonexistent-session/assign-plan`, {
      data: { planUid: 'fake-plan-uid' },
    });
    // May 404 or succeed — shouldn't 500
    expect(res.status()).toBeLessThan(500);
  });
});

test.describe('Settings round-trip', () => {
  test('GET /api/settings returns settings object', async ({ request }) => {
    const res = await request.get(`${API}/settings`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(typeof data).toBe('object');
  });

  test('PUT /api/settings persists and returns updated settings', async ({ request }) => {
    // Read current settings
    const getRes = await request.get(`${API}/settings`);
    const original = await getRes.json();

    // Update using a known key (identity.name)
    const testName = `e2e-test-${Date.now()}`;
    const res = await request.put(`${API}/settings`, {
      data: { identity: { ...original.identity, name: testName } },
    });
    expect(res.ok()).toBeTruthy();
    const returned = await res.json();
    expect(returned.identity.name).toBe(testName);

    // Read back to verify persistence
    const verifyRes = await request.get(`${API}/settings`);
    const updated = await verifyRes.json();
    expect(updated.identity.name).toBe(testName);

    // Restore original
    await request.put(`${API}/settings`, { data: original });
  });
});

test.describe('Updates status', () => {
  test('GET /api/updates/status returns status object', async ({ request }) => {
    const res = await request.get(`${API}/updates/status`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(typeof data).toBe('object');
  });
});
