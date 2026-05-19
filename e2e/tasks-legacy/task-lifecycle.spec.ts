/**
 * Legacy task API coverage — the V1 tasks endpoints that MCP tools
 * still use. Covers add task, update, claim, next-task, subtasks,
 * progress, blocked, code-reference, comments, attachments.
 */

import { test, expect } from '@playwright/test';
import { seedPlan, cleanupPlans, API, PROJECT_PATH } from '../helpers/setup';

/** Create a plan with legacy tasks via the plans API. */
async function seedLegacyPlan(request: any) {
  const planRes = await request.post(`${API}/plans`, {
    data: {
      title: 'E2E Legacy Tasks Plan',
      description: 'For testing legacy task APIs',
      projectPath: PROJECT_PATH,
    },
  });
  const plan = await planRes.json();

  // Add tasks via legacy endpoint
  const taskRes = await request.post(`${API}/plans/${plan.uid}/tasks`, {
    data: {
      description: 'First legacy task',
      affectedFiles: ['src/backend/server.ts'],
    },
  });
  const task = await taskRes.json();

  return { planUid: plan.uid, taskUid: task.uid };
}

test.describe('Legacy task APIs', () => {
  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E Legacy Tasks');
  });

  test('POST /api/plans/:uid/tasks adds a task', async ({ request }) => {
    const planRes = await request.post(`${API}/plans`, {
      data: { title: 'E2E Legacy Tasks Plan', description: '', projectPath: PROJECT_PATH },
    });
    const plan = await planRes.json();

    const res = await request.post(`${API}/plans/${plan.uid}/tasks`, {
      data: { description: 'New task via legacy API', affectedFiles: ['package.json'] },
    });
    expect(res.ok()).toBeTruthy();
    const task = await res.json();
    expect(task.uid).toBeTruthy();
  });

  test('GET /api/plans/:uid/tasks lists tasks', async ({ request }) => {
    const { planUid } = await seedLegacyPlan(request);

    const res = await request.get(`${API}/plans/${planUid}/tasks`);
    expect(res.status()).toBeLessThan(500);
  });

  test('PUT /api/plans/:uid/tasks/:taskUid updates task', async ({ request }) => {
    const { planUid, taskUid } = await seedLegacyPlan(request);

    const res = await request.put(`${API}/plans/${planUid}/tasks/${taskUid}`, {
      data: { status: 'in_progress' },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('POST claim task', async ({ request }) => {
    const { planUid, taskUid } = await seedLegacyPlan(request);

    const res = await request.post(`${API}/plans/${planUid}/tasks/${taskUid}/claim`, {
      data: { agentId: 'e2e-agent', agentType: 'test' },
    });
    expect(res.status()).toBeLessThan(500);
  });

  test('GET next-task returns available task', async ({ request }) => {
    const { planUid } = await seedLegacyPlan(request);

    const res = await request.get(`${API}/plans/${planUid}/next-task`);
    expect(res.status()).toBeLessThan(500);
    const data = await res.json();
    expect(typeof data).toBe('object');
  });

  test('GET task full context', async ({ request }) => {
    const { taskUid } = await seedLegacyPlan(request);

    const res = await request.get(`${API}/tasks/${taskUid}/full`);
    expect(res.status()).toBeLessThan(500);
  });

  test('POST task comment', async ({ request }) => {
    const { taskUid } = await seedLegacyPlan(request);

    const res = await request.post(`${API}/tasks/${taskUid}/comments`, {
      data: { body: 'Legacy task comment', kind: 'note', source: 'human' },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('GET task comments', async ({ request }) => {
    const { taskUid } = await seedLegacyPlan(request);

    const res = await request.get(`${API}/tasks/${taskUid}/comments`);
    expect(res.ok()).toBeTruthy();
    const comments = await res.json();
    expect(Array.isArray(comments)).toBe(true);
  });

  test('POST task progress', async ({ request }) => {
    const { planUid, taskUid } = await seedLegacyPlan(request);

    const res = await request.post(`${API}/tasks/${taskUid}/progress`, {
      data: { percent: 75, message: 'Almost done', planUid },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('POST task blocked', async ({ request }) => {
    const { planUid, taskUid } = await seedLegacyPlan(request);

    const res = await request.post(`${API}/tasks/${taskUid}/blocked`, {
      data: { reason: 'Missing credentials', planUid },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('POST task subtask', async ({ request }) => {
    const { planUid, taskUid } = await seedLegacyPlan(request);

    const res = await request.post(`${API}/tasks/${taskUid}/subtasks`, {
      data: { description: 'Subtask under parent', planUid },
    });
    expect(res.status()).toBeLessThan(500);
  });

  test('GET task subtasks', async ({ request }) => {
    const { taskUid } = await seedLegacyPlan(request);

    const res = await request.get(`${API}/tasks/${taskUid}/subtasks`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('POST code-reference on task', async ({ request }) => {
    const { planUid, taskUid } = await seedLegacyPlan(request);

    const res = await request.post(`${API}/plans/${planUid}/tasks/${taskUid}/code-reference`, {
      data: {
        filePath: 'src/backend/server.ts',
        startLine: 1,
        endLine: 10,
        note: 'Server bootstrap',
      },
    });
    expect(res.status()).toBeLessThan(500);
  });

  test('POST task attachment', async ({ request }) => {
    const { taskUid } = await seedLegacyPlan(request);

    const res = await request.post(`${API}/tasks/${taskUid}/attachments`, {
      data: { kind: 'url', label: 'Docs', value: 'https://example.com' },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('GET task attachments', async ({ request }) => {
    const { taskUid } = await seedLegacyPlan(request);

    const res = await request.get(`${API}/tasks/${taskUid}/attachments`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });
});
