/**
 * Downloading an update, and proving it is the one we were promised.
 *
 * Phase 19, finding 23.
 *
 * WHAT THE APP DID BEFORE
 *
 * It opened the download URL in the system browser and forgot about it. That
 * is safe in the narrow sense — the app downloads and executes nothing — but
 * it also means the sha256 the update API already carries is decoration.
 * Nobody compares it to anything.
 *
 * The moment the app fetches bytes itself, that digest stops being decoration
 * and becomes the control. This module exists to fetch them and check.
 *
 * WHERE THE DIGEST COMES FROM, AND WHY THE WEBSITE IS NOT TRUSTED
 *
 * GitHub publishes a `digest` for every release asset and the update API
 * passes it through. Both the website path and the direct-GitHub fallback
 * carry it, which matters: the website is explicitly allowed to be down, so a
 * check that only worked through the website would silently downgrade to
 * "unverified" exactly when the fallback kicked in.
 *
 * The URL is NOT trusted either, for the same reason. A compromised or spoofed
 * update endpoint could name any host. The host is pinned here to the releases
 * repo and GitHub's asset CDN, checked on EVERY redirect hop rather than only
 * the first — release downloads redirect, so checking once would check the
 * wrong thing.
 *
 * WHERE THE DIGEST COMES FROM NOW
 *
 * A SIGNED MANIFEST, not the update API. `SHA256SUMS` is published with every
 * release alongside a detached Ed25519 signature, and the public key ships in
 * the app. That takes GitHub out of the trust chain: a digest served by the
 * same place as the file proves the bytes arrived intact, not that they are
 * ours. Anyone who took over the releases repo would publish a bad binary and
 * a matching digest together.
 *
 * A release without a valid signed manifest is NOT downloaded. Falling back to
 * the API's digest would mean the guarantee quietly depends on which path the
 * update check happened to take, which is the kind of difference nobody
 * notices until it matters.
 *
 * WHAT IT WILL NOT DO
 *
 * Install. On macOS a DMG can only be revealed in Finder; the user drags it.
 * `electron-updater`-style auto-apply waits for code signing, because
 * replacing a binary in place is only safe when the replacement is provably
 * ours — and a checksum from the same service that named the URL is not that
 * proof. Verification here means "these are the bytes GitHub published", not
 * "these bytes are trustworthy".
 */

import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { getSettingsDir } from './persistence';
import type { UpdateDownloadInfo } from './update-service';
import { verifyManifestSignature, parseManifest, digestFor } from './release-signature';

export type DownloadPhase =
  | 'idle'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'error';

export interface UpdateDownloadState {
  phase: DownloadPhase;
  /** Version being fetched, so a stale UI cannot show progress for the wrong one. */
  version: string | null;
  filename: string | null;
  bytesDownloaded: number;
  totalBytes: number | null;
  /** Absolute path, only once verified. */
  filePath: string | null;
  error: string | null;
}

/**
 * Hosts a release asset may live on.
 *
 * `github.com` issues the redirect; the bytes come from the object store. Both
 * are checked, on every hop.
 */
const ALLOWED_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);

/** Redirects to follow before giving up. GitHub uses one; three is slack. */
const MAX_REDIRECTS = 3;

/**
 * Ceiling on what we will write to disk.
 *
 * The installers are ~170MB. 600MB is generous and still bounds what a
 * compromised update endpoint can make this process store.
 */
const MAX_BYTES = 600 * 1024 * 1024;

const REQUEST_TIMEOUT_MS = 30_000;

let state: UpdateDownloadState = {
  phase: 'idle',
  version: null,
  filename: null,
  bytesDownloaded: 0,
  totalBytes: null,
  filePath: null,
  error: null,
};

/** One at a time. See `startUpdateDownload`. */
let inFlight: Promise<UpdateDownloadState> | null = null;
let cancelled = false;

export function getUpdateDownloadState(): UpdateDownloadState {
  return state;
}

/** Where verified installers land. Inside the data dir, never a user path. */
function downloadDir(): string {
  return path.join(getSettingsDir(), 'updates');
}

/** A filename from a remote service is not a path. Reduce it to one segment. */
function safeFilename(name: string): string {
  const base = path.basename(String(name ?? '')).replace(/[^A-Za-z0-9._-]/g, '');
  if (!base || base === '.' || base === '..') return 'codetrellis-update';
  return base.slice(0, 128);
}

function assertAllowedUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Update download URL is not a URL');
  }
  if (url.protocol !== 'https:') {
    throw new Error(`Update download must be https (got "${url.protocol}")`);
  }
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    // The host came from an update endpoint, which is exactly the thing that
    // could be lying. Pin it rather than follow it.
    throw new Error(`Update download host "${url.hostname}" is not a release host`);
  }
  return url;
}

/** Hex compare that does not leak length or position, and never throws. */
function digestsEqual(a: string, b: string): boolean {
  const x = Buffer.from(String(a ?? '').toLowerCase(), 'utf-8');
  const y = Buffer.from(String(b ?? '').toLowerCase(), 'utf-8');
  if (x.length !== y.length || x.length === 0) return false;
  return timingSafeEqual(x, y);
}

/**
 * Fetch to `dest`, hashing as we go, following only allowed redirects.
 * Resolves with the hex sha256 of what was written.
 */
function fetchToFile(url: URL, dest: string, expectedBytes: number | null, hops = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    if (hops > MAX_REDIRECTS) return reject(new Error('Too many redirects'));

    const req = https.get(
      url,
      { timeout: REQUEST_TIMEOUT_MS, headers: { 'user-agent': 'CodeTrellis' } },
      (res) => {
        const status = res.statusCode ?? 0;

        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          let next: URL;
          try {
            // Re-validate the HOP, not just the original URL. A redirect is a
            // new destination, and it is the one the bytes actually come from.
            next = assertAllowedUrl(new URL(res.headers.location, url).toString());
          } catch (err) {
            return reject(err);
          }
          return fetchToFile(next, dest, expectedBytes, hops + 1).then(resolve, reject);
        }

        if (status !== 200) {
          res.resume();
          return reject(new Error(`Update download failed: HTTP ${status}`));
        }

        const declared = Number(res.headers['content-length'] ?? 0);
        if (declared && declared > MAX_BYTES) {
          res.destroy();
          return reject(new Error('Update download is larger than we are willing to store'));
        }
        if (declared && expectedBytes && declared !== expectedBytes) {
          // The update API told us a size. A different one means we are not
          // fetching the artifact that digest describes.
          res.destroy();
          return reject(new Error('Update download size does not match the published size'));
        }

        state = { ...state, totalBytes: declared || expectedBytes || null };

        const hash = createHash('sha256');
        const out = fs.createWriteStream(dest, { mode: 0o600 });
        let written = 0;

        const fail = (err: Error) => {
          res.destroy();
          out.destroy();
          reject(err);
        };

        res.on('data', (chunk: Buffer) => {
          if (cancelled) return fail(new Error('Cancelled'));
          written += chunk.length;
          if (written > MAX_BYTES) return fail(new Error('Update download exceeded its size cap'));
          hash.update(chunk);
          state = { ...state, bytesDownloaded: written };
        });

        res.on('error', fail);
        out.on('error', fail);
        res.pipe(out);
        out.on('finish', () => resolve(hash.digest('hex')));
      },
    );

    req.on('timeout', () => req.destroy(new Error('Update download timed out')));
    req.on('error', reject);
  });
}

/**
 * Download an update and verify it.
 *
 * ONE AT A TIME. A launch check racing a scheduled check, or a user clicking
 * twice, would otherwise pull ~170MB twice — which on a metered or slow
 * connection is the difference between updating and giving up.
 */
