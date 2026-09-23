/**
 * Gate 2, the remaining sinks — findings 21a, 21b, 8, 12, A1, 11 and 3.
 *
 * WHY A SECOND FILE
 *
 * `filesystem-boundary.test.ts` proves the boundary holds where it is applied.
 * These tests prove it is APPLIED — one per sink the review named, driven
 * through the real endpoint rather than through the helper.
 *
 * That distinction is the whole reason this exists. `confined-fs.ts` had 22
 * unit tests passing while several call sites still did their own
 * `startsWith` check, and a helper nobody routes through is a helper that
 * secures nothing. Each test here would have passed against the fixed helper
 * and failed against the unfixed caller.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { setupHarness, authFetch } from '../harness';

/** A file outside every project, with contents nothing legitimate should return. */
function plantSecret(): { dir: string; file: string; contents: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-outside-'));
  const file = path.join(dir, 'secret.txt');
  const contents = 'SENTINEL-c4f3a1-THIS-MUST-NOT-BE-READABLE';
  fs.writeFileSync(file, contents);
  return { dir, file, contents, cleanup: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } } };
}

test.describe('21a / 21b — a template cannot read outside its own directory', () => {
  test('neither the document bodyPath nor a nested item bodyPath escapes', async () => {
    const h = await setupHarness('sink-template-bodypath');
    const secret = plantSecret();
    try {
      // The project must be OPENED before these endpoints will answer:
      // a project root is never caller-nominated (Phase 19), so an
      // unopened path is refused before the check under test can run.
      // Without this the assertion below would pass on a 403 and prove
      // nothing about template path containment.
      await h.client.scanProject(h.fixture.projectPath);


      // A template is a directory of YAML plus markdown, and it can be
      // INSTALLED FROM ANYWHERE — a shared folder, a downloaded bundle. So
      // its own YAML is attacker-controlled in the case that matters, and
      // `path.join(tplDir, '../../../..')` was an arbitrary read.
      const tplDir = path.join(h.fixture.projectPath, '.codetrellis', 'templates', 'evil');
      fs.mkdirSync(tplDir, { recursive: true });

      const escape = path.relative(tplDir, secret.file);
      expect(escape.startsWith('..'), 'precondition: the path really does climb out').toBe(true);

      fs.writeFileSync(path.join(tplDir, 'template.yaml'), [
        'id: evil',
        'label: Evil Template',
        'defaultTitle: Evil',
        'docs:',
        '  - title: Doc',
        `    bodyPath: "${escape}"`,      // 21a
        'items:',
        '  - title: Top',
        '    children:',
        '      - title: Nested',
        `        bodyPath: "${escape}"`,  // 21b — the recursive path
      ].join('\n'));

      const list = await h.client.raw('GET', `/api/plan-templates?project=${encodeURIComponent(h.fixture.projectPath)}`)
        .then(r => r.json()) as Array<{ id: string }>;
      expect(list.some(t => t.id === 'evil'), 'precondition: the template must actually load').toBe(true);

      const created = await h.client.raw('POST', '/api/plans/from-template', {
        templateId: 'evil',
        projectPath: h.fixture.projectPath,
        title: 'Evil',
      });

      // Whether creation succeeds is not the point — an out-of-bounds
      // bodyPath behaves exactly as a missing file did, so the doc simply has
      // no body. What must never happen is the contents coming back.
      const everything = JSON.stringify(await created.json().catch(() => ({})));
      expect(everything, '21a: the document body must not carry the outside file').not.toContain(secret.contents);

      // And again through everything the plan exposes, in case the body
      // surfaces on a later read rather than in the creation response.
      const plans = await h.client.raw('GET', `/api/plans?project=${encodeURIComponent(h.fixture.projectPath)}`)
        .then(r => r.json()) as Array<{ uid: string }>;
      for (const p of plans) {
        const bundle = await h.client.raw('GET', `/api/plans/${p.uid}`).then(r => r.text());
        expect(bundle, '21b: no nested item body may carry it either').not.toContain(secret.contents);
      }
    } finally {
      secret.cleanup();
      await h.teardown();
    }
  });
});

