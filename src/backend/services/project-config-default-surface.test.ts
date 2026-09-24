/**
 * Phase 31 §10.1 — a folder says where opening it lands, and only the
 * choices that differ from the default are written down.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getProjectConfig, updateProjectConfig, resetProjectConfigCache } from './project-config-service';

test('defaultSurface round-trips; the graph is the default and is not stored; nonsense is ignored', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-surface-')));
  try {
    const file = path.join(root, '.codetrellis', 'config.json');
    assert.equal(updateProjectConfig(root, { defaultSurface: 'brief' }).defaultSurface, 'brief');
    resetProjectConfigCache();
    assert.equal(getProjectConfig(root).defaultSurface, 'brief');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).defaultSurface, 'brief');

    updateProjectConfig(root, { defaultSurface: 'graph' });
    assert.equal('defaultSurface' in JSON.parse(fs.readFileSync(file, 'utf8')), false);

    fs.writeFileSync(file, JSON.stringify({ defaultSurface: 'spreadsheet' }));
    resetProjectConfigCache();
    assert.equal(getProjectConfig(root).defaultSurface, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
