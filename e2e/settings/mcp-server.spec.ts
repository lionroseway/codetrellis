/**
 * Settings MCP server — port input, autodetect toggle, config snippet.
 *
 * Covers: port input, autodetect checkbox, config snippet with Copy button.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { gotoWithProject, API } from '../helpers/setup';

const OUT = path.join('test-results', 'ux-audit');

test.describe('Settings MCP server', () => {
  test('MCP Server section shows port input', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'MCP Server' }).click();
    await page.waitForTimeout(300);

    // Port input should show 19432 or similar
    const portInput = page.locator('input[type="number"]');
    await expect(portInput).toBeVisible({ timeout: 3000 });
  });

  test('autodetect checkbox is visible', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'MCP Server' }).click();
    await page.waitForTimeout(300);

    await expect(page.getByText('Autodetect on collision').first()).toBeVisible({ timeout: 3000 });
  });

  test('config snippet shows JSON with Copy button', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'MCP Server' }).click();
    await page.waitForTimeout(300);

    // Config snippet in a pre block
    const preBlock = page.locator('pre');
    await expect(preBlock.first()).toBeVisible({ timeout: 3000 });

    // Copy button nearby
    await expect(page.locator('button:has-text("Copy")').first()).toBeVisible();
  });

  test('MCP status API returns port info', async ({ request }) => {
    const res = await request.get(`${API}/mcp/status`);
    expect(res.ok()).toBeTruthy();
    const status = await res.json();
    expect(status.port).toBeTruthy();
  });

  test('default port is 19432', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'MCP Server' }).click();
    await page.waitForTimeout(300);

    await expect(page.getByText('19432').first()).toBeVisible({ timeout: 3000 });
  });
});

/**
 * Phase 31 §6.1 — "Add to Claude Desktop". The file work is main-process
 * only (unit-tested in claude-desktop-config.test.ts); here the page is
 * driven against a stand-in for that IPC, to prove the person sees the diff
 * before anything is written and that a stale preview is shown again.
 */
test.describe('Add to Claude Desktop', () => {
  const openMcp = async (page: import('@playwright/test').Page) => {
    await gotoWithProject(page);
    await page.locator('button[title*="Settings"]').click();
    await page.getByRole('button', { name: 'MCP Server' }).click();
  };

  test('is not offered outside the desktop app', async ({ page }) => {
    await openMcp(page);
    await expect(page.getByTestId('mcp-config-snippet')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /Add to Claude Desktop/ })).toHaveCount(0);
  });

  test('shows the change first, writes only on Add, and re-shows a file that changed underneath', async ({ page }) => {
    // The button needs a connector to offer. CI's checkout never builds one
    // (`npm run build:connector`), and the entry itself is main's business,
    // so the setup this page reads is given one.
    await page.route('**/api/mcp/setup', async (route) => {
      const response = await route.fetch();
      const setup = await response.json();
      setup.connector ??= {
        command: '/Applications/CodeTrellis.app/Contents/MacOS/CodeTrellis',
        args: ['/Applications/CodeTrellis.app/Contents/Resources/connector/mcp-connector.cjs'],
        env: { ELECTRON_RUN_AS_NODE: '1' },
        config: { codetrellis: { command: '/Applications/CodeTrellis.app/Contents/MacOS/CodeTrellis' } },
        claudeCodeCommand: 'claude mcp add codetrellis -- /Applications/CodeTrellis.app/Contents/MacOS/CodeTrellis',
      };
      await route.fulfill({ response, json: setup });
    });
    await page.addInitScript(() => {
      const calls: string[] = [];
      let previews = 0;
      (window as unknown as { __cdCalls: string[] }).__cdCalls = calls;
      (window as unknown as { electronAPI: unknown }).electronAPI = {
        claudeDesktop: {
          preview: async () => {
            calls.push('preview');
            previews += 1;
            return {
              ok: true, status: 'add', exists: true, path: '/Users/me/Library/Application Support/Claude/claude_desktop_config.json',
              beforeHash: previews === 1 ? 'a'.repeat(64) : 'b'.repeat(64),
              diff: [{ op: ' ', text: '{' }, { op: '+', text: `  "codetrellis": { "command": "/Applications/CodeTrellis.app" }${previews > 1 ? ' ' : ''}` }, { op: ' ', text: '}' }],
            };
          },
          apply: async (hash: string) => {
            calls.push(`apply:${hash[0]}`);
            return hash === 'a'.repeat(64)
              ? { ok: false, changed: true, reason: "Claude Desktop's config changed after you looked at it. Here is the change again, against the file as it is now." }
              : { ok: true, status: 'add', path: '/x/claude_desktop_config.json', backupPath: '/x/claude_desktop_config.before-codetrellis-1.json' };
          },
        },
      };
    });
    await openMcp(page);
    const panel = page.getByTestId('add-to-claude-desktop');
    await panel.getByRole('button', { name: 'Add to Claude Desktop…' }).click();
    await expect(panel.getByText('claude_desktop_config.json', { exact: false }).first()).toBeVisible();
    await expect(panel.getByTestId('claude-desktop-diff')).toContainText('+   "codetrellis"');
    expect(await page.evaluate(() => (window as unknown as { __cdCalls: string[] }).__cdCalls)).toEqual(['preview']);

    // The file changed after the preview: nothing written, the new diff shown.
    await panel.getByRole('button', { name: 'Add to Claude Desktop', exact: true }).click();
    await expect(panel.getByText(/changed after you looked at it/)).toBeVisible();
    await panel.getByRole('button', { name: 'Add to Claude Desktop', exact: true }).click();
    await expect(panel.getByText(/Added\. Quit and reopen Claude Desktop/)).toBeVisible();
    await expect(panel.getByText(/before-codetrellis-1\.json/)).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __cdCalls: string[] }).__cdCalls)).toEqual(['preview', 'apply:a', 'preview', 'apply:b']);
  });
});

