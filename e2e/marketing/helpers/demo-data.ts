/**
 * Polished demo data for marketing screenshots and videos.
 *
 * Seeds realistic plans, tasks, comments, and agent sessions
 * that look like a real team using CodeTrellis in production.
 */

import type { APIRequestContext } from '@playwright/test';

const API = 'http://localhost:3001/api';

// ─────────────────────────────────────────────────
// Plan: Add JWT Authentication
// ─────────────────────────────────────────────────

export interface DemoPlan {
  uid: string;
  title: string;
  itemUids: string[];
}

export async function seedAuthPlan(
  request: APIRequestContext,
  projectPath: string,
): Promise<DemoPlan> {
  const planRes = await request.post(`${API}/plans`, {
    data: {
      title: 'Add JWT Authentication',
      description:
        'Implement JWT-based authentication with RS256 signing, refresh tokens, ' +
        'and role-based middleware. Covers login/register endpoints, token validation, ' +
        'and protected route guards.',
      projectPath,
    },
  });
  const plan = await planRes.json();

  // Add phases
  await request.post(`${API}/plans/${plan.uid}/phases`, {
    data: { title: 'Phase 1: Auth infrastructure', phase_number: 1 },
  });
  await request.post(`${API}/plans/${plan.uid}/phases`, {
    data: { title: 'Phase 2: Protected routes', phase_number: 2 },
  });
  await request.post(`${API}/plans/${plan.uid}/phases`, {
    data: { title: 'Phase 3: Integration tests', phase_number: 3 },
  });

  // Add spec doc
  await request.post(`${API}/plan-documents`, {
    data: {
      planUid: plan.uid,
      docType: 'executive',
      title: 'Auth System Design',
      body:
        '## Overview\n\n' +
        'JWT auth with RS256 signing for the API layer. Refresh tokens stored in ' +
        'httpOnly cookies, access tokens in memory.\n\n' +
        '## Key Decisions\n\n' +
        '- **RS256** over HS256 for asymmetric verification\n' +
        '- **15-minute** access token TTL, **7-day** refresh tokens\n' +
        '- Role enum: `admin | editor | viewer`\n' +
        '- Middleware pattern: `requireAuth()` and `requireRole(role)`\n\n' +
        '## Out of Scope\n\n' +
        '- OAuth2 / social login (future phase)\n' +
        '- MFA (future phase)',
    },
  });

  const itemUids: string[] = [];

  // Task 1 — done (agent completed this)
  const item1 = await request.post(`${API}/plans/${plan.uid}/items`, {
    data: {
      kind: 'action',
      title: 'Create JWT token service',
      body: 'Implement sign/verify functions using RS256. Generate key pair on first run.',
      status: 'done',
      template: 'action',
      fileSpecs: [
        { path: 'src/backend/services/auth-service.ts', action: 'create' },
        { path: 'src/backend/services/token-service.ts', action: 'create' },
      ],
    },
  });
  itemUids.push((await item1.json()).uid);

  // Task 2 — in progress (agent is working on this)
  const item2 = await request.post(`${API}/plans/${plan.uid}/items`, {
    data: {
      kind: 'action',
      title: 'Add auth middleware',
      body: 'Express middleware that validates Bearer tokens and attaches user context to req.',
      status: 'in_progress',
      template: 'action',
      fileSpecs: [
        { path: 'src/backend/middleware/auth.ts', action: 'create' },
        { path: 'src/backend/server.ts', action: 'modify' },
      ],
    },
  });
  itemUids.push((await item2.json()).uid);

  // Task 3 — pending
  const item3 = await request.post(`${API}/plans/${plan.uid}/items`, {
    data: {
      kind: 'action',
      title: 'Create login and register endpoints',
      body: 'POST /api/auth/login and POST /api/auth/register with validation.',
      status: 'pending',
      template: 'action',
      fileSpecs: [
        { path: 'src/backend/routes/auth.ts', action: 'create' },
      ],
    },
  });
  itemUids.push((await item3.json()).uid);

  // Task 4 — pending
  const item4 = await request.post(`${API}/plans/${plan.uid}/items`, {
    data: {
      kind: 'action',
      title: 'Protect existing API routes',
      body: 'Add requireAuth() to /api/project/*, /api/plans/*, and /api/terminals/*.',
      status: 'pending',
      template: 'action',
      fileSpecs: [
        { path: 'src/backend/server.ts', action: 'modify' },
      ],
    },
  });
  itemUids.push((await item4.json()).uid);

  // Task 5 — pending
  const item5 = await request.post(`${API}/plans/${plan.uid}/items`, {
    data: {
      kind: 'action',
      title: 'Add role-based access control',
      body: 'requireRole(\'admin\') guard for settings and terminal endpoints.',
      status: 'pending',
      template: 'action',
      fileSpecs: [
        { path: 'src/backend/middleware/rbac.ts', action: 'create' },
      ],
    },
  });
  itemUids.push((await item5.json()).uid);

  // Comments on the plan
  await request.post(`${API}/comments`, {
    data: {
      targetType: 'plan',
      targetUid: plan.uid,
      body: 'Use RS256 instead of HS256 — asymmetric verification is safer for distributed services.',
      commentType: 'suggestion',
      author: 'saif',
    },
  });

  await request.post(`${API}/comments`, {
    data: {
      targetType: 'plan',
      targetUid: plan.uid,
      body: 'Architecture LGTM. RS256 is the right call for multi-service auth.',
      commentType: 'approval',
      author: 'alex',
    },
  });

  // Comment on task 2 (the in-progress one)
  await request.post(`${API}/comments`, {
    data: {
      targetType: 'task',
      targetUid: itemUids[1],
      body: 'The token validation is working. Attaching user context to req.user next.',
      commentType: 'progress',
      author: 'claude-sonnet-4',
    },
  });

  return { uid: plan.uid, title: 'Add JWT Authentication', itemUids };
}

