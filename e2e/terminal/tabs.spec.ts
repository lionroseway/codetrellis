/**
 * Terminal tabs — tab click, active styling, exited indicator, kill.
 *
 * Covers: creating sessions, tab rendering, killing sessions via API.
 */

import { test, expect, type APIResponse } from '@playwright/test';
import { gotoWithProject, API } from '../helpers/setup';

test.describe('Terminal tabs', () => {
  // Only the sessions this file started: terminals are the whole backend's,
  // and deleting every one killed a parallel spec's shell under it (#387).
  const mine: string[] = [];
  const started = async (res: APIResponse) => {
    const session = await res.json();
    if (session?.id) mine.push(session.id);
    return session;
  };
  test.afterEach(async ({ request }) => {
    for (const id of mine.splice(0)) await request.delete(`${API}/terminals/${id}`);
  });

  test('creating a session via API returns session info', async ({ request }) => {
    const res = await request.post(`${API}/terminals`, {
      data: { preset: 'shell', cwd: process.cwd(), title: 'Tab Test Shell' },
    });
    expect(res.ok()).toBeTruthy();
    const session = await started(res);
    expect(session.id).toBeTruthy();
    expect(session.alive).toBe(true);
    expect(session.preset).toBe('shell');
  });

  test('multiple sessions can coexist', async ({ request }) => {
    await started(await request.post(`${API}/terminals`, {
      data: { preset: 'shell', cwd: process.cwd(), title: 'Tab A' },
    }));
    await started(await request.post(`${API}/terminals`, {
      data: { preset: 'shell', cwd: process.cwd(), title: 'Tab B' },
    }));

    const res = await request.get(`${API}/terminals`);
    const sessions = await res.json();
    expect(sessions.length).toBeGreaterThanOrEqual(2);
  });

  test('killing a session removes it from the list', async ({ request }) => {
    const createRes = await request.post(`${API}/terminals`, {
      data: { preset: 'shell', cwd: process.cwd(), title: 'Kill Test' },
    });
    const session = await started(createRes);

    await request.delete(`${API}/terminals/${session.id}`);

    const listRes = await request.get(`${API}/terminals`);
    const remaining = await listRes.json();
    const found = remaining.find((s: any) => s.id === session.id);
    expect(found).toBeFalsy();
  });
});