/**
 * Phase 32 A3.4 — the parallel skill and the optional hook for Claude Code.
 * Main-process file work is unit-tested (claude-code-parallel.test.ts); here
 * the page runs against a stand-in for that IPC, to prove the person sees
 * both changes, the skill is ticked and the hook is not, and only what is
 * ticked is sent — each with the hash of the file that was shown.
 */
test.describe('Add parallel work to Claude Code', () => {
  const openMcp = async (page: import('@playwright/test').Page) => {
    await gotoWithProject(page);
    await page.locator('button[title*="Settings"]').click();
    await page.getByRole('button', { name: 'MCP Server' }).click();
  };

  test('is not offered outside the desktop app', async ({ page }) => {
    await openMcp(page);
    await expect(page.getByTestId('mcp-config-snippet')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /parallel work to Claude Code/ })).toHaveCount(0);
  });

  test('shows both changes, writes only what is ticked, and says when either is already there', async ({ page }) => {
    await page.addInitScript(() => {
      const calls: string[] = [];
      let installed = false;
      (window as unknown as { __ccCalls: string[] }).__ccCalls = calls;
      const item = (p: string, text: string) => ({ path: p, status: 'add', exists: false, beforeHash: p.endsWith('SKILL.md') ? 's'.repeat(64) : 'h'.repeat(64), diff: [{ op: '+', text }] });
      (window as unknown as { electronAPI: unknown }).electronAPI = {
        claudeCode: {
          preview: async () => {
            calls.push('preview');
            const skill = item('/Users/me/.claude/skills/codetrellis-parallel/SKILL.md', 'name: codetrellis-parallel');
            const hook = { ...item('/Users/me/.claude/settings.json', '"command": "… mcp-connector.cjs --hook pre-tool-use"'), status: 'update', exists: true };
            return { ok: true, dir: '/Users/me/.claude', skill: installed ? { ...skill, status: 'unchanged', diff: [] } : skill, hook };
          },
          apply: async (choice: Record<string, string>) => {
            calls.push(`apply:${Object.entries(choice).map(([k, v]) => `${k}=${v[0]}`).join(',')}`);
            installed = true;
            return { ok: true, skill: { path: '/Users/me/.claude/skills/codetrellis-parallel/SKILL.md', backupPath: null, status: 'add' } };
          },
        },
      };
    });
    await openMcp(page);
    const panel = page.getByTestId('add-to-claude-code');
    await panel.getByRole('button', { name: 'Add parallel work to Claude Code…' }).click();

    const skill = panel.getByTestId('claude-code-skill');
    const hook = panel.getByTestId('claude-code-hook');
    await expect(skill.getByText('.claude/skills/codetrellis-parallel/SKILL.md', { exact: false })).toBeVisible();
    await expect(panel.getByTestId('claude-code-skill-diff')).toContainText('+ name: codetrellis-parallel');
    await expect(panel.getByTestId('claude-code-hook-diff')).toContainText('--hook pre-tool-use');
    await expect(hook.getByText(/never approves an edit, and holds one only where you have set a breakpoint/)).toBeVisible();
    // The skill is offered ticked; the hook runs before every edit, so it is opt-in.
    await expect(skill.getByRole('checkbox')).toBeChecked();
    await expect(hook.getByRole('checkbox')).not.toBeChecked();
    fs.mkdirSync(OUT, { recursive: true });
    await panel.screenshot({ path: path.join(OUT, 'claude-code-parallel.png') });

    // Nothing ticked, nothing to write.
    await skill.getByRole('checkbox').uncheck();
    await expect(panel.getByRole('button', { name: 'Add to Claude Code' })).toBeDisabled();
    await skill.getByRole('checkbox').check();
    await panel.getByRole('button', { name: 'Add to Claude Code' }).click();
    await expect(panel.getByText(/Added the skill\. Claude Code picks them up in its next session\./)).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __ccCalls: string[] }).__ccCalls)).toEqual(['preview', 'apply:skill=s']);

    // Shown again, the skill is there; only the hook is still on offer.
    await panel.getByRole('button', { name: 'Add parallel work to Claude Code…' }).click();
    await expect(skill.getByText('Already added, and up to date.')).toBeVisible();
    await expect(skill.getByRole('checkbox')).toBeDisabled();
    await hook.getByRole('checkbox').check();
    await panel.getByRole('button', { name: 'Add to Claude Code' }).click();
    expect(await page.evaluate(() => (window as unknown as { __ccCalls: string[] }).__ccCalls)).toEqual(['preview', 'apply:skill=s', 'preview', 'apply:hook=h']);
  });
});

