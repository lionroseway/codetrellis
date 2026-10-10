/**
 * The `codetrellis` command from the desktop app: where it goes for each way
 * the app is installed, that it is never put over someone else's without
 * being asked, and that the app keeps its own one pointing at itself.
 *
 * Real files in a temporary home; the program runner (osascript, PowerShell)
 * is a stub that records what it was asked to do.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyCliInstall, appImageLauncher, LAUNCHER_MARK, planCliInstall, refreshCliInstall, removeCliInstall, type CliMachine, type Run } from './cli-install';

let tmp: string;
let home: string;
let resources: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-cli-install-')));
  home = path.join(tmp, 'home');
  resources = path.join(tmp, 'opt', 'CodeTrellis', 'resources');
  fs.mkdirSync(path.join(resources, 'cli', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(resources, 'cli', 'bin', 'codetrellis'), '#!/bin/sh\necho launcher\n', { mode: 0o755 });
  fs.mkdirSync(home, { recursive: true });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const linux = (over: Partial<CliMachine> = {}): CliMachine => ({
  platform: 'linux',
  home,
  execPath: path.join(tmp, 'opt', 'CodeTrellis', 'codetrellis'),
  resourcesPath: resources,
  electronVersion: '44.4.1',
  env: { PATH: '/usr/bin' },
  ...over,
});

function recorder(): { run: Run; calls: Array<{ command: string; args: string[]; env?: Record<string, string> }> } {
  const calls: Array<{ command: string; args: string[]; env?: Record<string, string> }> = [];
  return { calls, run: async (command, args, env) => { calls.push({ command, args, env }); } };
}

describe('where the command goes', () => {
  test('not the installed app: refused, and the reason names the other ways', () => {
    const dev = planCliInstall(linux({ execPath: '/repo/node_modules/electron/dist/electron' }));
    assert.equal(dev.ok, false);
    assert.match(!dev.ok ? dev.reason : '', /npm link.*npm install -g codetrellis/);
    assert.equal(planCliInstall(linux({ electronVersion: undefined })).ok, false);
  });

  test('the Windows portable build: refused, because it unpacks somewhere new each time', () => {
    const p = planCliInstall(linux({ platform: 'win32', env: { PORTABLE_EXECUTABLE_FILE: 'C:\\x\\CodeTrellis-Portable.exe' } }));
    assert.equal(p.ok, false);
    assert.match(!p.ok ? p.reason : '', /portable build/);
  });

  test('Linux .deb / .rpm: a link in ~/.local/bin to the app\'s launcher, no password', () => {
    const p = planCliInstall(linux());
    assert.ok(p.ok);
    assert.equal(p.how, 'link');
    assert.equal(p.target, path.join(home, '.local', 'bin', 'codetrellis'));
    assert.equal(p.source, path.join(resources, 'cli', 'bin', 'codetrellis'));
    assert.equal(p.admin, false);
    assert.equal(p.state, 'missing');
    assert.equal(p.onPath, false);
    const onPath = planCliInstall(linux({ env: { PATH: `/usr/bin:${home}/.local/bin` } }));
    assert.ok(onPath.ok && onPath.onPath, '~/.local/bin on the PATH is said');
  });

  test('macOS: a link in /usr/local/bin, asking for a password only when that folder is not writable', () => {
    const mac = (macBin: string) => planCliInstall({ ...linux(), platform: 'darwin', macBin, execPath: '/Applications/CodeTrellis.app/Contents/MacOS/CodeTrellis' });
    const locked = path.join(tmp, 'locked');
    fs.mkdirSync(locked, { mode: 0o555 });
    const open = path.join(tmp, 'usr-local-bin');
    fs.mkdirSync(open);
    const a = mac(open);
    assert.ok(a.ok);
    assert.equal(a.target, path.join(open, 'codetrellis'));
    assert.equal(a.admin, false);
    // root can write anywhere, so the locked case is only meaningful otherwise.
    if (process.getuid?.() !== 0) {
      const b = mac(locked);
      assert.ok(b.ok && b.admin);
      assert.match(b.ok ? b.says : '', /asks for your password/);
    }
  });

  test('Windows installer: the launcher\'s folder on the user PATH, read back from the registry', () => {
    const win = (userPath: string): CliMachine => ({
      ...linux(), platform: 'win32', resourcesPath: 'C:\\Users\\sam\\AppData\\Local\\Programs\\CodeTrellis\\resources',
      execPath: 'C:\\Users\\sam\\AppData\\Local\\Programs\\CodeTrellis\\CodeTrellis.exe', windowsUserPath: () => userPath,
    });
    const dir = 'C:\\Users\\sam\\AppData\\Local\\Programs\\CodeTrellis\\resources\\cli\\bin';
    const p = planCliInstall(win('C:\\tools'));
    assert.ok(p.ok);
    assert.equal(p.how, 'path');
    assert.equal(p.target, dir);
    assert.equal(p.state, 'missing');
    assert.equal(planCliInstall(win(`C:\\tools;${dir.toUpperCase()}\\`)).ok && (planCliInstall(win(`C:\\tools;${dir}\\`)) as { state: string }).state, 'installed');
  });
});

describe('adding it', () => {
  test('Linux: the link is made, and the app\'s launcher runs through it', async () => {
    const r = await applyCliInstall(linux());
    assert.deepEqual(r, { ok: true, target: path.join(home, '.local', 'bin', 'codetrellis'), onPath: false });
    assert.equal(fs.readlinkSync(path.join(home, '.local', 'bin', 'codetrellis')), path.join(resources, 'cli', 'bin', 'codetrellis'));
    assert.equal(execFileSync(path.join(home, '.local', 'bin', 'codetrellis'), { encoding: 'utf8' }).trim(), 'launcher');
    const again = planCliInstall(linux());
    assert.ok(again.ok && again.state === 'installed');
  });

  test('another codetrellis there (npm\'s): named, and replaced only when asked', async () => {
    const bin = path.join(home, '.local', 'bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.symlinkSync('../lib/node_modules/codetrellis/bin/codetrellis.mjs', path.join(bin, 'codetrellis'));
    const p = planCliInstall(linux());
    assert.ok(p.ok && p.state === 'other');
    assert.match(p.ok ? p.existing ?? '' : '', /a link to \.\.\/lib\/node_modules\/codetrellis/);
    const refused = await applyCliInstall(linux());
    assert.equal(refused.ok, false);
    assert.equal(fs.readlinkSync(path.join(bin, 'codetrellis')), '../lib/node_modules/codetrellis/bin/codetrellis.mjs', 'left alone');
    assert.equal((await applyCliInstall(linux(), { replace: true })).ok, true);
    assert.equal(fs.readlinkSync(path.join(bin, 'codetrellis')), path.join(resources, 'cli', 'bin', 'codetrellis'));
  });

  test('macOS needing a password: one osascript call, the paths quoted by AppleScript, nothing spliced raw', async () => {
    const locked = path.join(tmp, "it's locked");
    fs.mkdirSync(locked, { mode: 0o555 });
    if (process.getuid?.() === 0) return; // root writes anywhere; the password path cannot be reached here
    const { run, calls } = recorder();
    const m: CliMachine = { ...linux(), platform: 'darwin', macBin: locked };
    const r = await applyCliInstall(m, {}, run);
    assert.equal(r.ok, false, 'the stub made no link, so the result says so');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, 'osascript');
    assert.match(calls[0].args[1], /with administrator privileges$/);
    assert.match(calls[0].args[1], /quoted form of ".*it's locked"/);
  });

  test('Windows: PowerShell is given the folder through the environment, never in the command', async () => {
    let userPath = 'C:\\tools';
    const dir = 'C:\\Apps\\CodeTrellis\\resources\\cli\\bin';
    const m: CliMachine = { ...linux(), platform: 'win32', resourcesPath: 'C:\\Apps\\CodeTrellis\\resources', execPath: 'C:\\Apps\\CodeTrellis\\CodeTrellis.exe', windowsUserPath: () => userPath };
    const calls: Array<{ command: string; args: string[]; env?: Record<string, string> }> = [];
    const run: Run = async (command, args, env) => { calls.push({ command, args, env }); userPath = `${userPath};${env?.CT_DIR}`; };
    const r = await applyCliInstall(m, {}, run);
    assert.deepEqual(r, { ok: true, target: dir, onPath: false });
    assert.equal(calls[0].command, 'powershell.exe');
    assert.equal(calls[0].env?.CT_DIR, dir);
    assert.ok(!calls[0].args.join(' ').includes('CodeTrellis\\resources'), 'the folder is not in the command');
  });

  test('AppImage: a launcher in ~/.local/bin that names the AppImage file and loads the CLI from its mount', async () => {
    const appImage = path.join(tmp, 'Downloads', 'CodeTrellis-0.3.0-x86_64.AppImage');
    const m = linux({ env: { PATH: '/usr/bin', APPIMAGE: appImage, APPDIR: path.join(tmp, 'opt') } });
    const p = planCliInstall(m);
    assert.ok(p.ok && p.how === 'launcher');
    assert.equal((await applyCliInstall(m)).ok, true);
    const text = fs.readFileSync(path.join(home, '.local', 'bin', 'codetrellis'), 'utf8');
    assert.equal(text, appImageLauncher(appImage));
    assert.ok(text.includes(LAUNCHER_MARK));
    // --no-sandbox last, after --, or AppRun puts it first, where Node mode refuses it.
    assert.match(text, /ELECTRON_RUN_AS_NODE=1 exec '.*CodeTrellis-0\.3\.0-x86_64\.AppImage' -e ".*'cli', 'bin', 'app\.cjs'.*" -- "\$@" --no-sandbox\n/);
    assert.equal(fs.statSync(path.join(home, '.local', 'bin', 'codetrellis')).mode & 0o111, 0o111);
  });
});

describe('keeping it and removing it', () => {
  test('on launch, an AppImage that moved has its launcher rewritten; someone else\'s file is never touched', async () => {
    const first = linux({ env: { APPIMAGE: path.join(tmp, 'a', 'CodeTrellis.AppImage'), APPDIR: path.join(tmp, 'opt') } });
    await applyCliInstall(first);
    const moved = linux({ env: { APPIMAGE: path.join(tmp, 'b', 'CodeTrellis.AppImage'), APPDIR: path.join(tmp, 'opt') } });
    const before = planCliInstall(moved);
    assert.ok(before.ok && before.state === 'stale');
    assert.equal(await refreshCliInstall(moved), true);
    assert.equal(fs.readFileSync(path.join(home, '.local', 'bin', 'codetrellis'), 'utf8'), appImageLauncher(path.join(tmp, 'b', 'CodeTrellis.AppImage')));

    fs.writeFileSync(path.join(home, '.local', 'bin', 'codetrellis'), '#!/bin/sh\necho mine\n');
    assert.equal(await refreshCliInstall(moved), false);
    assert.equal(fs.readFileSync(path.join(home, '.local', 'bin', 'codetrellis'), 'utf8'), '#!/bin/sh\necho mine\n');
  });

  test('on launch, nothing is added that the person did not add', async () => {
    assert.equal(await refreshCliInstall(linux()), false);
    assert.equal(fs.existsSync(path.join(home, '.local', 'bin', 'codetrellis')), false);
  });

  test('remove takes away ours, and refuses someone else\'s', async () => {
    await applyCliInstall(linux());
    assert.equal((await removeCliInstall(linux())).ok, true);
    assert.equal(fs.existsSync(path.join(home, '.local', 'bin', 'codetrellis')), false);
    fs.writeFileSync(path.join(home, '.local', 'bin', 'codetrellis'), '#!/bin/sh\necho mine\n');
    const r = await removeCliInstall(linux());
    assert.equal(r.ok, false);
    assert.ok(fs.existsSync(path.join(home, '.local', 'bin', 'codetrellis')));
  });
});
