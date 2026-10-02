import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { attribSaysOffline, findPlace, isPosixPlaceholder, macRoots, underCloudRoot, windowsRoots } from './cloud-files';

test('macOS: File Provider folders and the older client\'s, by provider and account', () => {
  const dirs: Record<string, string[]> = {
    '/Users/sam/Library/CloudStorage': ['OneDrive-Personal', 'OneDrive-Acme Ltd', 'OneDrive-SharedLibraries-Acme Ltd', 'Dropbox', 'GoogleDrive-sam@acme.test'],
    '/Users/sam': ['Desktop', 'OneDrive - Acme Ltd', 'Library'],
  };
  assert.deepEqual(macRoots('/Users/sam', (d) => dirs[d] ?? []), [
    { provider: 'onedrive', path: '/Users/sam/Library/CloudStorage/OneDrive-Personal', account: 'Personal' },
    { provider: 'onedrive', path: '/Users/sam/Library/CloudStorage/OneDrive-Acme Ltd', account: 'Acme Ltd' },
    { provider: 'sharepoint', path: '/Users/sam/Library/CloudStorage/OneDrive-SharedLibraries-Acme Ltd', account: 'Acme Ltd' },
    { provider: 'onedrive', path: '/Users/sam/OneDrive - Acme Ltd', account: 'Acme Ltd' },
  ]);
});

test('Windows: the environment and the client\'s mount points, SharePoint libraries told apart', () => {
  const reg = [
    'HKEY_CURRENT_USER\\Software\\SyncEngines\\Providers\\OneDrive\\4c2a',
    '    MountPoint    REG_SZ    C:\\Users\\sam\\OneDrive - Acme Ltd',
    '',
    'HKEY_CURRENT_USER\\Software\\SyncEngines\\Providers\\OneDrive\\9f1e',
    '    MountPoint    REG_SZ    C:\\Users\\sam\\Acme Ltd\\Finance - Documents',
  ].join('\r\n');
  assert.deepEqual(windowsRoots({ OneDriveCommercial: 'C:\\Users\\sam\\OneDrive - Acme Ltd', OneDriveConsumer: 'C:\\Users\\sam\\OneDrive' }, reg), [
    { provider: 'onedrive', path: 'C:\\Users\\sam\\OneDrive - Acme Ltd', account: 'Acme Ltd' },
    { provider: 'onedrive', path: 'C:\\Users\\sam\\OneDrive', account: 'Personal' },
    { provider: 'onedrive', path: 'C:\\Users\\sam\\OneDrive - Acme Ltd', account: 'Acme Ltd' },
    { provider: 'sharepoint', path: 'C:\\Users\\sam\\Acme Ltd\\Finance - Documents', account: 'Acme Ltd' },
  ]);
  assert.deepEqual(windowsRoots({}, ''), []);
});

test('a placeholder is told from a file on disk without reading it', () => {
  const st = (size: number, blocks: number, file = true) => ({ size, blocks, isFile: () => file });
  assert.equal(isPosixPlaceholder(st(5000, 0)), true);
  assert.equal(isPosixPlaceholder(st(5000, 16)), false);
  assert.equal(isPosixPlaceholder(st(0, 0)), false);
  assert.equal(isPosixPlaceholder(st(5000, 0, false)), false);
  assert.equal(attribSaysOffline('A    O    U       C:\\Users\\sam\\OneDrive - Acme\\plan.yaml'), true);
  assert.equal(attribSaysOffline('A            P    C:\\Users\\sam\\OneDrive - Acme\\plan.yaml'), false);
  assert.equal(attribSaysOffline('A                 C:\\Users\\sam\\Documents\\Old.docx'), false);
  assert.equal(attribSaysOffline('A    O            \\\\server\\share\\plan.yaml'), true);
});

test('a place is found under the provider\'s roots, wherever they are', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-cloud-'));
  const root = path.join(tmp, 'OneDrive - Acme');
  fs.mkdirSync(path.join(root, 'Acme', 'Board pack'), { recursive: true });
  const roots = [{ provider: 'onedrive' as const, path: root, account: 'Acme' }];
  assert.equal(findPlace('onedrive', 'Acme/Board pack', roots), path.join(root, 'Acme', 'Board pack'));
  assert.equal(findPlace('onedrive', 'Acme/Other', roots), null);
  assert.equal(findPlace('sharepoint', 'Acme/Board pack', roots), null);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('a file with no blocks is a placeholder only under a sync client\'s folder', () => {
  const roots = [{ provider: 'onedrive' as const, path: '/Users/sam/Library/CloudStorage/OneDrive-Acme', account: 'Acme' }];
  assert.equal(underCloudRoot('/Users/sam/Library/CloudStorage/OneDrive-Acme/Board pack/plan.yaml', roots), true);
  assert.equal(underCloudRoot('/Users/sam/Library/CloudStorage/OneDrive-Acme', roots), false);
  assert.equal(underCloudRoot('/Users/sam/Library/CloudStorage/OneDrive-Acme Ltd/x', roots), false);
  assert.equal(underCloudRoot('/Users/sam/work/huge.docx', roots), false);
});