// ─────────────────────────────────────────────────
// Plan: Refactor Database Layer (for the sample-app fixture)
// ─────────────────────────────────────────────────

export async function seedRefactorPlan(
  request: APIRequestContext,
  projectPath: string,
): Promise<DemoPlan> {
  const planRes = await request.post(`${API}/plans`, {
    data: {
      title: 'Refactor Database Layer',
      description:
        'Extract raw SQL queries into a typed repository pattern. Add connection pooling ' +
        'and query logging. Affects both the Python API and the shared schema.',
      projectPath,
    },
  });
  const plan = await planRes.json();

  await request.post(`${API}/plans/${plan.uid}/phases`, {
    data: { title: 'Phase 1: Repository pattern', phase_number: 1 },
  });
  await request.post(`${API}/plans/${plan.uid}/phases`, {
    data: { title: 'Phase 2: Connection pooling', phase_number: 2 },
  });

  const itemUids: string[] = [];

  const item1 = await request.post(`${API}/plans/${plan.uid}/items`, {
    data: {
      kind: 'action',
      title: 'Create UserRepository class',
      body: 'Extract user queries from routes into a repository with typed return values.',
      status: 'done',
      template: 'action',
      fileSpecs: [
        { path: 'services/api/app/db.py', action: 'modify' },
        { path: 'services/api/app/routes/users.py', action: 'modify' },
      ],
    },
  });
  itemUids.push((await item1.json()).uid);

  const item2 = await request.post(`${API}/plans/${plan.uid}/items`, {
    data: {
      kind: 'action',
      title: 'Create OrderRepository class',
      body: 'Extract order queries with join optimization for the orders list endpoint.',
      status: 'in_progress',
      template: 'action',
      fileSpecs: [
        { path: 'services/api/app/routes/orders.py', action: 'modify' },
        { path: 'packages/web/src/OrderList.tsx', action: 'modify' },
      ],
    },
  });
  itemUids.push((await item2.json()).uid);

  const item3 = await request.post(`${API}/plans/${plan.uid}/items`, {
    data: {
      kind: 'action',
      title: 'Add connection pool with health checks',
      body: 'Configure SQLAlchemy connection pool with periodic health checks.',
      status: 'pending',
      template: 'action',
      fileSpecs: [
        { path: 'services/api/app/config.py', action: 'modify' },
        { path: 'services/api/app/db.py', action: 'modify' },
      ],
    },
  });
  itemUids.push((await item3.json()).uid);

  return { uid: plan.uid, title: 'Refactor Database Layer', itemUids };
}

// ─────────────────────────────────────────────────
// Cleanup
// ─────────────────────────────────────────────────

export async function cleanupDemoPlans(request: APIRequestContext): Promise<void> {
  const res = await request.get(`${API}/plans`);
  if (!res.ok()) return;
  const plans = await res.json();
  for (const p of plans) {
    if (
      p.title === 'Add JWT Authentication' ||
      p.title === 'Refactor Database Layer'
    ) {
      await request.delete(`${API}/plans/${p.uid}`);
    }
  }
}
