/**
 * `codetrellis desktop install | url` — the desktop app, from the command line.
 *
 * So a setup script, a provisioning tool or a teammate can get the app in one
 * line instead of finding the right file on the releases page. It picks the
 * installer for this computer (or `--platform`), and `install` downloads it
 * through the app's own update path: the digest comes from the release's
 * signed `SHA256SUMS`, the hosts are pinned on every redirect, and a file that
 * does not match is deleted rather than handed over. Then it copies the
 * verified file where the person asked, checking it again on the way, and
 * opens it unless told not to.
 *
 * It installs nothing silently. Opening a DMG mounts it and opening a Setup
 * exe starts its wizard; the person still drags or clicks through. An
 * AppImage is made executable and its path printed, since running it is the
 * install. `--no-open` (or another platform's installer) only downloads.
 */

import fs from 'node:fs';
import path from 'node:path';
import { flag, type Parsed } from './args';
import type { DesktopRelease, UpdateDownloadInfo } from '../backend/services/update-service';
import type { UpdateDownloadState } from '../backend/services/update-download-service';

export class DesktopUsageError extends Error {}

/** The platforms a release can carry an installer for (update-service's `pickAssetForPlatform`). */
export const DESKTOP_PLATFORMS = ['darwin-arm64', 'darwin-x64', 'win32-x64', 'win32-arm64', 'linux-x64', 'linux-arm64'] as const;

export interface DesktopDeps {
  /** This computer, as `detectPlatform` names it. */
  platform: string;
  findRelease(platform: string, version?: string): Promise<DesktopRelease>;
  /** Download and verify against the signed manifest (update-download-service). */
  download(version: string, info: UpdateDownloadInfo): Promise<UpdateDownloadState>;
  /** Copy the verified file to an absolute path, re-checking its digest. */
  saveCopy(dest: string): Promise<string>;
  /** Hand the file to the system: a DMG mounts, a Setup exe starts. */
  open(file: string): void;
  /** Where a download goes without `--dir`. */
  downloadsDir: string;
}

export interface DesktopResult { out: string; code: number }

export async function desktop(p: Parsed, deps: DesktopDeps): Promise<DesktopResult> {
  const sub = p.rest[0];
  if (sub !== 'install' && sub !== 'url') {
    throw new DesktopUsageError('desktop needs install or url: codetrellis desktop install [--version <v>] [--platform <p>] [--dir <d>] [--no-open]');
  }
  const platform = flag(p, 'platform') ?? deps.platform;
  if (!(DESKTOP_PLATFORMS as readonly string[]).includes(platform)) {
    throw new DesktopUsageError(`--platform must be one of ${DESKTOP_PLATFORMS.join(', ')}${flag(p, 'platform') ? '' : ` (this computer is ${platform})`}`);
  }
  const json = p.flags.json === true;
  const release = await deps.findRelease(platform, flag(p, 'version'));
  const asset = release.download;
  if (!asset) {
    const says = `CodeTrellis ${release.version} has no installer for ${platform}.`;
    return { out: json ? JSON.stringify({ version: release.version, platform, error: says }) : says, code: 1 };
  }

  if (sub === 'url') {
    return {
      out: json
        ? JSON.stringify({ version: release.version, platform, filename: asset.filename, url: asset.url, size: asset.size ?? null })
        : asset.url,
      code: 0,
    };
  }

  const dir = path.resolve(flag(p, 'dir') ?? deps.downloadsDir);
  fs.mkdirSync(dir, { recursive: true });
  const state = await deps.download(release.version, asset);
  if (state.phase !== 'ready') {
    const says = `CodeTrellis ${release.version} was not downloaded: ${state.error ?? 'the download did not finish'}`;
    return { out: json ? JSON.stringify({ version: release.version, platform, error: says }) : says, code: 1 };
  }
  const saved = await deps.saveCopy(path.join(dir, path.basename(state.filename ?? asset.filename)));

  const appImage = /\.AppImage$/i.test(saved);
  if (appImage) fs.chmodSync(saved, 0o755);
  // Another computer's installer, or asked not to: download only.
  const open = p.flags['no-open'] !== true && platform === deps.platform && !appImage;
  if (open) deps.open(saved);

  if (json) {
    return { out: JSON.stringify({ version: release.version, platform, path: saved, sha256: state.sha256, opened: open }), code: 0 };
  }
  const lines = [
    `Downloaded CodeTrellis ${release.version} for ${platform}, checked against the release's signed checksums:`,
    `  ${saved}`,
  ];
  if (open) lines.push(platform.startsWith('darwin') ? 'Opened it: drag CodeTrellis to Applications.' : 'Opened the installer.');
  else if (appImage && platform === deps.platform) lines.push(`Run it with: ${saved}`);
  return { out: lines.join('\n'), code: 0 };
}
