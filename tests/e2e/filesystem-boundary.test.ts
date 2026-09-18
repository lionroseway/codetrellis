/**
 * Phase 19 Gate 2 / Gate 4 §3 — the filesystem boundary, at the API.
 *
 * `confined-fs.test.ts` proves the boundary logic in isolation, including
 * the symlink cases a lexical check cannot catch. These prove it is WIRED UP
 * at the endpoints that take a path from a request — which is the half a
 * unit test cannot show.
 *
 * The acceptance criterion asks for symlink, junction and link-swap tests
 * across Windows, macOS and Linux. Junctions are Windows-only and this suite
 * currently runs on macOS and Linux; the symlink cases below are the
 * portable half, and the Windows matrix is tracked as outstanding rather
 * than quietly claimed.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { setupHarness, authFetch } from '../harness';

test.describe('Gate 2 — the filesystem boundary holds at the API', () => {
  test('file reads cannot escape an opened project, by traversal or by symlink', async () => {
    const h = await setupHarness('gate-2-file-read-boundary');
    const project = h.fixture.projectPath;

    // A file the test owns, outside the project, with recognisable contents.
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-outside-'));
    const secret = path.join(outsideDir, 'secret.txt');
    fs.writeFileSync(secret, 'THE-SECRET-CONTENTS');

    try {
      // OPEN the project first. `setupHarness` deliberately does not scan —
      // and until a project is opened it is not a trusted root, so even a
      // file genuinely inside it is refused. That is the intended behaviour
      // (Gate 2.2): roots come from what the user opened, not from the
      // request.
      await h.client.scanProject(project);

      const read = (p: string) =>
        authFetch(h.backend, `/api/file/content?path=${encodeURIComponent(p)}`);

      // ── a legitimate read still works ───────────────────────────────
      {
        const res = await read(path.join(project, 'package.json'));
        expect(res.status, 'a file inside the project must still be readable').toBe(200);
      }

      // ── absolute path outside every project ─────────────────────────
      {
        const res = await read(secret);
        expect(res.status, 'a file outside every opened project must be refused').toBe(403);
      }

      // ── traversal out of the project ────────────────────────────────
      {
        const res = await read(path.join(project, '..', '..', 'etc', 'passwd'));
        expect(res.status, 'traversal out of the project must be refused').toBe(403);
      }

      // ── SYMLINK INSIDE THE PROJECT POINTING OUT ─────────────────────
      //
      // The case a lexical check cannot catch: the requested path is
      // textually inside the project, so `resolve(...).startsWith(root)` is
      // true. Only canonicalisation sees the escape.
      {
        const link = path.join(project, 'escape-link.txt');
        try { fs.unlinkSync(link); } catch { /* */ }
        fs.symlinkSync(secret, link, 'file');

        // Precondition: the lexical path really does look contained, and
        // following the link really does reach the secret. Without this the
        // test could pass for the wrong reason.
        expect(path.resolve(link).startsWith(project)).toBe(true);
        expect(fs.readFileSync(link, 'utf-8')).toBe('THE-SECRET-CONTENTS');

        const res = await read(link);
        expect(
          res.status,
          'a symlink inside the project pointing outside must be refused',
        ).toBe(403);

        if (res.status === 200) {
          const body = await res.json();
          expect(body.content).not.toContain('THE-SECRET-CONTENTS');
        }
      }

      // ── a symlinked DIRECTORY in the middle of the path ─────────────
      {
        const linkDir = path.join(project, 'escape-dir');
        try { fs.unlinkSync(linkDir); } catch { /* */ }
        fs.symlinkSync(outsideDir, linkDir, 'dir');

        const res = await read(path.join(linkDir, 'secret.txt'));
        expect(
          res.status,
          'an intermediate directory symlink must be refused, not just a final-component one',
        ).toBe(403);
      }
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
      await h.teardown();
    }
  });

  test('directory browsing cannot leave the home directory', async () => {
    const h = await setupHarness('gate-2-browse-boundary');
    try {
      const browse = (p: string) =>
        authFetch(h.backend, `/api/fs/browse?path=${encodeURIComponent(p)}`);

      // Browsing is NOT confined to projects — it is how a project gets
      // chosen. It is confined to the user's own home.
      {
        const res = await browse(os.homedir());
        expect(res.status, 'the home directory must be browsable').toBe(200);
      }

      for (const outside of ['/etc', '/var', '/']) {
        const res = await browse(outside);
        expect(res.status, `browsing ${outside} must be refused`).toBe(403);
      }

      // And `parent` must never offer a way out of home.
      {
        const res = await browse(os.homedir());
        const body = await res.json();
        expect(
          body.parent === os.homedir() || body.parent.startsWith(os.homedir()),
          'parent must not point above the home directory',
        ).toBe(true);
      }
    } finally {
      await h.teardown();
    }
  });

  test('finding 6 — an attachment write is validated BEFORE anything is written', async () => {
    const h = await setupHarness('gate-2-attachment-write');
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-attach-'));

    try {
      // The project must be OPENED before a confined endpoint will
      // answer: a root is never caller-nominated (Phase 19). Without
      // this the PRECONDITION below — the legitimate in-project case
      // that proves the check is not simply refusing everything — fails
      // on a 403 and the test proves nothing.
      await h.client.scanProject(h.fixture.projectPath);

      // A root the app has never opened. The reviewer reproduced marker
      // bytes landing under exactly this shape of path before the database
      // operation failed — the write preceded validation.
      const plan = await h.client.raw('POST', '/api/plans', {
        title: 'attachment boundary',
        description: '',
        projectPath: h.fixture.projectPath,
      });
      expect(plan.ok).toBe(true);
      const planBody = await plan.json();
      const planUid = planBody.uid ?? planBody.plan?.uid;

      const res = await h.client.raw('POST', `/api/plans/${planUid}/attachments`, {
        targetType: 'plan',
        targetUid: planUid,
        kind: 'image',
        dataBase64: Buffer.from('marker-bytes').toString('base64'),
        contentType: 'image/png',
        label: 'probe',
        author: 'test',
        authorType: 'human',
        projectRoot: outsideDir,
      });

      expect(
        res.ok,
        'an attachment naming an unopened project root must be refused',
      ).toBe(false);

      // The assertion that matters: nothing was written anyway.
      const strays = fs.existsSync(path.join(outsideDir, '.codetrellis'));
      expect(
        strays,
        'a refused attachment must not have written bytes before failing',
      ).toBe(false);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
      await h.teardown();
    }
  });
});