/**
 * Phase 32 A8.3 — the breakpoint hook for Gemini CLI. Main-process file work
 * is unit-tested (gemini-cli-hook.test.ts); here the page runs against a
 * stand-in for that IPC, to prove the person sees the change, nothing is
 * ticked for them, only the hash of the file shown is sent, and a file that
 * changed underneath is shown again rather than written.
 */
test.describe('Add breakpoints to Gemini CLI', () => {
  const openMcp = async (page: import('@playwright/test').Page) => {
    await gotoWithProject(page);
    await page.locator('button[title*="Settings"]').click();
    await page.getByRole('button', { name: 'MCP Server' }).click();
  };

  test('is not offered outside the desktop app', async ({ page }) => {
    await openMcp(page);
    await expect(page.getByTestId('mcp-config-snippet')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /breakpoints to Gemini CLI/ })).toHaveCount(0);
  });

  test('shows the change, is opt-in, re-shows a file that changed, and says when it is there', async ({ page }) => {
    await page.addInitScript(() => {
      const calls: string[] = [];
      let round = 0;
      (window as unknown as { __gmCalls: string[] }).__gmCalls = calls;
      (window as unknown as { electronAPI: unknown }).electronAPI = {
        geminiCli: {
          preview: async () => {
            calls.push('preview');
            if (round >= 2) return { ok: true, dir: '/Users/me/.gemini', path: '/Users/me/.gemini/settings.json', status: 'unchanged', diff: [], beforeHash: 'c'.repeat(64), exists: true };
            return {
              ok: true, dir: '/Users/me/.gemini', path: '/Users/me/.gemini/settings.json', status: 'update', exists: true,
              beforeHash: (round === 0 ? 'a' : 'b').repeat(64),
              diff: [{ op: ' ', text: '  "theme": "Dracula",' }, { op: '+', text: '  "hooks": { "BeforeTool": [ { "matcher": "^(write_file|replace)$", … "--hook gemini-before-tool" } ] }' }],
            };
          },
          apply: async (hash: string) => {
            calls.push(`apply:${hash[0]}`);
            round += 1;
            if (round === 1) return { ok: false, changed: true, reason: "Gemini CLI's settings.json changed after you looked at it. Here is the change again, against the file as it is now." };
            return { ok: true, path: '/Users/me/.gemini/settings.json', backupPath: '/Users/me/.gemini/settings.before-codetrellis-2026.json', status: 'update' };
          },
        },
      };
    });
    await openMcp(page);
    const panel = page.getByTestId('add-to-gemini-cli');
    await panel.getByRole('button', { name: 'Add breakpoints to Gemini CLI…' }).click();

    const hook = panel.getByTestId('gemini-cli-hook');
    await expect(hook.getByText('/Users/me/.gemini/settings.json')).toBeVisible();
    await expect(panel.getByTestId('gemini-cli-hook-diff')).toContainText('--hook gemini-before-tool');
    await expect(hook.getByText(/holds the edit until you answer\. It never approves an edit/)).toBeVisible();
    // It runs before every edit, so nothing is ticked for the person.
    await expect(hook.getByRole('checkbox')).not.toBeChecked();
    await expect(panel.getByRole('button', { name: 'Add to Gemini CLI' })).toBeDisabled();
    fs.mkdirSync(OUT, { recursive: true });
    await panel.screenshot({ path: path.join(OUT, 'gemini-cli-hook.png') });

    // The file changed after it was shown: nothing written, the change shown again, unticked.
    await hook.getByRole('checkbox').check();
    await panel.getByRole('button', { name: 'Add to Gemini CLI' }).click();
    await expect(panel.getByText(/changed after you looked at it/)).toBeVisible();
    await expect(hook.getByRole('checkbox')).not.toBeChecked();

    await hook.getByRole('checkbox').check();
    await panel.getByRole('button', { name: 'Add to Gemini CLI' }).click();
    await expect(panel.getByText(/Added the hook\. Gemini CLI picks it up in its next session\. The previous file is kept as/)).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __gmCalls: string[] }).__gmCalls)).toEqual(['preview', 'apply:a', 'preview', 'apply:b']);

    // Shown again: already there.
    await panel.getByRole('button', { name: 'Add breakpoints to Gemini CLI…' }).click();
    await expect(hook.getByText('Already added, and up to date.')).toBeVisible();
    await expect(hook.getByRole('checkbox')).toBeDisabled();
  });
});

