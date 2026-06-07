import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { DEFAULT_SETTINGS, type AppSettings, type PowerTriggers } from '../../shared/types';
import { getSettingsDir } from './persistence';

/**
 * Settings service — Phase 13 §D.
 *
 * Owns `<dataDir>/settings.json`. Load at startup, save on every
 * `updateSettings()` call, expose helpers for "what's the configured
 * MCP port?" / "who is the user?" so callers don't all re-read the
 * file.
 *
 * Identity defaults to whatever `git config --get user.name` /
 * `user.email` returns for the project the user is working in — the
 * 95% case is "they already have git configured." Falls back to
 * empty strings (not crashing) if git is missing or the project
 * has no config.
 */

let cached: AppSettings | null = null;

function getSettingsPath(): string {
  // Important: use `getSettingsDir()` not `getDataDir()`. The latter
  // calls back into this module to read `dataDirOverride` — which
  // creates an infinite recursion. settings.json always lives at
  // env-or-default; the data-dir override only affects the DB.
  return path.join(getSettingsDir(), 'settings.json');
}

/**
 * Read the on-disk settings, falling back to defaults for missing
 * fields (additive schema). Mutations always go through
 * `updateSettings()` so the cache stays consistent.
 */
export function getSettings(): AppSettings {
  if (cached) return cached;

  const filePath = getSettingsPath();
  if (!fs.existsSync(filePath)) {
    cached = { ...DEFAULT_SETTINGS };
    return cached;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    cached = mergeWithDefaults(raw);
    return cached;
  } catch (err) {
    console.warn('[Settings] Failed to read settings.json — using defaults:', err);
    cached = { ...DEFAULT_SETTINGS };
    return cached;
  }
}

/**
 * Apply a partial update. Persists immediately (settings are small).
 * Returns the merged result.
 */
export function updateSettings(patch: DeepPartial<AppSettings>): AppSettings {
  const current = getSettings();
  const next: AppSettings = {
    identity: { ...current.identity, ...(patch.identity ?? {}) },
    mcp: { ...current.mcp, ...(patch.mcp ?? {}) },
    plans: { ...current.plans, ...(patch.plans ?? {}) },
    data: { ...current.data, ...(patch.data ?? {}) },
    device: { ...current.device, ...(patch.device ?? {}) },
    power: {
      ...current.power,
      ...(patch.power ?? {}),
      // triggers is a nested object — preserve unspecified flags
      // instead of letting a partial { triggers: { always: true } }
      // patch wipe whileMobileConnected / whileAgentActive.
      triggers: {
        ...current.power.triggers,
        ...((patch.power?.triggers as Partial<PowerTriggers> | undefined) ?? {}),
      },
    },
    firstRunComplete: patch.firstRunComplete ?? current.firstRunComplete,
    updatedAt: new Date().toISOString(),
  };

  // Soft validation: clamp MCP port to a sane range.
  if (next.mcp.port < 1024 || next.mcp.port > 65535) {
    next.mcp.port = DEFAULT_SETTINGS.mcp.port;
  }

  cached = next;
  saveSettings(next);
  return next;
}

/**
 * Read git config from a project directory (or the current working
 * directory if none is provided). Returns `{ name, email }` with
 * empty strings on miss. Used as the source of "what should we
 * pre-populate the Identity section with?".
 */
export function readGitIdentity(projectPath?: string): { name: string; email: string } {
  const cwd = projectPath && fs.existsSync(projectPath) ? projectPath : process.cwd();

  const safeRun = (args: string): string => {
    try {
      return execSync(`git config --get ${args}`, {
        cwd,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return '';
    }
  };

  return {
    name: safeRun('user.name'),
    email: safeRun('user.email'),
  };
}

/**
 * The author key used when persisting plans / tasks / comments.
 * - If the user has set an email in settings, use that.
 * - Otherwise fall back to the legacy role string ("human").
 *   Old rows stay valid; new rows pick up the identity once
 *   the user sets it.
 */
export function getAuthorKey(role: 'human' | 'agent' = 'human'): string {
  const { email } = getSettings().identity;
  return email || role;
}

/**
 * Auto-seed `identity` from `git config` when it's empty. Runs from
 * the project-scan flow on first run — the docs promise identity is
 * seeded from git, this is the implementation.
 *
 * Only populates fields that are currently empty; any value the user
 * has set in the settings panel is preserved. Returns true when a
 * seed actually occurred (caller can log / broadcast).
 */
export function maybeSeedIdentityFromGit(projectPath: string): boolean {
  const current = getSettings();
  const haveEmail = !!current.identity.email;
  const haveDisplayName = !!current.identity.displayName;
  if (haveEmail && haveDisplayName) return false;

  const gitIdentity = readGitIdentity(projectPath);
  const patch: { identity?: { email?: string; displayName?: string } } = {};
  if (!haveEmail && gitIdentity.email) {
    patch.identity = { ...(patch.identity ?? {}), email: gitIdentity.email };
  }
  if (!haveDisplayName && gitIdentity.name) {
    patch.identity = { ...(patch.identity ?? {}), displayName: gitIdentity.name };
  }
  if (!patch.identity) return false;

  updateSettings(patch);
  return true;
}

/**
 * Reset the in-memory cache. Used when tests change the data dir
 * mid-process or when settings are imported externally.
 */
export function resetSettingsCache(): void {
  cached = null;
}

// --- internals ---

function saveSettings(settings: AppSettings): void {
  const filePath = getSettingsPath();
  try {
    const dir = getSettingsDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2));
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.error('[Settings] Failed to save settings.json:', err);
  }
}

