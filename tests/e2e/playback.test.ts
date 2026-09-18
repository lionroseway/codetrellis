/**
 * Fast-forward — Phase 26, layer C.
 *
 * See [docs/PHASE-26-CODE-FIRST-SURFACE.md](../../docs/PHASE-26-CODE-FIRST-SURFACE.md).
 *
 * The sequence is discrete by design: between two frames a file either
 * has a recorded state or it does not, and a tween of source code would
 * be fiction. So these tests pin ordering, deltas, and the two places
 * the service declines to report a number it does not have.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness } from '../harness';

interface PlaybackFrame {
  spec: string;
  label: string;
  kind: string;
  timestamp: number | null;
  delta: {
    added: number;
    removed: number;
    modified: number;
    edgesAdded: number | null;
    edgesRemoved: number | null;
  } | null;
  changedFiles: string[];
  truncated: boolean;
}

interface PlaybackSequence {
  frames: PlaybackFrame[];
  notes: string[];
}

async function playback(
  h: { client: { raw(m: string, p: string): Promise<Response> }; fixture: { projectPath: string } },
  query = '',
): Promise<PlaybackSequence> {
  const res = await h.client.raw(
    'GET',
    `/api/playback?project=${encodeURIComponent(h.fixture.projectPath)}${query}`,
  );
  expect(res.ok).toBe(true);
  return (await res.json()) as PlaybackSequence;
}

/** Add a commit so the fixture has more than one point of history. */
function commitChange(projectPath: string, relPath: string, text: string, message: string): void {
  fs.appendFileSync(path.join(projectPath, relPath), text);
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Harness',
    GIT_AUTHOR_EMAIL: 'harness@codetrellis.local',
    GIT_COMMITTER_NAME: 'Harness',
    GIT_COMMITTER_EMAIL: 'harness@codetrellis.local',
  };
  execFileSync('git', ['add', '-A'], { cwd: projectPath, env });
  execFileSync('git', ['commit', '-m', message], { cwd: projectPath, env });
}

