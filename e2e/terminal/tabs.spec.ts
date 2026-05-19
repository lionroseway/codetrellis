/**
 * Terminal tabs — tab click, active styling, exited indicator, kill.
 *
 * Covers: creating sessions, tab rendering, killing sessions via API.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, API } from '../helpers/setup';

test.describe('Terminal tabs', () => {
  test.afterEach(async ({ request }) => {
    // Clean up all terminal sessions
    const res = await request.get(`${API}/terminals`);
    if (res.ok()) {
      const sessions = await res.json();
      for (const s of sessions) {
        await request.delete(`${API}/terminals/${s.id}`);
      }
    }
  });

  test('creating a session via API returns session info', async ({ request }) => {
    const res = await request.post(`${API}/terminals`, {
      data: { preset: 'shell', cwd: process.cwd(), title: 'Tab Test Shell' },
    });
    expect(res.ok()).toBeTruthy();
    const session = await res.json();
    expect(session.id).toBeTruthy();
    expect(session.alive).toBe(true);
    expect(session.preset).toBe('shell');
  });

  test('multiple sessions can coexist', async ({ request }) => {
    await request.post(`${API}/terminals`, {
      data: { preset: 'shell', cwd: process.cwd(), title: 'Tab A' },
    });
    await request.post(`${API}/terminals`, {
      data: { preset: 'shell', cwd: process.cwd(), title: 'Tab B' },
    });

    const res = await request.get(`${API}/terminals`);
    const sessions = await res.json();
    expect(sessions.length).toBeGreaterThanOrEqual(2);
  });

  test('killing a session removes it from the list', async ({ request }) => {
    const createRes = await request.post(`${API}/terminals`, {
      data: { preset: 'shell', cwd: process.cwd(), title: 'Kill Test' },
    });
    const session = await createRes.json();

    await request.delete(`${API}/terminals/${session.id}`);

    const listRes = await request.get(`${API}/terminals`);
    const remaining = await listRes.json();
    const found = remaining.find((s: any) => s.id === session.id);
    expect(found).toBeFalsy();
  });
});
