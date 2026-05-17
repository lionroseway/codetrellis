import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001/api';

test.describe('Plan system', () => {
  let planUid: string;

  test('create a plan via API', async ({ request }) => {
    const res = await request.post(`${API}/plans`, {
      data: {
        title: 'E2E Test Plan',
        description: 'Created by Playwright test',
        projectPath: '/tmp/test-project',
        tasks: [
          { description: 'First task', affectedFiles: ['src/foo.ts'] },
          { description: 'Second task', affectedFiles: ['src/bar.ts'] },
        ],
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.uid).toBeTruthy();
    expect(body.title).toBe('E2E Test Plan');
    expect(body.taskCount).toBe(2);
    expect(body.status).toBe('draft');
    planUid = body.uid;
  });

  test('list plans includes the created plan', async ({ request }) => {
    const res = await request.get(`${API}/plans`);
    const plans = await res.json();
    expect(plans.length).toBeGreaterThan(0);
    const found = plans.find((p: any) => p.title === 'E2E Test Plan');
    expect(found).toBeTruthy();
    planUid = found.uid;
  });

  test('get plan detail with tasks', async ({ request }) => {
    const res = await request.get(`${API}/plans/${planUid}`);
    const plan = await res.json();
    expect(plan.title).toBe('E2E Test Plan');
    expect(plan.tasks).toHaveLength(2);
    expect(plan.tasks[0].description).toBe('First task');
    expect(plan.tasks[0].status).toBe('pending');
  });

  test('update plan status', async ({ request }) => {
    await request.put(`${API}/plans/${planUid}`, {
      data: { status: 'approved' },
    });
    const res = await request.get(`${API}/plans/${planUid}`);
    const plan = await res.json();
    expect(plan.status).toBe('approved');
  });

  test('plan versions are tracked', async ({ request }) => {
    const res = await request.get(`${API}/plans/${planUid}/versions`);
    const versions = await res.json();
    expect(versions.length).toBeGreaterThanOrEqual(2); // initial + update
  });

  test('add comment to plan', async ({ request }) => {
    const res = await request.post(`${API}/comments`, {
      data: {
        targetType: 'plan',
        targetUid: planUid,
        body: 'E2E test comment',
        commentType: 'comment',
      },
    });
    expect(res.ok()).toBeTruthy();
    const comment = await res.json();
    expect(comment.body).toBe('E2E test comment');
  });

  test('get comments for plan', async ({ request }) => {
    const res = await request.get(`${API}/comments?target=${planUid}`);
    const comments = await res.json();
    expect(comments.length).toBeGreaterThan(0);
    expect(comments[0].body).toBe('E2E test comment');
  });

  test('get projection for plan', async ({ request }) => {
    const res = await request.get(`${API}/plans/${planUid}/projection`);
    const proj = await res.json();
    expect(proj.ghostFiles).toHaveLength(2);
    expect(proj.ghostFiles[0].path).toBe('src/foo.ts');
  });

  test('update task status', async ({ request }) => {
    const planRes = await request.get(`${API}/plans/${planUid}`);
    const plan = await planRes.json();
    const taskUid = plan.tasks[0].uid;

    await request.put(`${API}/plans/${planUid}/tasks/${taskUid}`, {
      data: { status: 'done' },
    });

    const updatedRes = await request.get(`${API}/plans/${planUid}`);
    const updated = await updatedRes.json();
    expect(updated.tasks[0].status).toBe('done');
    expect(updated.completedTaskCount).toBe(1);
  });

  test('get next task respects order', async ({ request }) => {
    const res = await request.get(`${API}/plans/${planUid}/next-task`);
    const task = await res.json();
    expect(task.description).toBe('Second task');
  });

  test('plan git context round-trips', async ({ request }) => {
    // Phase 15 §15.D — set baseRef / targetBranch / worktree /
    // autoCreateBranch via PUT, read back via GET, ensure each
    // field survives.
    await request.put(`${API}/plans/${planUid}`, {
      data: {
        baseRef: 'main',
        targetBranch: 'feat/e2e-test',
        targetWorktree: '/tmp/codetrellis-e2e-worktree',
        autoCreateBranch: true,
      },
    });
    const res = await request.get(`${API}/plans/${planUid}`);
    const plan = await res.json();
    expect(plan.baseRef).toBe('main');
    expect(plan.targetBranch).toBe('feat/e2e-test');
    expect(plan.targetWorktree).toBe('/tmp/codetrellis-e2e-worktree');
    expect(plan.autoCreateBranch).toBe(true);

    // Clearing one field with null leaves the others intact.
    await request.put(`${API}/plans/${planUid}`, {
      data: { targetWorktree: null },
    });
    const res2 = await request.get(`${API}/plans/${planUid}`);
    const plan2 = await res2.json();
    expect(plan2.targetWorktree).toBeNull();
    expect(plan2.baseRef).toBe('main');
  });

  test('archive plan', async ({ request }) => {
    await request.delete(`${API}/plans/${planUid}`);
    const res = await request.get(`${API}/plans/${planUid}`);
    const plan = await res.json();
    expect(plan.status).toBe('archived');
  });
});
