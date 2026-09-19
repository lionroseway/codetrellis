/**
 * UI control tools — screenshot, select_item, open_project, clipboard, settings, logs, app guide.
 */

// [codemod] hoisted lazy requires → static namespace imports for bundling
import * as _lazy_______services_mdns_service from '../../services/mdns-service';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from '../types';

export function register(server: McpServer, deps: ToolDeps): void {
  // --- Screenshot ---

  server.registerTool(
    'screenshot',
    {
      description:
        'Capture a screenshot of the CodeTrellis UI and return it as a base64-encoded PNG image. ' +
        'Use this to see the current state of the graph, plan workspace, terminal output, or any other part of the UI. ' +
        'The screenshot is taken from the connected browser/Electron window. ' +
        'Optionally target a specific panel to capture only that area.',
      inputSchema: {
        panel: z.enum(['full', 'graph', 'plan', 'terminal']).optional().describe(
          'Which panel to capture. "full" = entire window (default). "graph" = dependency graph canvas. "plan" = plan workspace. "terminal" = terminal panel.',
        ),
      },
    },
    async ({ panel }) => {
      // ── Electron fast path ──────────────────────────────────────
      // In the Electron app, capture directly via webContents.capturePage()
      // which avoids the html-to-image broadcast round-trip entirely and
      // doesn't suffer from canvas-tainting issues on file:// origins.
      if (deps.captureElectronScreenshot) {
        try {
          const base64 = await deps.captureElectronScreenshot();
          return {
            content: [{
              type: 'image' as const,
              data: base64,
              mimeType: 'image/png',
            }],
          };
        } catch (err) {
          return { content: [{ type: 'text' as const, text: `Electron screenshot failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
        }
      }

      // ── Browser path ────────────────────────────────────────────
      // Broadcast a request to the frontend, which captures via
      // html-to-image and POSTs the result back.
      const nonce = `ss-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const target = panel ?? 'full';

      const p = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          deps.pendingResponses.delete(nonce);
          reject(new Error('Screenshot timed out — is the CodeTrellis UI open in a browser?'));
        }, 10_000);
        deps.pendingResponses.set(nonce, { resolve, reject, timer });
      });

      deps.broadcast('ui-screenshot-request', { nonce, panel: target });

      try {
        const base64 = await p;
        if (!base64) {
          return { content: [{ type: 'text' as const, text: 'Screenshot capture failed — the frontend returned empty data (html-to-image may have hit a canvas-tainting error).' }], isError: true };
        }
        return {
          content: [{
            type: 'image' as const,
            data: base64,
            mimeType: 'image/png',
          }],
        };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }], isError: true };
      }
    },
  );

  // --- UI Navigation (extended) ---

  server.registerTool(
    'select_item',
    {
      description:
        'Navigate the plan workspace to a specific item by UID. The item will be selected in the sidebar tree and ' +
        'its body/properties will appear in the canvas. If the plan workspace is not open, it will be opened automatically.',
      inputSchema: {
        item_uid: z.string().describe('UID of the plan item to select.'),
        plan_uid: z.string().optional().describe('Plan UID (auto-detected from the item if omitted).'),
      },
    },
    async ({ item_uid, plan_uid }) => {
      let resolvedPlanUid = plan_uid;
      if (!resolvedPlanUid) {
        const item = deps.planItemService.getItem(item_uid);
        if (!item) {
          return { content: [{ type: 'text' as const, text: `Item ${item_uid} not found.` }], isError: true };
        }
        resolvedPlanUid = item.planUid;
      }
      deps.broadcast('ui-navigate', { target: 'plan', planUid: resolvedPlanUid });
      deps.broadcast('ui-select-item', { planUid: resolvedPlanUid, itemUid: item_uid });
      return { content: [{ type: 'text' as const, text: `Selected item ${item_uid} in plan ${resolvedPlanUid}` }] };
    },
  );

  server.registerTool(
    'open_project',
    {
      description:
        'Open and scan a project directory in CodeTrellis. Parses the codebase, builds the dependency ' +
        'graph, and makes the project available to every tool that takes a project_path. Use this during ' +
        'onboarding to load a project for the first time.',
      inputSchema: {
        path: z.string().describe('Absolute path to the project root directory.'),
      },
    },
    async ({ path: projectPath }) => {
      // Actually open it, rather than asking the renderer to.
      //
      // This only broadcast `ui-open-project` and returned "Opening
      // project: …" — success, unconditionally, having done nothing. With
      // no renderer listening (a headless agent, or a window still coming
      // up) nothing happened at all, and the description's promise of "a
      // full AST parse" was simply untrue.
      //
      // It went unnoticed because `rescan_project` did the real work and
      // was unconfined, so the documented open-then-rescan flow appeared to
      // work. Phase 30 confines rescan to opened projects, which turned a
      // cosmetic lie into a dead end: open_project said ok, rescan said the
      // project is not open, and both were right.
      //
      // Scanning is what REGISTERS a trusted root (`recordProjectOpen` +
      // `setActiveProjectRoot`), and scan is deliberately exempt from
      // confinement because it is how a directory becomes a project.
      try {
        const stats = await deps.scanProject(projectPath);
        // Broadcast after, so the UI switches to a project that is ready
        // rather than one still parsing.
        deps.broadcast('ui-open-project', { path: projectPath });
        return {
          content: [{
            type: 'text' as const,
            text: `Opened ${projectPath} — ${stats.fileCount} files, ${stats.symbolCount} symbols, `
              + `${stats.importCount} imports (${stats.resolvedImports} resolved)`,
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: `Could not open ${projectPath}: ${err instanceof Error ? err.message : String(err)}`,
          }],
          isError: true,
        };
      }
    },
  );

  // --- Clipboard ---

  server.registerTool(
    'clipboard_write',
    {
      description:
        'Copy text to the user\'s clipboard. Use this to share code snippets, plan prompts, ' +
        'architecture summaries, or any text the user might want to paste elsewhere.',
      inputSchema: {
        text: z.string().describe('The text to copy to the clipboard.'),
      },
    },
    async ({ text }) => {
      deps.broadcast('ui-clipboard-write', { text });
      return { content: [{ type: 'text' as const, text: `Copied ${text.length} chars to clipboard` }] };
    },
  );

  server.registerTool(
    'clipboard_read',
    {
      description:
        'Read the current contents of the user\'s clipboard. Useful for importing text the user ' +
        'has copied from another app (a GitHub issue, a Slack message, code from their editor, etc.).',
      inputSchema: {},
    },
    async () => {
      const nonce = `cb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const p = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          deps.pendingResponses.delete(nonce);
          reject(new Error('Clipboard read timed out — is the CodeTrellis UI open and focused?'));
        }, 10_000);
        deps.pendingResponses.set(nonce, { resolve, reject, timer });
      });

      deps.broadcast('ui-clipboard-read', { nonce });

      try {
        const text = await p;
        return { content: [{ type: 'text' as const, text: text || '(clipboard is empty)' }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }], isError: true };
      }
    },
  );

  // --- Settings ---

  server.registerTool(
    'get_settings',
    {
      description:
        'Read the current CodeTrellis settings — identity (display name, email), MCP server config (port, auto-detect), ' +
        'plan defaults (visibility, attachment location), and data directory.',
      inputSchema: {},
    },
    async () => {
      const settings = deps.getSettings();
      return { content: [{ type: 'text' as const, text: JSON.stringify(settings, null, 2) }] };
    },
  );

  server.registerTool(
    'update_settings',
    {
      description:
        'Update CodeTrellis settings. Pass only the fields you want to change — ' +
        'unmentioned fields are preserved. Nested objects are deep-merged. ' +
        'Note: changing the MCP port requires a server restart to take effect.',
      inputSchema: {
        identity: z.object({
          displayName: z.string().optional().describe('Display name shown in attributions.'),
          email: z.string().optional().describe('Email used as canonical author key.'),
        }).optional().describe('Identity settings.'),
        mcp: z.object({
          port: z.number().optional().describe('Preferred MCP port (default 19432).'),
          autodetectOnCollision: z.boolean().optional().describe('Try next ports if preferred is in use.'),
        }).optional().describe('MCP server settings.'),
        plans: z.object({
          defaultVisibility: z.enum(['shared', 'local']).optional().describe('"shared" = export to .codetrellis/plans/, "local" = DB-only.'),
          attachmentLocation: z.enum(['project', 'user']).optional().describe('"project" = in repo, "user" = user data dir.'),
        }).optional().describe('Plan default settings.'),
        data: z.object({
          dataDirOverride: z.string().optional().describe('Override for ~/.codetrellis/ data directory. Empty = default.'),
          personalSyncPath: z.string().optional().describe('Path to personal sync folder (git repo, iCloud, Dropbox). Empty = no sync.'),
          personalSyncMode: z.enum(['none', 'selective', 'full']).optional().describe('What to sync: none, selective (settings+projects), or full (entire pantry).'),
        }).optional().describe('Data and sync settings.'),
        device: z.object({
          deviceName: z.string().optional().describe('Human-readable name for this machine (shown to peers). Empty = hostname.'),
          advertise: z.boolean().optional().describe('Whether to advertise via mDNS on the local network.'),
          shareAudio: z.boolean().optional().describe('Whether to share audio capture with paired devices.'),
        }).optional().describe('Device discovery and pairing settings. Changes to advertise/deviceName take effect immediately (live mDNS restart).'),
        firstRunComplete: z.boolean().optional().describe('Set to true after the first-run wizard completes.'),
      },
    },
    async ({ identity, mcp, plans, data, device, firstRunComplete }) => {
      const patch: any = {};
      if (identity) patch.identity = identity;
      if (mcp) patch.mcp = mcp;
      if (plans) patch.plans = plans;
      if (data) patch.data = data;
      if (device) patch.device = device;
      if (firstRunComplete !== undefined) patch.firstRunComplete = firstRunComplete;

      const updated = deps.updateSettings(patch);

      // Phase 9 — live-restart mDNS when device settings change.
      if (device?.advertise !== undefined || device?.deviceName !== undefined) {
        try {
          const mdns = _lazy_______services_mdns_service;
          if (updated.device.advertise) {
            mdns.startMdns(updated.device.deviceName || undefined);
          } else {
            mdns.stopMdns();
          }
        } catch { /* mDNS not available */ }
      }
      deps.broadcast('settings-changed', { settings: updated });

      const changes: string[] = [];
      if (identity?.displayName !== undefined) changes.push(`display name → "${identity.displayName}"`);
      if (identity?.email !== undefined) changes.push(`email → "${identity.email}"`);
      if (mcp?.port !== undefined) changes.push(`MCP port → ${mcp.port} (restart needed)`);
      if (mcp?.autodetectOnCollision !== undefined) changes.push(`auto-detect port → ${mcp.autodetectOnCollision}`);
      if (plans?.defaultVisibility !== undefined) changes.push(`plan visibility → ${plans.defaultVisibility}`);
      if (plans?.attachmentLocation !== undefined) changes.push(`attachment location → ${plans.attachmentLocation}`);
      if (data?.personalSyncPath !== undefined) changes.push(`sync path → "${data.personalSyncPath}"`);
      if (data?.personalSyncMode !== undefined) changes.push(`sync mode → ${data.personalSyncMode}`);
      if (data?.dataDirOverride !== undefined) changes.push(`data dir → "${data.dataDirOverride || '(default)'}"`);
      if (device?.deviceName !== undefined) changes.push(`device name → "${device.deviceName || '(hostname)'}"`);
      if (device?.advertise !== undefined) changes.push(`mDNS advertise → ${device.advertise}`);
      if (device?.shareAudio !== undefined) changes.push(`share audio with peers → ${device.shareAudio}`);
      if (firstRunComplete !== undefined) changes.push(`first-run complete → ${firstRunComplete}`);

      return { content: [{ type: 'text' as const, text: `Settings updated: ${changes.join(', ')}` }] };
    },
  );

  // --- Logs ---

  server.registerTool(
    'get_logs',
    {
      description:
        'Read the tail of the CodeTrellis application log. Returns the most recent log entries ' +
        'from the current day\'s log file. Useful for diagnosing errors, checking parse results, ' +
        'or understanding what happened during a scan or agent operation.',
      inputSchema: {
        lines: z.number().optional().describe('Approximate number of lines to return (default ~500). Max constrained by 64KB.'),
        filter: z.string().optional().describe('Optional grep-style filter — only return lines containing this string (case-insensitive).'),
      },
    },
    async ({ lines, filter }) => {
      const maxBytes = Math.min((lines ?? 500) * 200, 64 * 1024);
      let content = deps.tailLog(maxBytes);

      if (filter) {
        const lower = filter.toLowerCase();
        content = content
          .split('\n')
          .filter((line: string) => line.toLowerCase().includes(lower))
          .join('\n');
      }

      if (!content.trim()) {
        return { content: [{ type: 'text' as const, text: '(no log entries found)' }] };
      }

      return { content: [{ type: 'text' as const, text: content }] };
    },
  );

  server.registerTool(
    'get_log_path',
    {
      description:
        'Get the path to the current log file and logs directory. Useful if the agent needs ' +
        'to tell the user where to find logs, or to read logs directly from disk.',
      inputSchema: {},
    },
    async () => {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            currentLogFile: deps.getCurrentLogPath(),
            logDirectory: deps.getLogDir(),
          }, null, 2),
        }],
      };
    },
  );

  // --- App Guide ---

  server.registerTool(
    'get_app_guide',
    {
      description:
        'Get instructions on how to use CodeTrellis. Returns a comprehensive markdown guide ' +
        'covering available MCP tools, workflows, and best practices. Six flavors: ' +
        '"summary" = project-state-tailored overview with active plans and agents, ' +
        '"quickstart" = minimum viable agent workflow (register → find plan → claim → work → verify → done), ' +
        '"power-user" = deep features (phased plans, multi-agent, spec docs, drift, snapshots), ' +
        '"ui-nav" = focused UI navigation skill for sub-agents that drive the interface while the primary agent works, ' +
        '"diagnostics" = logs, settings, baseline, drift detection, architecture conformity, ' +
        '"multi-agent" = terminals, claiming, handoff patterns, session registration, approval gates.',
      inputSchema: {
        flavor: z.enum(['summary', 'quickstart', 'power-user', 'ui-nav', 'diagnostics', 'multi-agent']).optional().describe(
          'Which guide to return. Default "summary". Use "quickstart" for first-time setup, "power-user" for advanced features, ' +
          '"ui-nav" for a sub-agent driving the UI, "diagnostics" for logs/settings/drift, "multi-agent" for terminal/claim/handoff workflows.',
        ),
      },
    },
    async ({ flavor }) => {
      const guide = deps.buildSkillGuide(flavor ?? 'summary');
      return { content: [{ type: 'text' as const, text: guide }] };
    },
  );
}
