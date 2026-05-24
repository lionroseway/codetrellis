/**
 * CDev Phase 3.4 — system documentation E2E.
 *
 * Verifies the round-trip between the in-app docs surface and the
 * on-disk YAML+markdown files in `<project>/.codetrellis/docs/`.
 *
 * Coverage:
 *
 *   1. Create a doc via MCP `write_system_doc` → file appears at
 *      `.codetrellis/docs/<slug>.md` with YAML frontmatter carrying
 *      uid + title.
 *   2. list_system_docs sees the doc.
 *   3. Verify the doc — frontmatter gains capturedAgainstCommit + lastVerifiedAt.
 *   4. Edit a referenced file, run check_doc_freshness — verdict is 'stale'
 *      because HEAD moved AND a referenced file changed.
 *   5. Hand-craft an external doc on disk (no uid) → watcher imports it,
 *      stamping a new uid + rewriting the file.
 *   6. Delete via MCP → file removed.
 *
 * If anything in this chain breaks, the system docs experience
 * (and the freshness sensor) is impacted.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { setupHarness, waitFor } from '../harness';

interface DocPayload {
  uid: string;
  slug: string;
  title: string;
  body: string;
  capturedAgainstCommit: string | null;
  lastVerifiedAt: number | null;
}

interface FreshnessPayload {
  uid: string;
  status: 'current' | 'moved' | 'stale';
  currentCommit: string | null;
  capturedCommit: string | null;
  changedReferencedFiles: string[];
}

function parseDoc(text: string): DocPayload {
  // resultWithMeta wraps the doc in { ..., _meta: {...} } — drop _meta
  // for cleaner equality checks.
  const obj = JSON.parse(text);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _meta, ...rest } = obj;
  return rest as DocPayload;
}

test.describe('CDev Phase 3.4 — system documentation', () => {
  test.setTimeout(120_000);

  test('write → verify → freshness → external import → delete round-trip', async () => {
    const h = await setupHarness('cdev-system-docs');
    try {
      // Set a deterministic identity so commits land cleanly.
      execSync('git config user.name "Docs Tester"', { cwd: h.fixture.projectPath });
      execSync('git config user.email "docs-tester@cdev.example"', { cwd: h.fixture.projectPath });

      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'claude-code', model: 'opus-4-7' });

      // 1. Create a doc via MCP.
      const createRes = await agent.callTool('write_system_doc', {
        project_path: h.fixture.projectPath,
        title: 'Auth architecture',
        body: '# Auth\n\nThe service authenticates via OAuth.',
        owner: 'platform',
        tags: ['architecture', 'auth'],
        references: {
          files: ['packages/web/src/api.ts'],
        },
      });
      const created = parseDoc(createRes.text);
      expect(created.uid).toBeTruthy();
      expect(created.slug).toBe('auth-architecture');
      expect(created.capturedAgainstCommit).toBeNull(); // not yet verified

      const docsDir = path.join(h.fixture.projectPath, '.codetrellis', 'docs');
      const filePath = path.join(docsDir, 'auth-architecture.md');
      expect(fs.existsSync(filePath)).toBe(true);

      // Frontmatter sanity: uid + title round-trip.
      const onDisk = fs.readFileSync(filePath, 'utf-8');
      expect(onDisk.startsWith('---')).toBe(true);
      const fmEnd = onDisk.indexOf('\n---', 3);
      const fm = parseYaml(onDisk.slice(3, fmEnd));
      expect(fm.uid).toBe(created.uid);
      expect(fm.title).toBe('Auth architecture');
      expect(fm.references.files).toEqual(['packages/web/src/api.ts']);

      // 2. list_system_docs sees the new doc.
      const listRes = await agent.callTool('list_system_docs', {
        project_path: h.fixture.projectPath,
      });
      const list = JSON.parse(listRes.text);
      expect(list.count).toBe(1);
      expect(list.docs[0].uid).toBe(created.uid);

      // 3. Verify the doc — captures HEAD into the frontmatter.
      const verifyRes = await agent.callTool('verify_system_doc', { uid: created.uid });
      const verified = parseDoc(verifyRes.text);
      expect(verified.capturedAgainstCommit).toBeTruthy();
      expect(verified.lastVerifiedAt).toBeTruthy();
      const stampedSha = verified.capturedAgainstCommit!;

      // 4a. Freshness when HEAD hasn't moved → 'current'.
      const freshAtVerify = JSON.parse(
        (await agent.callTool('check_doc_freshness', { uid: created.uid })).text,
      ) as FreshnessPayload;
      expect(freshAtVerify.status).toBe('current');

      // 4b. Edit the referenced file and commit → HEAD moves AND a
      // referenced file changed. Verdict must be 'stale'.
      const refFile = path.join(h.fixture.projectPath, 'packages/web/src/api.ts');
      fs.appendFileSync(refFile, '\n// drift\n');
      execSync('git add -A && git commit -q -m "drift the referenced file"', {
        cwd: h.fixture.projectPath,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Docs Tester',
          GIT_AUTHOR_EMAIL: 'docs-tester@cdev.example',
          GIT_COMMITTER_NAME: 'Docs Tester',
          GIT_COMMITTER_EMAIL: 'docs-tester@cdev.example',
        },
      });
      const freshAfterDrift = JSON.parse(
        (await agent.callTool('check_doc_freshness', { uid: created.uid })).text,
      ) as FreshnessPayload;
      expect(freshAfterDrift.status).toBe('stale');
      expect(freshAfterDrift.capturedCommit).toBe(stampedSha);
      expect(freshAfterDrift.changedReferencedFiles).toContain('packages/web/src/api.ts');

      // 5. Hand-craft an external doc on disk (no uid) → watcher
      // imports it, stamps a uid, rewrites the file.
      const externalSlug = 'runbook-deploy';
      const externalPath = path.join(docsDir, `${externalSlug}.md`);
      const externalBody = '# Deploy runbook\n\nRun `make deploy`.';
      const externalFrontmatter = stringifyYaml({
        title: 'Deploy runbook',
        tags: ['runbook'],
      });
      fs.writeFileSync(externalPath, `---\n${externalFrontmatter}---\n\n${externalBody}`, 'utf-8');

      // Wait for the watcher to import it.
      const externalDoc = await waitFor(
        async () => {
          const r = await agent.callTool('list_system_docs', { project_path: h.fixture.projectPath });
          const parsed = JSON.parse(r.text);
          const found = parsed.docs.find((d: any) => d.slug === externalSlug);
          return found ?? null;
        },
        { timeoutMs: 10_000, intervalMs: 200, description: 'watcher imports external doc' },
      );
      expect(externalDoc.uid).toBeTruthy();

      // The watcher should have rewritten the file with a uid in frontmatter.
      const externalReread = fs.readFileSync(externalPath, 'utf-8');
      const externalFmEnd = externalReread.indexOf('\n---', 3);
      const externalFm = parseYaml(externalReread.slice(3, externalFmEnd));
      expect(externalFm.uid).toBe(externalDoc.uid);

      // 6. Delete via MCP → file removed.
      const delRes = await agent.callTool('delete_system_doc', { uid: created.uid });
      const del = JSON.parse(delRes.text);
      expect(del.ok).toBe(true);
      expect(fs.existsSync(filePath)).toBe(false);

      // External doc still around.
      expect(fs.existsSync(externalPath)).toBe(true);
    } finally {
      await h.teardown();
    }
  });
});
