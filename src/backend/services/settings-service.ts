import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { DEFAULT_SETTINGS, type AppSettings, type PowerTriggers } from '../../shared/types';
import { getSettingsDir } from './persistence';
import { ALL_CAPABILITIES } from './peer-capabilities';
import type { PeerCapabilityName } from '../../shared/types/peer';

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
 * What is wrong with a settings patch, or null when nothing is.
 *
 * Loading normalises every field (`mergeWithDefaults`); writing checked only
 * the port range and the webhook hosts. So `{ mcp: { port: "abc" } }` or an
 * unknown capability name was stored and used as sent, then silently became
 * the default at the next restart — the setting a person saw was not the one
 * they would get (Phase 32 §0.4k). Now a value that is not one is refused
 * with the reason, and nothing is stored. Only fields present are checked;
 * unknown keys are ignored, as they always were.
 */
export function settingsPatchProblem(patch: unknown): string | null {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return 'settings must be an object';
  const p = patch as Record<string, any>;
  const section = (name: string): Record<string, any> | null | string => {
    const v = p[name];
    if (v === undefined) return null;
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return `${name} must be an object`;
    return v;
  };
  const checks: Array<[string, (v: any) => boolean, string]> = [
    ['identity.displayName', (v) => typeof v === 'string', 'text'],
    ['identity.email', (v) => typeof v === 'string', 'text'],
    ['mcp.port', (v) => Number.isInteger(v) && v >= 1024 && v <= 65535, 'a port from 1024 to 65535'],
    ['mcp.autodetectOnCollision', (v) => typeof v === 'boolean', 'true or false'],
    ['mcp.capabilities', (v) => Array.isArray(v) && v.every((c: unknown) => typeof c === 'string' && (ALL_CAPABILITIES as readonly string[]).includes(c)),
      `a list of: ${ALL_CAPABILITIES.join(', ')}`],
    ['mcp.projectScope', (v) => v === 'opened' || v === 'anywhere', 'opened or anywhere'],
    ['mcp.acceptLocalApiChanges', (v) => typeof v === 'boolean', 'true or false'],
    ['plans.defaultVisibility', (v) => v === 'shared' || v === 'local', 'shared or local'],
    ['plans.attachmentLocation', (v) => v === 'project' || v === 'user', 'project or user'],
    ['data.dataDirOverride', (v) => typeof v === 'string', 'text'],
    ['data.personalSyncPath', (v) => typeof v === 'string', 'text'],
    ['data.personalSyncMode', (v) => ['none', 'selective', 'full'].includes(v), 'none, selective or full'],
    ['device.deviceName', (v) => typeof v === 'string', 'text'],
    ['device.advertise', (v) => typeof v === 'boolean', 'true or false'],
    ['device.exposeMobileApi', (v) => typeof v === 'boolean', 'true or false'],
    ['device.shareAudio', (v) => typeof v === 'boolean', 'true or false'],
    ['device.mobileApiPort', (v) => Number.isInteger(v) && v >= 1024 && v <= 65535, 'a port from 1024 to 65535'],
    ['power.preventLidCloseSleep', (v) => typeof v === 'boolean', 'true or false'],
    ['power.onlyWhenOnAC', (v) => typeof v === 'boolean', 'true or false'],
    ['webhooks.allowedHosts', (v) => Array.isArray(v) && v.every((h: unknown) => typeof h === 'string'), 'a list of host names'],
    ['webhooks.allowLoopback', (v) => typeof v === 'boolean', 'true or false'],
    ['updates.autoCheck', (v) => typeof v === 'boolean', 'true or false'],
  ];
  for (const name of ['identity', 'mcp', 'plans', 'data', 'device', 'power', 'webhooks', 'updates']) {
    const sec = section(name);
    if (typeof sec === 'string') return sec;
  }
  for (const [dotted, ok, want] of checks) {
    const [sec, key] = dotted.split('.');
    const v = p[sec]?.[key];
    if (v !== undefined && !ok(v)) return `${dotted} must be ${want}`;
  }
  const triggers = p.power?.triggers;
  if (triggers !== undefined) {
    if (triggers === null || typeof triggers !== 'object' || Array.isArray(triggers)) return 'power.triggers must be an object';
    for (const k of ['whileMobileConnected', 'whileAgentActive', 'always']) {
      if (triggers[k] !== undefined && typeof triggers[k] !== 'boolean') return `power.triggers.${k} must be true or false`;
    }
  }
  if (p.firstRunComplete !== undefined && typeof p.firstRunComplete !== 'boolean') return 'firstRunComplete must be true or false';
  return null;
}

export class SettingsError extends Error {}

/**
 * Apply a partial update. Persists immediately (settings are small).
 * Returns the merged result. Throws `SettingsError` for a patch that is not
 * one (`settingsPatchProblem`), storing nothing.
 */