/**
 * The `codetrellis` command from the desktop app. Where it goes and the file
 * work are main-process only (cli-install.test.ts, and a packaged build in
 * CI); here the page runs against a stand-in for that IPC, to prove the
 * person is told where it goes before anything is done, sees whether it is
 * there, and that someone else's `codetrellis` is replaced only on Replace.
 */
test.describe('The codetrellis command', () => {
  const openMcp = async (page: import('@playwright/test').Page) => {
    await gotoWithProject(page);
    await page.locator('button[title*="Settings"]').click();
    await page.getByRole('button', { name: 'MCP Server' }).click();
  };
  const plan = (state: string, extra: Record<string, unknown> = {}) => ({
    ok: true, how: 'link', target: '/usr/local/bin/codetrellis',
    source: '/Applications/CodeTrellis.app/Contents/Resources/cli/bin/codetrellis', admin: true, state, onPath: true,
    says: 'Links /usr/local/bin/codetrellis to the codetrellis command inside the app. macOS asks for your password to write there.',
    ...extra,
  });

  test('is not offered outside the desktop app', async ({ page }) => {
    await openMcp(page);
    await expect(page.getByTestId('mcp-config-snippet')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('command-line-tool')).toHaveCount(0);
  });

  test('says where it goes, adds it, then offers to remove it', async ({ page }) => {
    await page.addInitScript((plans) => {
      const calls: string[] = [];
      let installed = false;
      (window as unknown as { __cliCalls: string[] }).__cliCalls = calls;
      (window as unknown as { electronAPI: unknown }).electronAPI = {
        cli: {
          plan: async () => { calls.push('plan'); return installed ? plans.installed : plans.missing; },
          install: async (replace?: boolean) => { calls.push(`install:${replace === true}`); installed = true; return { ok: true, target: '/usr/local/bin/codetrellis', onPath: true }; },
          remove: async () => { calls.push('remove'); installed = false; return { ok: true, target: '/usr/local/bin/codetrellis', onPath: true }; },
        },
      };
    }, { missing: plan('missing'), installed: plan('installed') });
    await openMcp(page);
    const panel = page.getByTestId('command-line-tool');
    await expect(panel.getByTestId('command-line-state')).toHaveText(/Links \/usr\/local\/bin\/codetrellis .* asks for your password/);
    await panel.getByRole('button', { name: 'Add the codetrellis command' }).click();
    await expect(panel.getByTestId('command-line-message')).toHaveText(/Added\. Open a new terminal and run codetrellis --help\./);
    await expect(panel.getByTestId('command-line-state')).toHaveText('Added: /usr/local/bin/codetrellis.');
    await page.screenshot({ path: test.info().outputPath('command-line-added.png') });
    await panel.getByRole('button', { name: 'Remove' }).click();
    await expect(panel.getByTestId('command-line-message')).toHaveText('Removed.');
    // The plan is read on open (twice under React's development double run)
    // and again after each change; the changes are exactly these.
    const calls = await page.evaluate(() => (window as unknown as { __cliCalls: string[] }).__cliCalls);
    expect(calls.filter((c) => c !== 'plan')).toEqual(['install:false', 'remove']);
    expect(calls.slice(calls.indexOf('install:false') + 1)).toEqual(['plan', 'remove', 'plan']);
  });

  test('another codetrellis (from npm) is named, and replaced only on Replace', async ({ page }) => {
    await page.addInitScript((other) => {
      const calls: string[] = [];
      (window as unknown as { __cliCalls: string[] }).__cliCalls = calls;
      (window as unknown as { electronAPI: unknown }).electronAPI = {
        cli: {
          plan: async () => other,
          install: async (replace?: boolean) => { calls.push(`install:${replace === true}`); return { ok: false, reason: 'stand-in' }; },
          remove: async () => ({ ok: false, reason: 'not ours' }),
        },
      };
    }, plan('other', { existing: 'a link to ../lib/node_modules/codetrellis/bin/codetrellis.mjs' }));
    await openMcp(page);
    const panel = page.getByTestId('command-line-tool');
    await expect(panel.getByTestId('command-line-state')).toContainText('is already a link to ../lib/node_modules/codetrellis/bin/codetrellis.mjs, perhaps from npm');
    await expect(panel.getByRole('button', { name: 'Remove' })).toHaveCount(0);
    await panel.getByRole('button', { name: 'Replace it' }).click();
    await expect(panel.getByTestId('command-line-message')).toHaveText('stand-in');
    expect(await page.evaluate(() => (window as unknown as { __cliCalls: string[] }).__cliCalls)).toEqual(['install:true']);
  });

  test('where the app cannot add it, it says why', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { electronAPI: unknown }).electronAPI = {
        cli: { plan: async () => ({ ok: false, reason: 'The portable build unpacks to a temporary folder each time it starts.' }), install: async () => ({ ok: false, reason: '' }), remove: async () => ({ ok: false, reason: '' }) },
      };
    });
    await openMcp(page);
    await expect(page.getByTestId('command-line-unavailable')).toHaveText(/portable build/);
    await expect(page.getByRole('button', { name: /Add the codetrellis command/ })).toHaveCount(0);
  });
});