/**
 * Backwards-compat field-by-field merge. Exported so the test for
 * 9.7 can exercise default-fill behavior without writing a real
 * settings.json — the pure function is what guarantees older
 * settings files still parse after we add a new section.
 */
export function mergeWithDefaults(raw: any): AppSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  return {
    identity: {
      displayName: typeof raw?.identity?.displayName === 'string' ? raw.identity.displayName : DEFAULT_SETTINGS.identity.displayName,
      email: typeof raw?.identity?.email === 'string' ? raw.identity.email : DEFAULT_SETTINGS.identity.email,
    },
    mcp: {
      port: typeof raw?.mcp?.port === 'number' ? raw.mcp.port : DEFAULT_SETTINGS.mcp.port,
      autodetectOnCollision: typeof raw?.mcp?.autodetectOnCollision === 'boolean' ? raw.mcp.autodetectOnCollision : DEFAULT_SETTINGS.mcp.autodetectOnCollision,
    },
    plans: {
      defaultVisibility: raw?.plans?.defaultVisibility === 'local' ? 'local' : DEFAULT_SETTINGS.plans.defaultVisibility,
      attachmentLocation: raw?.plans?.attachmentLocation === 'user' ? 'user' : DEFAULT_SETTINGS.plans.attachmentLocation,
    },
    data: {
      dataDirOverride: typeof raw?.data?.dataDirOverride === 'string' ? raw.data.dataDirOverride : DEFAULT_SETTINGS.data.dataDirOverride,
      personalSyncPath: typeof raw?.data?.personalSyncPath === 'string' ? raw.data.personalSyncPath : DEFAULT_SETTINGS.data.personalSyncPath,
      personalSyncMode: ['none', 'selective', 'full'].includes(raw?.data?.personalSyncMode) ? raw.data.personalSyncMode : DEFAULT_SETTINGS.data.personalSyncMode,
    },
    device: {
      deviceName: typeof raw?.device?.deviceName === 'string' ? raw.device.deviceName : DEFAULT_SETTINGS.device.deviceName,
      advertise: typeof raw?.device?.advertise === 'boolean' ? raw.device.advertise : DEFAULT_SETTINGS.device.advertise,
      shareAudio: typeof raw?.device?.shareAudio === 'boolean' ? raw.device.shareAudio : DEFAULT_SETTINGS.device.shareAudio,
      mobileApiPort: typeof raw?.device?.mobileApiPort === 'number' && raw.device.mobileApiPort > 0
        ? raw.device.mobileApiPort
        : DEFAULT_SETTINGS.device.mobileApiPort,
    },
    power: {
      triggers: {
        whileMobileConnected: typeof raw?.power?.triggers?.whileMobileConnected === 'boolean'
          ? raw.power.triggers.whileMobileConnected
          : DEFAULT_SETTINGS.power.triggers.whileMobileConnected,
        whileAgentActive: typeof raw?.power?.triggers?.whileAgentActive === 'boolean'
          ? raw.power.triggers.whileAgentActive
          : DEFAULT_SETTINGS.power.triggers.whileAgentActive,
        always: typeof raw?.power?.triggers?.always === 'boolean'
          ? raw.power.triggers.always
          : DEFAULT_SETTINGS.power.triggers.always,
      },
      preventLidCloseSleep: typeof raw?.power?.preventLidCloseSleep === 'boolean'
        ? raw.power.preventLidCloseSleep
        : DEFAULT_SETTINGS.power.preventLidCloseSleep,
      onlyWhenOnAC: typeof raw?.power?.onlyWhenOnAC === 'boolean'
        ? raw.power.onlyWhenOnAC
        : DEFAULT_SETTINGS.power.onlyWhenOnAC,
    },
    firstRunComplete: typeof raw?.firstRunComplete === 'boolean' ? raw.firstRunComplete : DEFAULT_SETTINGS.firstRunComplete,
    updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : '',
  };
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};
