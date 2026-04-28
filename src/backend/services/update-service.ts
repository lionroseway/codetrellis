/**
 * OTA update polling — checks if a newer build of CodeTrellis is
 * available, caches the result, and surfaces it via REST so the
 * frontend can render an "Update available" banner.
 *
 * Two sources, in order of preference:
 *
 *   1. **codetrellis.dev** (`CODETRELLIS_OTA_URL`) — the website's
 *      `/api/updates/check` endpoint. This is the long-term source
 *      of truth: the website knows where downloads live, so swapping
 *      the installer host (S3, R2, anywhere) becomes a one-line
 *      change on the site, not a desktop re-ship. Schema documented
 *      in `docs/WEBSITE-BUILD-SPEC.md`.
 *
 *   2. **GitHub Releases** (`https://api.github.com/repos/<repo>/releases/latest`)
 *      — fallback for when the website API isn't live yet (or is
 *      transiently down). Same data, just less flexibility for
 *      future hosting changes.
 *
 * The desktop app **never** auto-downloads or auto-applies. v1
 * surfaces the banner, click → opens the URL in the system browser.
 * Auto-download via `electron-updater` waits for code-signing so
 * the trust chain holds.
 */

import { BUILD_INFO } from '../../shared/build-info';

// --- Public types ---

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'up-to-date' | 'error';

export interface UpdateDownloadInfo {
  url: string;
  filename: string;
  size?: number;
  sha256?: string;
  contentType?: string;
}

export interface UpdateCheckResult {
  available: boolean;
  /** semver of the latest release (no `v` prefix). */
  latest: string;
  /** semver of the running build. */
  current: string;
  /** ISO 8601. */
  publishedAt?: string;
  download?: UpdateDownloadInfo;
  releaseNotes?: { url?: string; markdown?: string };
  /** Where the data came from — useful for debugging. */
  source: 'website' | 'github' | 'cache';
  /** Did we have to fall back from the website to GitHub on this check? */
  websiteFellBackToGithub?: boolean;
}

export interface UpdateState {
  status: UpdateStatus;
  /** ms since epoch of the last completed check (success OR error). */
  lastCheckedAt: number | null;
  /** Last successful check's result (kept across error retries). */
  result: UpdateCheckResult | null;
  /** Last error message, if any. Cleared on the next successful check. */
  lastError: string | null;
  /** The platform we identified ourselves as, for the user's reference. */
  platform: string;
  /** The version we identified as `current`. */
  currentVersion: string;
}

// --- Module state ---

const POLL_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const REQUEST_TIMEOUT_MS = 8000;

const DEFAULT_OTA_URL = 'https://codetrellis.dev';
const DEFAULT_GITHUB_REPO = 'lionroseway/codetrellis-releases';

let state: UpdateState = {
  status: 'idle',
  lastCheckedAt: null,
  result: null,
  lastError: null,
  platform: detectPlatform(),
  currentVersion: BUILD_INFO.version,
};

let pollTimer: NodeJS.Timeout | null = null;
let inFlight: Promise<UpdateState> | null = null;

// --- Public API ---

/** Read the current cached state. Cheap — no network. */
export function getUpdateState(): UpdateState {
  return state;
}

/**
 * Force a fresh check now. Returns the new state. If a check is
 * already in flight, returns that one's promise (no double-fetch).
 */
export async function checkForUpdate(opts: { force?: boolean } = {}): Promise<UpdateState> {
  // Cache: skip the network if we have a recent successful result
  // and the caller didn't force a refresh.
  if (
    !opts.force &&
    state.result !== null &&
    state.lastCheckedAt !== null &&
    Date.now() - state.lastCheckedAt < CACHE_TTL_MS
  ) {
    return state;
  }

  if (inFlight) return inFlight;

  inFlight = (async () => {
    state = { ...state, status: 'checking' };
    try {
      const result = await runCheck();
      state = {
        ...state,
        status: result.available ? 'available' : 'up-to-date',
        result,
        lastCheckedAt: Date.now(),
        lastError: null,
      };
    } catch (err) {
      state = {
        ...state,
        status: 'error',
        lastCheckedAt: Date.now(),
        lastError: err instanceof Error ? err.message : String(err),
      };
    } finally {
      inFlight = null;
    }
    return state;
  })();

  return inFlight;
}

/**
 * Start the auto-poll loop. Runs once immediately (best-effort), then
 * every 24h. Idempotent — calling twice is a no-op.
 */
export function startUpdatePolling(): void {
  if (pollTimer) return;
  // Best-effort initial check. Don't await — boot shouldn't be
  // gated on reaching a remote server.
  checkForUpdate().catch(() => {
    /* error already captured in state */
  });
  pollTimer = setInterval(() => {
    checkForUpdate().catch(() => {
      /* same */
    });
  }, POLL_INTERVAL_MS);
  // Don't keep the process alive just to poll — Electron / tsx
  // already manage the event loop.
  if (typeof pollTimer.unref === 'function') pollTimer.unref();
}

export function stopUpdatePolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// --- Internals ---

function getOtaUrl(): string {
  return process.env.CODETRELLIS_OTA_URL || DEFAULT_OTA_URL;
}

function getGithubRepo(): string {
  return process.env.CODETRELLIS_GITHUB_REPO || DEFAULT_GITHUB_REPO;
}