test.describe('8 — a system-doc slug cannot traverse', () => {
  test('a slug with path separators is refused, and writes nothing outside', async () => {
    const h = await setupHarness('sink-sysdoc-slug');
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-sysdoc-'));
    try {
      // The project must be OPENED before a confined endpoint will
      // answer: a root is never caller-nominated (Phase 19). Without
      // this the PRECONDITION below — the legitimate in-project case
      // that proves the check is not simply refusing everything — fails
      // on a 403 and the test proves nothing.
      await h.client.scanProject(h.fixture.projectPath);

      const target = path.join(outside, 'planted.md');
      const escape = path.relative(h.fixture.projectPath, target);

      for (const slug of [escape, '../escape', '../../escape', 'a/../../b', './../x']) {
        const res = await h.client.raw('POST', '/api/system-docs', {
          projectPath: h.fixture.projectPath,
          title: 'Traversal attempt',
          body: 'x',
          slug,
        });
        expect(res.ok, `slug ${JSON.stringify(slug)} must be refused`).toBe(false);
      }

      expect(fs.existsSync(target), 'nothing may be written outside the project').toBe(false);

      // The control: an ordinary slug still works, so the rule is "no dots and
      // no separators", not "system docs are broken".
      const ok = await h.client.raw('POST', '/api/system-docs', {
        projectPath: h.fixture.projectPath,
        title: 'Ordinary doc',
        body: 'x',
        slug: 'ordinary-doc',
      });
      expect(ok.ok, 'a normal slug must still be accepted').toBe(true);
    } finally {
      try { fs.rmSync(outside, { recursive: true, force: true }); } catch { /* */ }
      await h.teardown();
    }
  });
});

test.describe('A1 — conflict resolution cannot write outside the project', () => {
  test('an external file is not modified — the write used to happen before Git refused it', async () => {
    const h = await setupHarness('sink-conflict-resolve');
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-conflict-'));
    try {
      // The project must be OPENED before a confined endpoint will
      // answer: a root is never caller-nominated (Phase 19). Without
      // this the PRECONDITION below — the legitimate in-project case
      // that proves the check is not simply refusing everything — fails
      // on a 403 and the test proves nothing.
      await h.client.scanProject(h.fixture.projectPath);

      // Real conflict markers, so the resolver has something to do. Whether
      // git would later reject the path is beside the point: the finding is
      // that the FILESYSTEM MUTATION had already happened, and a git failure
      // afterwards does not undo it.
      const conflicted = [
        '<<<<<<< ours',
        '{"field": "OURS"}',
        '=======',
        '{"field": "THEIRS"}',
        '>>>>>>> theirs',
        '',
      ].join('\n');

      const victim = path.join(outside, 'victim.json');
      fs.writeFileSync(victim, conflicted);
      const before = fs.readFileSync(victim, 'utf-8');

      // Control: the same operation INSIDE the project rewrites the file, so
      // the refusals below are about the path and not about the endpoint.
      const inside = path.join(h.fixture.projectPath, 'in-project.json');
      fs.writeFileSync(inside, conflicted);
      const control = await h.client.raw('POST', '/api/conflicts/resolve', {
        projectPath: h.fixture.projectPath,
        filePath: 'in-project.json',
        mode: 'manual',
        resolutions: [{ field: 'field', pick: 'theirs' }],
      }).then((r) => r.json());
      expect(control.resolved, `precondition: an in-project resolve must work (${control.error})`).toBe(true);
      expect(fs.readFileSync(inside, 'utf-8'), 'and must actually rewrite the file').toContain('THEIRS');

      const escape = path.relative(h.fixture.projectPath, victim);
      for (const filePath of [escape, '../victim.json', '../../victim.json']) {
        const res = await h.client.raw('POST', '/api/conflicts/resolve', {
          projectPath: h.fixture.projectPath,
          filePath,
          mode: 'manual',
          resolutions: [{ field: 'field', pick: 'theirs' }],
        });
        const body = await res.text();
        expect(body, `${filePath} must not report success`).not.toContain('"resolved":true');
      }

      expect(
        fs.readFileSync(victim, 'utf-8'),
        'the external file must be byte-for-byte what it was',
      ).toBe(before);
    } finally {
      try { fs.rmSync(outside, { recursive: true, force: true }); } catch { /* */ }
      await h.teardown();
    }
  });
});

