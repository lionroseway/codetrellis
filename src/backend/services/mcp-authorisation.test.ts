/**
 * Every MCP tool is authorised, and an unlisted one is refused.
 *
 * Phase 30. The register's M34 was about `project_path` on the review
 * tools; the larger finding underneath it was that 174 tools were exposed
 * and none of them authorised. `CLAUDE.md` states the rule — "MCP tools
 * authorise per tool by capability, not per connection" — and nothing
 * implemented it.
 *
 * The coverage assertion enumerates what the server REGISTERS at runtime.
 * A hand-kept list checked against another hand-kept list verifies nothing,
 * and this codebase has shipped that mistake four times (see
 * `findUnparsedLanguages` and `findUnscannedExtensions` for the other two
 * shapes of it).
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  TOOL_CAPABILITIES,
  assertMcpMayCall,
  listAuthorisedTools,
  McpAuthorizationError,
} from './mcp-capabilities';
import { DEFAULT_GRANTS, ALL_CAPABILITIES, type PeerCapability } from './peer-capabilities';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-mcp-authz-'));
process.env.CODETRELLIS_DATA_DIR = tmp;

let registered: string[] = [];

before(async () => {
  const db = await import('./database');
  await db.initDatabase();
  const mcp = await import('../mcp/server');
  registered = mcp.enumerateRegisteredTools();
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('coverage — the matrix and the server agree', () => {
  test('the probe actually registered tools', () => {
    // Guarding the guard: if registration silently produced nothing, every
    // assertion below would pass vacuously.
    assert.ok(registered.length > 100, `only ${registered.length} tools registered`);
  });

  test('every registered tool has a capability', () => {
    const missing = registered.filter((t) => !(t in TOOL_CAPABILITIES));
    assert.deepEqual(
      missing,
      [],
      `these tools are registered but unclassified, and are therefore REFUSED: ${missing.join(', ')}`,
    );
  });

  test('the matrix lists nothing the server does not register', () => {
    const stale = listAuthorisedTools().filter((t) => !registered.includes(t));
    assert.deepEqual(stale, [], `stale matrix entries: ${stale.join(', ')}`);
  });

  test('tools registered through the deprecated server.tool() API are covered too', () => {
    // These three files use `server.tool()` rather than `registerTool`, and
    // the interception used to wrap only the latter — so they were invisible
    // to the Timeline and would have been invisible to this gate.
    for (const tool of ['write_remote_terminal', 'start_audio_capture', 'list_contributions']) {
      assert.ok(registered.includes(tool), `${tool} did not register`);
      assert.ok(tool in TOOL_CAPABILITIES, `${tool} is unclassified`);
    }
  });

  test('every capability used is a real one', () => {
    for (const [tool, cap] of Object.entries(TOOL_CAPABILITIES)) {
      assert.ok(ALL_CAPABILITIES.includes(cap), `${tool} wants unknown capability "${cap}"`);
    }
  });
});

describe('the dangerous capabilities are not granted by default', () => {
  test('terminal, settings and capture are all off', () => {
    for (const cap of ['terminal', 'settings', 'capture'] as const) {
      assert.ok(!DEFAULT_GRANTS.includes(cap), `${cap} must not be in the defaults`);
    }
  });

  test('command execution is refused on a fresh install', () => {
    // The whole point of the phase. For a client that cannot already run
    // commands — Claude Desktop, a hosted runtime — CodeTrellis was a
    // shell it did not have.
    for (const tool of ['terminal_create', 'terminal_write', 'terminal_kill', 'write_remote_terminal']) {
      assert.throws(
        () => assertMcpMayCall(tool, DEFAULT_GRANTS),
        (err: unknown) =>
          err instanceof McpAuthorizationError && err.required === 'terminal',
        `${tool} was allowed on a fresh install`,
      );
    }
  });

  test('the microphone, the screen and the clipboard are refused', () => {
    for (const tool of ['start_audio_capture', 'screenshot', 'clipboard_read']) {
      assert.throws(() => assertMcpMayCall(tool, DEFAULT_GRANTS), McpAuthorizationError, tool);
    }
  });

  test('a tool that widens the caller’s own approval is refused', () => {
    // `setup_agent_permissions` writes .claude/settings.local.json to
    // auto-approve every CodeTrellis tool.
    assert.throws(() => assertMcpMayCall('setup_agent_permissions', DEFAULT_GRANTS), McpAuthorizationError);
  });

  test('granting the capability makes the same call succeed', () => {
    const withTerminal: PeerCapability[] = [...DEFAULT_GRANTS, 'terminal'];
    assert.equal(assertMcpMayCall('terminal_create', withTerminal), 'terminal');
  });

  test('the ordinary flow still works untouched', () => {
    // A remediation that breaks the product is not a remediation. Reading
    // plans, driving the graph, running a review: all default-granted.
    for (const tool of ['get_plan', 'add_item', 'graph_focus', 'review_plan', 'register_session']) {
      assert.doesNotThrow(() => assertMcpMayCall(tool, DEFAULT_GRANTS), tool);
    }
  });
});

describe('deny by default', () => {
  test('an unlisted tool is refused, not allowed', () => {
    assert.throws(
      () => assertMcpMayCall('some_tool_nobody_classified', ALL_CAPABILITIES),
      (err: unknown) => err instanceof McpAuthorizationError && err.required === null,
    );
  });

  test('holding every capability does not rescue an unlisted tool', () => {
    // The failure mode this prevents: someone adds a tool, nobody
    // classifies it, and it ships open because the caller happened to be
    // fully granted.
    assert.throws(() => assertMcpMayCall('brand_new_tool', ALL_CAPABILITIES), McpAuthorizationError);
  });

  test('the refusal says what is missing and where to fix it', () => {
    // An agent that cannot tell the user what to turn on will just retry.
    try {
      assertMcpMayCall('terminal_create', DEFAULT_GRANTS);
      assert.fail('expected a refusal');
    } catch (err) {
      const msg = (err as Error).message;
      assert.match(msg, /terminal/);
      assert.match(msg, /Settings → MCP Server/);
    }
  });
});

describe('project scope — M34', () => {
  // `setActiveProjectRoot` is how the backend tells trusted-roots what is
  // open, so it is also how a test creates that condition.
  let trusted: typeof import('./trusted-roots');
  let scope: typeof import('./mcp-capabilities').assertMcpProjectInScope;
  let opened: string;
  let elsewhere: string;

  before(async () => {
    trusted = await import('./trusted-roots');
    ({ assertMcpProjectInScope: scope } = await import('./mcp-capabilities'));
    opened = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-opened-'));
    elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-elsewhere-'));
    trusted.setActiveProjectRoot(opened);
  });

  after(() => {
    trusted.setActiveProjectRoot(null);
    for (const d of [opened, elsewhere]) fs.rmSync(d, { recursive: true, force: true });
  });

  test('an opened project is allowed', () => {
    assert.doesNotThrow(() => scope('review_plan', { project_path: opened }, 'opened'));
  });

  test('a project that was never opened is refused', () => {
    // The finding: 38 tools took this straight from the request and ran git,
    // read files and wrote plans in whatever it named.
    assert.throws(
      () => scope('review_plan', { project_path: elsewhere }, 'opened'),
      McpAuthorizationError,
    );
  });

  test('the refusal says how to proceed', () => {
    try {
      scope('get_pr_draft', { project_path: elsewhere }, 'opened');
      assert.fail('expected a refusal');
    } catch (err) {
      assert.match((err as Error).message, /not open/);
      assert.match((err as Error).message, /Settings → MCP Server/);
    }
  });

  test('"anywhere" restores the old behaviour for an autonomous agent', () => {
    assert.doesNotThrow(() => scope('review_plan', { project_path: elsewhere }, 'anywhere'));
  });

  test('a tool with no project_path is unaffected', () => {
    // Most tools do not take one; the gate must not invent a requirement.
    assert.doesNotThrow(() => scope('get_plan', { plan_uid: 'pln_1' }, 'opened'));
    assert.doesNotThrow(() => scope('list_plans', {}, 'opened'));
    assert.doesNotThrow(() => scope('terminal_list', undefined, 'opened'));
  });

  test('open_project is not caught by this, and must not be', () => {
    // It takes `path`, not `project_path`, because opening is how a
    // directory BECOMES a project. Confining it would make it impossible to
    // open anything — and there is deliberately no exemption list, because
    // the parameter name already draws the line.
    assert.doesNotThrow(() => scope('open_project', { path: elsewhere }, 'opened'));
  });
});