export function startUpdateDownload(
  version: string,
  info: UpdateDownloadInfo,
): Promise<UpdateDownloadState> {
  if (inFlight) return inFlight;

  cancelled = false;
  inFlight = (async (): Promise<UpdateDownloadState> => {
    try {
      const url = assertAllowedUrl(info.url);
      const filename = safeFilename(info.filename || path.basename(url.pathname));

      // THE DIGEST COMES FROM THE SIGNED MANIFEST, NOT THE UPDATE API.
      //
      // Fetched from the same release, next to the installer, and signed with
      // a key that lives on one machine and never in CI. If this fails the
      // download does not happen at all — the user stays on the browser path,
      // where nothing implies verification, rather than getting an in-app
      // download that only looks checked.
      const expectedSha256 = await fetchSignedDigest(url, filename);

      const dir = downloadDir();
      fs.mkdirSync(dir, { recursive: true });
      const dest = path.join(dir, filename);
      const partial = `${dest}.part`;

      state = {
        phase: 'downloading',
        version,
        filename,
        bytesDownloaded: 0,
        totalBytes: info.size ?? null,
        filePath: null,
        error: null,
      };

      // Write to `.part` and rename only once verified, so a half-written or
      // wrong-hash file is never sitting there looking like an installer.
      try { fs.rmSync(partial, { force: true }); } catch { /* */ }
      const actual = await fetchToFile(url, partial, info.size ?? null);

      state = { ...state, phase: 'verifying' };

      if (!digestsEqual(actual, expectedSha256)) {
        try { fs.rmSync(partial, { force: true }); } catch { /* */ }
        throw new Error(
          'Downloaded file does not match the published checksum. It has been deleted.',
        );
      }

      fs.renameSync(partial, dest);
      state = { ...state, phase: 'ready', filePath: dest };
      console.log(`[Update] Verified ${filename} — sha256 matches the published digest`);
      return state;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message !== 'Cancelled') console.warn(`[Update] Download failed: ${message}`);
      state = {
        ...state,
        phase: message === 'Cancelled' ? 'idle' : 'error',
        error: message === 'Cancelled' ? null : message,
        filePath: null,
      };
      return state;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Fetch `SHA256SUMS` + `SHA256SUMS.sig` from the same release and return the
 * digest they publish for `filename`.
 *
 * Throws unless the signature checks out AND the manifest names this file. A
 * manifest that verifies but omits the artifact is not a pass: it would mean
 * signing something, then downloading something else.
 */
async function fetchSignedDigest(assetUrl: URL, filename: string): Promise<string> {
  // Release assets share a directory, so the manifest sits next to the
  // installer. Derived from the ALREADY-VALIDATED asset URL rather than
  // composed from anything the update API said.
  const base = assetUrl.toString().replace(/\/[^/]*$/, '');
  const manifestUrl = assertAllowedUrl(`${base}/SHA256SUMS`);
  const signatureUrl = assertAllowedUrl(`${base}/SHA256SUMS.sig`);

  let manifest: Buffer;
  let signature: string;
  try {
    [manifest, signature] = await Promise.all([
      fetchSmall(manifestUrl),
      fetchSmall(signatureUrl).then((b) => b.toString('utf-8')),
    ]);
  } catch {
    throw new Error(
      'This release does not publish a signed checksum manifest, so the download ' +
      'cannot be verified. Use the download link instead.',
    );
  }

  if (!verifyManifestSignature(manifest, signature)) {
    throw new Error(
      'The release checksum manifest is not signed by CodeTrellis. Refusing to download.',
    );
  }

  const digest = digestFor(parseManifest(manifest.toString('utf-8')), filename);
  if (!digest) {
    throw new Error(`The signed manifest does not list ${filename}. Refusing to download.`);
  }
  return digest;
}

/** Fetch a small text asset (manifest / signature). Capped hard — these are bytes, not files. */
function fetchSmall(url: URL, hops = 0): Promise<Buffer> {
  const MAX_SMALL = 64 * 1024;
  return new Promise((resolve, reject) => {
    if (hops > MAX_REDIRECTS) return reject(new Error('Too many redirects'));
    const req = https.get(
      url,
      { timeout: REQUEST_TIMEOUT_MS, headers: { 'user-agent': 'CodeTrellis' } },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          let next: URL;
          try {
            next = assertAllowedUrl(new URL(res.headers.location, url).toString());
          } catch (err) {
            return reject(err);
          }
          return fetchSmall(next, hops + 1).then(resolve, reject);
        }
        if (status !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${status}`));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > MAX_SMALL) { res.destroy(); return reject(new Error('Manifest too large')); }
          chunks.push(c);
        });
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('Timed out')));
    req.on('error', reject);
  });
}

export function cancelUpdateDownload(): UpdateDownloadState {
  if (inFlight) cancelled = true;
  return state;
}

/** Test seam. */
export function _resetUpdateDownloadState(): void {
  state = {
    phase: 'idle', version: null, filename: null,
    bytesDownloaded: 0, totalBytes: null, filePath: null, error: null,
  };
  inFlight = null;
  cancelled = false;
}

export const _internals = { assertAllowedUrl, safeFilename, digestsEqual, ALLOWED_HOSTS, MAX_BYTES };
