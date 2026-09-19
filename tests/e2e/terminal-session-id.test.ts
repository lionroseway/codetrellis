/**
 * The identifier `terminal_create` returns is the one the next tool wants.
 *
 * `createTerminal` returns a session keyed `id`; `terminal_write`,
 * `terminal_read`, `terminal_kill`, `terminal_resize` and `terminal_focus`
 * all take `session_id`. An agent reads the create response, passes back
 * what it found, and gets "expected string, received undefined". Found by
 * driving the packaged app — it caught me out doing exactly that.
 */

import { test, expect } from '@playwright/test';
import { setupHarness } from '../harness';

test.describe('Terminal session ids', () => {
  test.setTimeout(120_000);

  test('create returns session_id, and it drives the other tools', async () => {
    const h = await setupHarness('terminal-session-id');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      // Command execution is off on a fresh install — see Phase 30.
      await h.client.grantMcpCapabilities(['read', 'write', 'project', 'files', 'terminal']);
      const agent = await h.spawnAgent({ agentType: 'claude-code', model: 'opus-4-7' });

      const created = await agent.callTool('terminal_create', {
        cwd: h.fixture.projectPath,
        title: 'id-check',
        focus: false,
      });
      expect(created.isError).not.toBe(true);
      const session = JSON.parse(created.text) as { session_id?: string; id?: string };

      expect(session.session_id, 'create must answer with the key the other tools ask for').toBeTruthy();
      // `id` is kept so anything already reading it still works.
      expect(session.id).toBe(session.session_id);

      // The round trip that used to fail: feed the create response straight
      // back in, with no renaming.
      const wrote = await agent.callTool('terminal_write', {
        session_id: session.session_id,
        input: 'echo codetrellis-session-id-ok\n',
      });
      expect(wrote.isError, `terminal_write refused: ${wrote.text.slice(0, 160)}`).not.toBe(true);

      await new Promise((r) => setTimeout(r, 1500));
      const read = await agent.callTool('terminal_read', { session_id: session.session_id, lines: 40 });
      expect(read.isError).not.toBe(true);
      expect(read.text).toContain('codetrellis-session-id-ok');

      // And the listing answers in the same shape.
      const listed = await agent.callTool('terminal_list', {});
      const sessions = JSON.parse(listed.text) as Array<{ session_id?: string; id?: string }>;
      const mine = sessions.find((s) => s.id === session.id);
      expect(mine?.session_id, 'terminal_list must answer in the same shape as create').toBe(session.id);

      const killed = await agent.callTool('terminal_kill', { session_id: session.session_id });
      expect(killed.isError).not.toBe(true);
    } finally {
      await h.teardown();
    }
  });
});