test.describe('12 — a branch name is not a safe path component', () => {
  test('a traversing branch neither reads from nor deletes outside the project', async () => {
    const h = await setupHarness('sink-contributions-accept');
    try {
      // The project must be OPENED before a confined endpoint will
      // answer: a root is never caller-nominated (Phase 19). Without
      // this the PRECONDITION below — the legitimate in-project case
      // that proves the check is not simply refusing everything — fails
      // on a 403 and the test proves nothing.
      await h.client.scanProject(h.fixture.projectPath);

      // `.codetrellis/contributions/<branch>` is built from a git branch name,
      // and git permits `/`. The value reaches a RECURSIVE DELETE — and,
      // before the delete, reads that copy whatever they find INTO the project.
      const contributionsDir = path.join(h.fixture.projectPath, '.codetrellis', 'contributions');
      const victim = path.resolve(contributionsDir, '..', '..', '..', 'victim');
      fs.mkdirSync(path.join(victim, 'items'), { recursive: true });
      fs.writeFileSync(path.join(victim, 'keep.txt'), 'important');
      fs.writeFileSync(
        path.join(victim, 'items', '001-stolen.yaml'),
        'uid: stolen\ntitle: SENTINEL-STOLEN-CONTRIBUTION\n',
      );

      // The control first: an ordinary branch is accepted and cleaned up, so
      // the refusals below cannot be the endpoint simply not working.
      const goodDir = path.join(contributionsDir, 'feature-x', 'items');
      fs.mkdirSync(goodDir, { recursive: true });
      fs.writeFileSync(path.join(goodDir, '001-real.yaml'), 'uid: real\ntitle: A real contribution\n');

      const control = await h.client.raw('POST', '/api/contributions/accept', {
        projectPath: h.fixture.projectPath,
        branch: 'feature-x',
        planSlug: 'some-plan',
      });
      expect(control.ok, 'precondition: an ordinary branch must work').toBe(true);
      expect((await control.json()).accepted, 'and must actually accept something').toBeGreaterThan(0);
      expect(
        fs.existsSync(path.join(contributionsDir, 'feature-x')),
        'precondition: an accepted contributions directory really is deleted',
      ).toBe(false);

      // Now the attack.
      for (const branch of ['../../../victim', '../victim', 'a/../../../../victim', '..']) {
        const res = await h.client.raw('POST', '/api/contributions/accept', {
          projectPath: h.fixture.projectPath,
          branch,
          planSlug: 'some-plan',
        });
        expect(res.ok, `branch ${JSON.stringify(branch)} must be refused`).toBe(false);
      }

      expect(fs.existsSync(path.join(victim, 'keep.txt')), 'the outside directory must survive').toBe(true);

      // And nothing from outside may have been copied in on the way. The
      // delete was confined already; the READS above it were not.
      const planItems = path.join(h.fixture.projectPath, '.codetrellis', 'plans', 'some-plan', 'items');
      const copied = fs.existsSync(planItems)
        ? fs.readdirSync(planItems).map((f) => fs.readFileSync(path.join(planItems, f), 'utf-8')).join('\n')
        : '';
      expect(copied, 'copying a file in is a read of it').not.toContain('SENTINEL-STOLEN-CONTRIBUTION');
    } finally {
      await h.teardown();
    }
  });
});

test.describe('11 — reference resolution is not an existence oracle', () => {
  test('a path that exists and one that does not are indistinguishable', async () => {
    const h = await setupHarness('sink-existence-oracle');
    const secret = plantSecret();
    try {
      // The project must be OPENED before these endpoints will answer:
      // a project root is never caller-nominated (Phase 19), so an
      // unopened path is refused before the check under test can run.
      // Without this the assertion below would pass on a 403 and prove
      // nothing about the existence oracle.
      await h.client.scanProject(h.fixture.projectPath);


      const ask = async (ref: string) => {
        const res = await h.client.raw(
          'GET',
          `/api/pantry/resolve?project=${encodeURIComponent(h.fixture.projectPath)}&refs=${encodeURIComponent(ref)}`,
        ).then(r => r.json()) as { results: Array<{ status: string; reason?: string; absolutePath?: string }> };
        return res.results[0];
      };

      const real = await ask(secret.file);
      const fake = await ask(path.join(secret.dir, 'does-not-exist-9f2a.txt'));

      // One probe per guess was the oracle: "not found on this machine"
      // versus "not accessible" told the caller whether ANY path under the
      // home directory existed.
      expect(real.status, 'both must reach the same status').toBe(fake.status);
      expect(real.reason, 'and give the same reason').toBe(fake.reason);
      expect(real.absolutePath, 'and no absolute path may come back').toBeUndefined();

      // Also true of a home-directory path, which is where the oracle was
      // most useful to a caller.
      const homeReal = await ask(path.join(os.homedir(), '.zshrc'));
      const homeFake = await ask(path.join(os.homedir(), '.no-such-file-3c1b'));
      expect(homeReal.status).toBe(homeFake.status);
      expect(homeReal.reason).toBe(homeFake.reason);
    } finally {
      secret.cleanup();
      await h.teardown();
    }
  });
});

