/**
 * A CSV citation is checked against the cells the viewer shows (Phase 32
 * §0.4e). The check split each line on commas, so a quoted comma made an
 * extra column: `C3` "existed" in a two-column file whenever row 3 had
 * "APAC, East" in it, and the viewer and read_material had no such cell.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkLocator } from './criterion-checks';
import type { Artefact } from './artefact-service';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-checks-')));
fs.writeFileSync(path.join(root, 'sales.csv'), 'region,revenue\nEMEA,120\n"APAC, East",80\nAMER,95\n');
const csv: Artefact = {
  uid: 'a1', itemUid: 'i1', path: 'sales.csv', role: 'material', sha256: null, size: null, mtime: null,
  label: null, recordedBy: 't', recordedByType: 'human', createdAt: 0,
};
const statuses = (range: string) => checkLocator(root, csv, { range }).map((f) => [f.status, f.message]);

test('a cell the file has passes', () => {
  assert.deepEqual(statuses('B3'), [['pass', 'sales.csv has B3']]);
});

test('a quoted comma is one cell, not a third column', () => {
  assert.deepEqual(statuses('C3'), [['fail', 'C3 is outside sales.csv, which has 4 rows and 2 columns']]);
});

test('a row past the end fails', () => {
  assert.deepEqual(statuses('A5'), [['fail', 'A5 is outside sales.csv, which has 4 rows and 2 columns']]);
});
