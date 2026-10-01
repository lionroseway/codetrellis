/**
 * Phase 32 C2.2a — which review host a project's work goes to, from its
 * remote alone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectHost } from './detect';

test('GitHub in each of git\'s spellings, with what it would read', () => {
  for (const remote of ['git@github.com:acme/app.git', 'ssh://git@github.com/acme/app.git', 'https://github.com/acme/app', 'https://GitHub.com/acme/app.git/']) {
    const h = detectHost(remote)!;
    assert.deepEqual([h.kind, h.hostname, h.slug, h.webUrl, h.supported], ['github', 'github.com', 'acme/app', 'https://github.com/acme/app', true], remote);
    assert.match(h.asks!, /^Reads the pull requests for this project's branches on github\.com\/acme\/app: .* It changes nothing on GitHub\.$/);
  }
});

test('GitLab (subgroups too) and Bitbucket are supported, each saying what it would read; others are named and left to git', () => {
  const lab = detectHost('git@gitlab.com:team/sub/app.git')!;
  assert.deepEqual([lab.kind, lab.owner, lab.repo, lab.slug, lab.supported], ['gitlab', 'team', 'sub/app', 'team/sub/app', true]);
  assert.match(lab.asks!, /^Reads the merge requests for this project's branches on gitlab\.com\/team\/sub\/app: .*pipeline.* It changes nothing on GitLab\.$/);
  const bucket = detectHost('https://bitbucket.org/acme/app.git')!;
  assert.deepEqual([bucket.kind, bucket.supported], ['bitbucket', true]);
  assert.match(bucket.asks!, /build statuses .* It changes nothing on Bitbucket\.$/);
  const own = detectHost('git@git.acme.internal:acme/app.git')!;
  assert.deepEqual([own.kind, own.hostname, own.supported, own.asks], [null, 'git.acme.internal', false, null]);
});

test('no host at all: none, a local path, a file URL, a name without an owner; credentials never kept', () => {
  for (const remote of [null, '', '/srv/git/app.git', 'file:///srv/git/app.git', 'https://github.com/app', '../origin.git']) {
    assert.equal(detectHost(remote), null, String(remote));
  }
  // A token pasted into a remote is not carried into anything the app shows.
  const h = detectHost('https://x-access-token:ghp_secret@github.com/acme/app.git')!;
  assert.equal(h.webUrl, 'https://github.com/acme/app');
  assert.ok(!JSON.stringify(h).includes('ghp_secret'));
});