export function updateSettings(patch: DeepPartial<AppSettings>): AppSettings {
  const problem = settingsPatchProblem(patch);
  if (problem) throw new SettingsError(problem);
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
    webhooks: {
      ...current.webhooks,
      ...(patch.webhooks ?? {}),
      // Replace rather than merge: removing a host must actually remove it.
      allowedHosts: Array.isArray(patch.webhooks?.allowedHosts)
        ? (patch.webhooks.allowedHosts as string[])
        : current.webhooks.allowedHosts,
    },
    updates: {
      autoCheck: typeof patch.updates?.autoCheck === 'boolean' ? patch.updates.autoCheck : current.updates.autoCheck,
    },
    firstRunComplete: patch.firstRunComplete ?? current.firstRunComplete,
    updatedAt: new Date().toISOString(),
  };

  // Soft validation: clamp MCP port to a sane range.
  if (next.mcp.port < 1024 || next.mcp.port > 65535) {
    next.mcp.port = DEFAULT_SETTINGS.mcp.port;
  }

  // The approved-host list is what stands between a cloned repository and an
  // outbound request from inside the user's network (Phase 19, finding 20), so
  // it is re-normalised on the way in rather than trusted from the caller.
  next.webhooks.allowedHosts = [...new Set(
    (next.webhooks.allowedHosts ?? [])
      .filter((h): h is string => typeof h === 'string')
      .map((h) => h.trim().toLowerCase())
      .filter((h) => h.length > 0 && h.length <= 253 && !h.includes('*') && !h.includes('/')),
  )];

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
      // Phase 30. Validated against the real capability names rather than
      // trusted: this list is what the authorisation gate reads, so a
      // malformed settings file must not be able to widen it. An absent or
      // invalid value leaves it undefined, which the gate reads as
      // DEFAULT_GRANTS — the narrower answer.
      // Spread rather than assigned, so an absent grant list stays ABSENT
      // rather than becoming an explicit `undefined`. The gate reads absent
      // as DEFAULT_GRANTS, and a key that exists with no value is a
      // different thing from a key that was never written.
      ...(Array.isArray(raw?.mcp?.capabilities)
        ? {
            capabilities: (raw.mcp.capabilities as unknown[]).filter(
              (c): c is PeerCapabilityName =>
                typeof c === 'string' && (ALL_CAPABILITIES as readonly string[]).includes(c),
            ),
          }
        : {}),
      // An existing settings file predates this field, and the secure value
      // is the default rather than the permissive one — so an upgrade
      // CONFINES path-taking tools rather than leaving them open because
      // nobody had an opinion yet.
      projectScope: raw?.mcp?.projectScope === 'anywhere' ? 'anywhere' : 'opened',
      // Carried item 2b. Only an explicit false turns local API changes off;
      // anything else (absent, malformed) leaves them on, as before.
      ...(raw?.mcp?.acceptLocalApiChanges === false ? { acceptLocalApiChanges: false } : {}),
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
      // Deliberately does NOT inherit from `advertise` for existing profiles.
      // Someone who turned advertising on before these were separated was
      // consenting to discovery, not to a 0.0.0.0 listener they were never
      // shown. Defaulting to false makes them opt in explicitly.
      exposeMobileApi:
        typeof raw?.device?.exposeMobileApi === 'boolean'
          ? raw.device.exposeMobileApi
          : DEFAULT_SETTINGS.device.exposeMobileApi,
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
    webhooks: {
      // Normalised hard, because this list is what stands between a cloned
      // repository and an outbound request from inside the user's network
      // (Phase 19, finding 20). Anything that is not a plain non-empty string
      // is dropped rather than coerced.
      allowedHosts: Array.isArray(raw?.webhooks?.allowedHosts)
        ? [...new Set(
            (raw.webhooks.allowedHosts as unknown[])
              .filter((h): h is string => typeof h === 'string')
              .map((h) => h.trim().toLowerCase())
              .filter((h) => h.length > 0 && h.length <= 253 && !h.includes('*') && !h.includes('/')),
          )]
        : [...DEFAULT_SETTINGS.webhooks.allowedHosts],
      allowLoopback: typeof raw?.webhooks?.allowLoopback === 'boolean'
        ? raw.webhooks.allowLoopback
        : DEFAULT_SETTINGS.webhooks.allowLoopback,
    },
    updates: {
      autoCheck: typeof raw?.updates?.autoCheck === 'boolean' ? raw.updates.autoCheck : DEFAULT_SETTINGS.updates.autoCheck,
    },
    firstRunComplete: typeof raw?.firstRunComplete === 'boolean' ? raw.firstRunComplete : DEFAULT_SETTINGS.firstRunComplete,
    updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : '',
  };
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};