function detectPlatform(): string {
  const p = process.platform;
  const a = process.arch;
  if (p === 'darwin') return a === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  if (p === 'win32') return a === 'arm64' ? 'win32-arm64' : 'win32-x64';
  if (p === 'linux') return a === 'arm64' ? 'linux-arm64' : 'linux-x64';
  // Unknown platform — return something deterministic, but the
  // remote will return "no asset for that platform" which we
  // surface as "up to date".
  return `${p}-${a}`;
}

async function runCheck(): Promise<UpdateCheckResult> {
  const platform = state.platform;
  const current = state.currentVersion;

  // Try the website first.
  try {
    const websiteResult = await checkViaWebsite(platform, current);
    if (websiteResult) return websiteResult;
  } catch {
    // fall through
  }

  // Fall back to GitHub.
  const githubResult = await checkViaGithub(platform, current);
  return githubResult;
}

async function checkViaWebsite(
  platform: string,
  current: string,
): Promise<UpdateCheckResult | null> {
  const base = getOtaUrl().replace(/\/+$/, '');
  const url = `${base}/api/updates/check?platform=${encodeURIComponent(platform)}&current=${encodeURIComponent(current)}`;

  const res = await timedFetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;

  const ctype = res.headers.get('content-type') || '';
  if (!ctype.includes('application/json')) return null;

  const data = (await res.json()) as Partial<UpdateCheckResult> & { available?: boolean };
  if (typeof data.available !== 'boolean' || typeof data.latest !== 'string') {
    return null;
  }
  return {
    available: data.available,
    latest: data.latest,
    current: data.current ?? current,
    publishedAt: data.publishedAt,
    download: data.download,
    releaseNotes: data.releaseNotes,
    source: 'website',
  };
}

interface GithubRelease {
  tag_name?: string;
  name?: string;
  published_at?: string;
  body?: string;
  html_url?: string;
  assets?: Array<{
    name: string;
    browser_download_url: string;
    size: number;
    content_type: string;
    digest?: string;
  }>;
}

async function checkViaGithub(
  platform: string,
  current: string,
): Promise<UpdateCheckResult> {
  const repo = getGithubRepo();
  const url = `https://api.github.com/repos/${repo}/releases/latest`;
  const res = await timedFetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub releases API ${res.status}`);
  }
  const release = (await res.json()) as GithubRelease;
  const tag = (release.tag_name || '').replace(/^v/, '');
  if (!tag) throw new Error('GitHub release had no tag');

  const asset = pickAssetForPlatform(release.assets ?? [], platform);
  const available = compareSemver(tag, current) > 0;

  return {
    available,
    latest: tag,
    current,
    publishedAt: release.published_at,
    download: asset
      ? {
          url: asset.browser_download_url,
          filename: asset.name,
          size: asset.size,
          contentType: asset.content_type,
          sha256: extractSha256(asset.digest),
        }
      : undefined,
    releaseNotes: release.html_url
      ? { url: release.html_url, markdown: release.body }
      : undefined,
    source: 'github',
    websiteFellBackToGithub: true,
  };
}

function pickAssetForPlatform(
  assets: NonNullable<GithubRelease['assets']>,
  platform: string,
): NonNullable<GithubRelease['assets']>[number] | null {
  // Match by filename pattern. Order matters — `Setup` should
  // win over `Portable` on Windows, AppImage over zip on Linux.
  const matches = (name: string, pattern: RegExp) => pattern.test(name);

  const byPlatform: Record<string, RegExp[]> = {
    'darwin-arm64': [/-arm64\.dmg$/i],
    'darwin-x64': [/-x64\.dmg$/i, /\.dmg$/i],
    'win32-x64': [/-Setup-.+\.exe$/i, /-Portable-.+\.exe$/i, /\.exe$/i],
    'win32-arm64': [/-Setup-.+\.exe$/i, /\.exe$/i],
    'linux-arm64': [/-arm64\.AppImage$/i],
    'linux-x64': [/(?<!arm64)\.AppImage$/i, /\.AppImage$/i],
  };
  const patterns = byPlatform[platform] ?? [];
  for (const pattern of patterns) {
    const found = assets.find((a) => matches(a.name, pattern));
    if (found) return found;
  }
  return null;
}

function extractSha256(digest?: string): string | undefined {
  if (!digest) return undefined;
  const m = digest.match(/^sha256:([a-f0-9]{64})$/i);
  return m ? m[1] : undefined;
}

/**
 * Compare two SemVer strings. Returns 1 if a > b, -1 if a < b, 0 if
 * equal. Defensive against pre-release suffixes (treats `1.0.0-rc.1`
 * as ≤ `1.0.0`).
 */
function compareSemver(a: string, b: string): number {
  const partsA = a.split(/[-+]/)[0].split('.').map((n) => parseInt(n, 10) || 0);
  const partsB = b.split(/[-+]/)[0].split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const x = partsA[i] ?? 0;
    const y = partsB[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  // Same numeric parts. Pre-release loses to no-pre-release.
  const preA = a.includes('-');
  const preB = b.includes('-');
  if (preA && !preB) return -1;
  if (!preA && preB) return 1;
  return 0;
}

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}