test.describe('Fast-forward (Phase 26)', () => {
  test.setTimeout(120_000);

  test('frames run oldest to newest and end at the working tree', async () => {
    const h = await setupHarness('playback-order');
    try {
      commitChange(h.fixture.projectPath, 'packages/shared/src/types.ts', '\nexport type A = 1;\n', 'second');
      commitChange(h.fixture.projectPath, 'packages/shared/src/types.ts', '\nexport type B = 2;\n', 'third');
      await h.client.scanProject(h.fixture.projectPath);

      const seq = await playback(h);
      expect(seq.frames.length).toBeGreaterThanOrEqual(3);

      // "Fast-forward" only means anything if forward is later.
      //
      // Only `live` is allowed to have no timestamp — it is the present. This
      // used to filter out every null before comparing, which removed exactly
      // the frames that were mis-ordered: checkpoints carried no time, sorted
      // to epoch 0, and landed in front of commits from months earlier. The
      // assertion passed throughout.
      const historical = seq.frames.filter((f) => f.spec !== 'live');
      expect(
        historical.every((f) => f.timestamp !== null),
        'every frame but live must carry a time: ' + JSON.stringify(historical.map((f) => [f.spec, f.timestamp])),
      ).toBe(true);
      const times = historical.map((f) => f.timestamp as number);
      const sorted = [...times].sort((a, b) => a - b);
      expect(times).toEqual(sorted);

      // It always ends at the present.
      expect(seq.frames[seq.frames.length - 1].spec).toBe('live');
    } finally {
      await h.teardown();
    }
  });

  test('the first frame has no delta — there is nothing before it', async () => {
    const h = await setupHarness('playback-first-frame');
    try {
      commitChange(h.fixture.projectPath, 'packages/shared/src/types.ts', '\nexport type A = 1;\n', 'second');
      await h.client.scanProject(h.fixture.projectPath);

      const seq = await playback(h);
      expect(seq.frames[0].delta).toBeNull();
      expect(seq.frames[0].changedFiles).toHaveLength(0);
    } finally {
      await h.teardown();
    }
  });

  test('a later frame reports the files that changed to reach it', async () => {
    const h = await setupHarness('playback-delta');
    try {
      commitChange(h.fixture.projectPath, 'packages/shared/src/types.ts', '\nexport type Added = 1;\n', 'change types');
      await h.client.scanProject(h.fixture.projectPath);

      const seq = await playback(h);
      const withDelta = seq.frames.filter((f) => f.delta !== null);
      expect(withDelta.length).toBeGreaterThan(0);

      const touchedTypes = withDelta.some((f) => f.changedFiles.some((p) => p.endsWith('types.ts')));
      expect(touchedTypes, 'the commit that edited types.ts should say so').toBe(true);
    } finally {
      await h.teardown();
    }
  });

  test('edge counts are omitted for commit frames rather than reported as zero', async () => {
    const h = await setupHarness('playback-edges');
    try {
      commitChange(h.fixture.projectPath, 'packages/shared/src/types.ts', '\nexport type A = 1;\n', 'second');
      await h.client.scanProject(h.fixture.projectPath);

      const seq = await playback(h);
      const commitFrames = seq.frames.filter((f) => f.kind === 'commit' && f.delta);

      for (const frame of commitFrames) {
        // Reporting "0 edges changed" for a comparison that never looked
        // at edges would read as a finding rather than an absence.
        expect(frame.delta!.edgesAdded).toBeNull();
        expect(frame.delta!.edgesRemoved).toBeNull();
      }
      expect(seq.notes.join(' ')).toMatch(/file list only/);
    } finally {
      await h.teardown();
    }
  });

  test('a repository with nothing to scrub says so instead of returning one frame', async () => {
    const h = await setupHarness('playback-thin');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const seq = await playback(h, '&limit=2');
      // The fixture has a single initial commit, so history is thin.
      if (seq.frames.length < 2) {
        expect(seq.notes.join(' ')).toMatch(/Not enough history/);
      }
    } finally {
      await h.teardown();
    }
  });

  test('the frame count is bounded by limit', async () => {
    const h = await setupHarness('playback-limit');
    try {
      for (let i = 0; i < 4; i++) {
        commitChange(h.fixture.projectPath, 'packages/shared/src/types.ts', `\nexport type T${i} = ${i};\n`, `c${i}`);
      }
      await h.client.scanProject(h.fixture.projectPath);

      const seq = await playback(h, '&limit=3');
      // limit commits, plus the live frame.
      expect(seq.frames.length).toBeLessThanOrEqual(4);
    } finally {
      await h.teardown();
    }
  });
});

test.describe('Checkpoints in the sequence (M1)', () => {
  test.setTimeout(120_000);

  test('a checkpoint is placed by its own time, not at the beginning', async () => {
    const h = await setupHarness('playback-checkpoint-order');
    try {
      commitChange(h.fixture.projectPath, 'packages/shared/src/types.ts', '\nexport type A = 1;\n', 'second');
      await h.client.scanProject(h.fixture.projectPath);

      // Capture a checkpoint NOW — later than every commit in the fixture.
      const cap = await h.client.raw('POST', '/api/trellis/capture', {
        projectPath: h.fixture.projectPath,
        name: 'after the commits',
      });
      expect(cap.ok).toBe(true);

      const seq = await playback(h);
      const checkpoint = seq.frames.find((f) => f.spec.startsWith('checkpoint:'));

      // includeCheckpoints defaults to true, and on a repo with enough commits
      // the checkpoint used to be trimmed off the front and never appear.
      expect(checkpoint, 'the checkpoint appears in the sequence').toBeTruthy();
      expect(checkpoint!.timestamp, 'it carries its own createdAt').not.toBeNull();

      // It was taken after the commits, so it belongs after them.
      const commits = seq.frames.filter((f) => f.spec.startsWith('commit:'));
      for (const c of commits) {
        expect(checkpoint!.timestamp!).toBeGreaterThanOrEqual(c.timestamp!);
      }
    } finally {
      await h.teardown();
    }
  });
});
