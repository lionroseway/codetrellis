/**
 * System documentation MCP tools — CDev Phase 3.4.
 *
 * Agent surface for the repo-wide knowledge layer. Each doc rides as
 * a markdown file at `<project>/.codetrellis/docs/<slug>.md` with
 * YAML frontmatter; the DB is an index.
 *
 * The agent contract is deliberately compact:
 *
 *   list_system_docs    — what docs exist?
 *   read_system_doc     — give me the body + metadata
 *   write_system_doc    — create or update by uid; absent fields preserved
 *   delete_system_doc   — drop one
 *   verify_system_doc   — restamp captured commit + lastVerifiedAt
 *   check_doc_freshness — should this be re-verified?
 *
 * Heavy lifting (slug derivation, file rewriting, freshness computation,
 * watcher) lives in `system-docs-service`. These tools are thin.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from '../types';
import { resultWithMeta } from '../helpers';

export function register(server: McpServer, deps: ToolDeps): void {

  server.registerTool(
    'list_system_docs',
    {
      description:
        'List every system documentation entry for a project. Returns summaries (no body) ordered by most-recently-updated. ' +
        'Each entry carries title / slug / owner / tags / lastVerifiedAt / capturedAgainstCommit so the UI (or agent) can ' +
        'decide which doc to open next without reading bodies. ' +
        'System docs describe the system as it currently is; for plan-scoped specs use list_items + kind=object.',
      inputSchema: {
        project_path: z.string().describe('Absolute path to the project root'),
        search: z.string().optional().describe('Optional substring filter over title + body (case-insensitive)'),
      },
    },
    async ({ project_path, search }) => {
      const docs = search
        ? deps.systemDocsService.searchSystemDocs(project_path, search)
        : deps.systemDocsService.listSystemDocs(project_path);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ projectPath: project_path, count: docs.length, docs }, null, 2) }] };
    },
  );

  server.registerTool(
    'read_system_doc',
    {
      description:
        'Read a single system doc by UID (preferred — stable across renames) or by (project_path + slug). Returns the full ' +
        'doc including markdown body, references, ownership, and freshness stamps. Use this when you need to *read* a doc ' +
        'to ground a plan or answer "how does X work?".',
      inputSchema: {
        uid: z.string().optional().describe('Doc UID — preferred lookup'),
        project_path: z.string().optional().describe('Required when looking up by slug'),
        slug: z.string().optional().describe('Filesystem slug under .codetrellis/docs/'),
      },
    },
    async ({ uid, project_path, slug }) => {
      let doc = uid ? deps.systemDocsService.getSystemDoc(uid) : null;
      if (!doc && project_path && slug) {
        doc = deps.systemDocsService.getSystemDocBySlug(project_path, slug);
      }
      if (!doc) {
        return { content: [{ type: 'text' as const, text: `System doc not found (uid=${uid ?? ''}, slug=${slug ?? ''})` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(doc, null, 2) }] };
    },
  );

  server.registerTool(
    'write_system_doc',
    {
      description:
        'Create or update a system doc. When `uid` is supplied the existing doc is updated (absent fields are preserved). ' +
        'When omitted, a new doc is created and assigned a fresh UID. The on-disk file at .codetrellis/docs/<slug>.md is ' +
        'written atomically. `references` may carry { files, symbols, items, plans, urls } — used by the freshness sensor ' +
        'and the inline links in the doc viewer. **Updating the body does NOT touch the captured commit stamp** — call ' +
        'verify_system_doc after meaningful edits to re-stamp.',
      inputSchema: {
        uid: z.string().optional().describe('UID of an existing doc to update; omit to create a new one'),
        project_path: z.string().describe('Absolute path to the project root'),
        title: z.string().optional(),
        body: z.string().optional().describe('Markdown body — no frontmatter (added on serialise)'),
        owner: z.string().nullable().optional().describe('Free-form ownership label; null clears'),
        tags: z.array(z.string()).optional(),
        references: z.object({
          files: z.array(z.string()).optional(),
          symbols: z.array(z.string()).optional(),
          items: z.array(z.string()).optional(),
          plans: z.array(z.string()).optional(),
          urls: z.array(z.string()).optional(),
        }).optional(),
        slug: z.string().optional().describe('Override the auto-derived filesystem slug (rare)'),
      },
    },
    async (args) => {
      if (args.uid) {
        const updated = deps.systemDocsService.updateSystemDoc(args.uid, {
          title: args.title,
          body: args.body,
          owner: args.owner === undefined ? undefined : args.owner,
          tags: args.tags,
          references: args.references,
        });
        if (!updated) {
          return { content: [{ type: 'text' as const, text: `System doc ${args.uid} not found` }], isError: true };
        }
        const n = deps.broadcast('system-doc-updated', { uid: updated.uid, projectPath: updated.projectPath });
        deps.saveNow(() => deps.exportDatabase());
        return resultWithMeta(updated, n);
      }
      if (!args.title) {
        return { content: [{ type: 'text' as const, text: 'title is required for new docs' }], isError: true };
      }
      const created = deps.systemDocsService.createSystemDoc({
        projectPath: args.project_path,
        title: args.title,
        body: args.body,
        owner: args.owner,
        tags: args.tags,
        references: args.references,
        slug: args.slug,
      });
      const n = deps.broadcast('system-doc-created', { uid: created.uid, projectPath: created.projectPath });
      deps.saveNow(() => deps.exportDatabase());
      return resultWithMeta(created, n);
    },
  );

  server.registerTool(
    'delete_system_doc',
    {
      description: 'Delete a system doc and its on-disk file. Idempotent — unknown UIDs return ok: false.',
      inputSchema: { uid: z.string() },
    },
    async ({ uid }) => {
      const ok = deps.systemDocsService.deleteSystemDoc(uid);
      const n = ok ? deps.broadcast('system-doc-removed', { uid }) : 0;
      deps.saveNow(() => deps.exportDatabase());
      return resultWithMeta({ ok, uid }, n);
    },
  );

  server.registerTool(
    'verify_system_doc',
    {
      description:
        'Mark a system doc as "accurate against current HEAD" — re-stamps captured_against_commit + last_verified_at to ' +
        'now. Use this after reading the doc end-to-end and confirming it still matches the code. The freshness sensor ' +
        'compares this stamp to the current HEAD to decide whether the doc badge should be green / yellow / red.',
      inputSchema: { uid: z.string() },
    },
    async ({ uid }) => {
      const doc = deps.systemDocsService.verifySystemDoc(uid);
      if (!doc) {
        return { content: [{ type: 'text' as const, text: `System doc ${uid} not found` }], isError: true };
      }
      const n = deps.broadcast('system-doc-verified', { uid, capturedAgainstCommit: doc.capturedAgainstCommit });
      deps.saveNow(() => deps.exportDatabase());
      return resultWithMeta(doc, n);
    },
  );

  server.registerTool(
    'check_doc_freshness',
    {
      description:
        'Compute the freshness verdict for a system doc: current (green) / moved (yellow) / stale (red). Pure read — does ' +
        'not modify the doc. Useful for deciding when to re-verify, especially after a `git pull`.',
      inputSchema: { uid: z.string() },
    },
    async ({ uid }) => {
      const report = deps.systemDocsService.getFreshness(uid);
      if (!report) {
        return { content: [{ type: 'text' as const, text: `System doc ${uid} not found` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(report, null, 2) }] };
    },
  );
}