test.describe('3 — an attachment file_ref cannot read outside', () => {
  test('neither an absolute path outside the home directory nor a traversal is served', async () => {
    const h = await setupHarness('sink-attachment-ref');
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-attach-'));
    try {
      // The project must be OPENED before a confined endpoint will
      // answer: a root is never caller-nominated (Phase 19). Without
      // this the PRECONDITION below — the legitimate in-project case
      // that proves the check is not simply refusing everything — fails
      // on a 403 and the test proves nothing.
      await h.client.scanProject(h.fixture.projectPath);

      const plan = await h.client.createPlan({ title: 'Attachment plan', projectPath: h.fixture.projectPath });
      const item = await h.client.raw('POST', `/api/plans/${plan.uid}/items`, {
        kind: 'task',
        title: 'Holder for the attachment',
      }).then((r) => r.json()) as { uid: string };
      expect(item.uid, 'precondition: the plan needs a real item to attach to').toBeTruthy();

      const attach = async (value: string, projectRoot?: string) => {
        const res = await h.client.raw('POST', `/api/items/${item.uid}/attachments`, {
          kind: 'file_ref', value, label: 'ref', ...(projectRoot ? { projectRoot } : {}),
        });
        expect(res.ok, `precondition: creating the attachment record must succeed (${value})`).toBe(true);
        const created = await res.json() as { uid: string };
        return h.client.raw('GET', `/api/attachments/${created.uid}/file`);
      };

      // Control: a file INSIDE the project is served. Without this the
      // refusals below could be the endpoint simply not working.
      // The route serves previews (images, video), typed by extension.
      const insideName = 'attachable.png';
      fs.writeFileSync(path.join(h.fixture.projectPath, insideName), 'SENTINEL-INSIDE-OK');
      const ok = await attach(insideName, h.fixture.projectPath);
      expect(ok.ok, 'precondition: an in-project reference must be served').toBe(true);
      expect(await ok.text()).toContain('SENTINEL-INSIDE-OK');
      // Typed by extension, never sniffed, never cached (the file can change).
      expect(ok.headers.get('content-type')).toBe('image/png');
      expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
      expect(ok.headers.get('cache-control')).toBe('no-store');

      // A byte range, as video seeking asks for.
      const created = await (await h.client.raw('POST', `/api/items/${item.uid}/attachments`, {
        kind: 'file_ref', value: insideName, label: 'ref',
      })).json() as { uid: string };
      const partial = await authFetch(h.backend, `/api/attachments/${created.uid}/file`, {
        headers: { Range: 'bytes=0-7' },
      });
      expect(partial.status).toBe(206);
      expect(await partial.text()).toBe('SENTINEL');

      // A directory is refused cleanly rather than failing mid-stream.
      fs.mkdirSync(path.join(h.fixture.projectPath, 'a-folder.png'), { recursive: true });
      const dir = await attach('a-folder.png', h.fixture.projectPath);
      expect(dir.status).toBe(404);

      // 1. an absolute path outside the user's home directory
      const victim = path.join(outside, 'secret.txt');
      fs.writeFileSync(victim, 'SENTINEL-OUTSIDE-HOME');
      const abs = await attach(victim);
      expect(abs.ok, 'an absolute path outside the home directory must not be served').toBe(false);
      expect(await abs.text()).not.toContain('SENTINEL-OUTSIDE-HOME');

      // 2. traversal out through the project root
      const escape = path.relative(h.fixture.projectPath, victim);
      expect(escape.startsWith('..'), 'precondition: the path really does climb out').toBe(true);
      const rel = await attach(escape, h.fixture.projectPath);
      expect(rel.ok, 'a traversal out of the project must not be served').toBe(false);
      expect(await rel.text()).not.toContain('SENTINEL-OUTSIDE-HOME');

      // 3. a symlink inside the project pointing out — the case a text
      //    comparison cannot see (A2, applied to this sink).
      const link = path.join(h.fixture.projectPath, 'looks-inside.png');
      try { fs.unlinkSync(link); } catch { /* */ }
      fs.symlinkSync(victim, link, 'file');
      const viaLink = await attach('looks-inside.png', h.fixture.projectPath);
      expect(viaLink.ok, 'a link out of the project must not be followed').toBe(false);
      const refusal = await viaLink.text();
      expect(refusal).not.toContain('SENTINEL-OUTSIDE-HOME');
      expect(refusal, 'a refusal never carries a path').not.toContain(h.fixture.projectPath);
    } finally {
      try { fs.rmSync(outside, { recursive: true, force: true }); } catch { /* */ }
      await h.teardown();
    }
  });
});
