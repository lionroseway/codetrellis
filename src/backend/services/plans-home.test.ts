import { test } from 'node:test';
import assert from 'node:assert/strict';
import { folderWords, matchesRef, normaliseRemote } from './plans-home';
import { parsePlansFolderRef } from './project-config-service';

test('a remote is one string however it is spelled', () => {
  const want = 'github.com/acme/plans';
  for (const r of ['git@github.com:acme/plans.git', 'https://github.com/acme/plans', 'https://GitHub.com/acme/plans.git/', 'ssh://git@github.com/acme/plans']) {
    assert.equal(normaliseRemote(r), want, r);
  }
  // The path keeps its case: on most hosts it is the repository's name.
  assert.equal(normaliseRemote('https://github.com/Acme/Plans'), 'github.com/Acme/Plans');
  assert.notEqual(normaliseRemote('git@github.com:acme/website.git'), want);
});

test('the committed config names a folder portably, and refuses what would leak or climb', () => {
  assert.deepEqual(parsePlansFolderRef({ kind: 'git', remote: ' git@github.com:acme/plans.git ' }), { kind: 'git', remote: 'git@github.com:acme/plans.git' });
  assert.deepEqual(parsePlansFolderRef({ kind: 'synced', provider: 'onedrive', place: '/Acme\\Board pack/' }), { kind: 'synced', provider: 'onedrive', place: 'Acme/Board pack' });
  assert.equal(parsePlansFolderRef({ kind: 'git', remote: 'https://sam:hunter2@github.com/acme/plans' }), null);
  assert.equal(parsePlansFolderRef({ kind: 'git', remote: 'has a space' }), null);
  assert.equal(parsePlansFolderRef({ kind: 'synced', provider: 'onedrive', place: '../secrets' }), null);
  assert.equal(parsePlansFolderRef({ kind: 'synced', provider: 'onedrive', place: 'C:/Users/sam' }), null);
  assert.equal(parsePlansFolderRef({ kind: 'synced', provider: 'dropbox', place: 'Acme' }), null);
  assert.equal(parsePlansFolderRef({ kind: 'synced', provider: 'onedrive', place: 'a//b' }), null);
  assert.equal(parsePlansFolderRef({ kind: 'svn' }), null);
  assert.equal(parsePlansFolderRef('git@github.com:acme/plans.git'), null);
});

test('a synced folder is matched by its place at the end of the path, wherever the copy sits', () => {
  const ref = { kind: 'synced' as const, provider: 'onedrive' as const, place: 'Acme/Board pack' };
  assert.deepEqual(matchesRef('/Users/sam/Library/CloudStorage/OneDrive-Acme/Acme/Board pack', ref), { ok: true });
  assert.deepEqual(matchesRef('/home/dana/OneDrive - Acme/Acme/Board pack', ref), { ok: true });
  assert.deepEqual(matchesRef('/home/dana/OneDrive - Acme/Acme/Other', ref), { ok: false, why: 'it is not a folder named Acme/Board pack' });
  assert.deepEqual(matchesRef('/Board pack', ref), { ok: false, why: 'it is not a folder named Acme/Board pack' });
});

test('a folder in words', () => {
  assert.equal(folderWords({ kind: 'git', remote: 'git@github.com:acme/plans.git' }), 'the planning repository github.com/acme/plans');
  assert.equal(folderWords({ kind: 'synced', provider: 'sharepoint', place: 'Acme/Board pack' }), 'SharePoint: Acme/Board pack');
  assert.equal(folderWords({ kind: 'synced', provider: 'folder', place: 'Plans' }), 'a synced folder: Plans');
});
