/**
 * Persisted user settings — stored at `<dataDir>/settings.json`.
 *
 * Phase 13 §D. Source-of-truth for the in-app Settings panel +
 * read by services that need configurable values (MCP port, default
 * plan visibility, etc.).
 *
 * Backwards-compat rule: every field has a sensible default at the
 * read layer (`getSettings()`), so older settings files missing new
 * fields don't break anything. New fields ADD only — never rename or
 * remove.
 */

import type { DeviceSettings } from './peer';

export interface IdentitySettings {
  /** Display name shown in attributions. */
  displayName: string;
  /**
   * Stable id used as the canonical author key (an email address).
   * Defaults to `git config --get user.email` of the active project on
   * first run. Empty string means "not configured" — services fall back
   * to the role-based legacy values ("human" / "agent").
   */
  email: string;
}

export interface McpSettings {
  /** Preferred port. Default 19432. */
  port: number;
  /**
   * If the preferred port is in use, try the next 5 ports before
   * failing. The actually-bound port is reported via `getMcpStatus()`.
   */
  autodetectOnCollision: boolean;
}

export type DefaultPlanVisibility = 'shared' | 'local';

/**
 * Phase 15 §15.D — where do uploaded image / video / pasted-bytes
 * attachments live on disk?
 *
 *   - `'project'` (default): under `<project>/.codetrellis/attachments/<item-uid>/`.
 *     Rides with the plan in git — portable, but inflates repo size.
 *   - `'user'`: under `<userDataDir>/codetrellis/attachments/<item-uid>/`.
 *     Stays out of git — lighter repos, but doesn't follow the plan
 *     when shared across devices / agents.
 *
 * Pure file-ref / URL / code_block / transcript attachments are
 * unaffected (they store paths or inline content, not bytes).
 */
export type AttachmentLocation = 'project' | 'user';

export interface PlansSettings {
  /**
   * Default visibility for newly-created plans. `shared` = export to
   * `<project>/.codetrellis/plans/` so git tracks it. `local` = DB-only.
   * Phase 13 §A reads this when materialising new plans.
   */
  defaultVisibility: DefaultPlanVisibility;
  /**
   * Phase 15 §15.D — where uploaded image/video bytes land.
   * Default `'project'` so attachments ride with the plan in git.
   */
  attachmentLocation: AttachmentLocation;
}

export type PersonalSyncMode = 'none' | 'selective' | 'full';

export interface DataSettings {
  /**
   * Override for `~/.codetrellis/`. Empty string = use the default
   * (or the `CODETRELLIS_DATA_DIR` env var if present).
   * Test harness sets this via env var; users set it in the panel.
   */
  dataDirOverride: string;
  /**
   * Phase 5.3 — path to a user-controlled personal sync directory
   * (a personal git repo or a synced folder like iCloud Drive /
   * Dropbox). CodeTrellis writes a `codetrellis-sync/` sub-directory
   * containing settings, recent-project list, and (in full mode) the
   * pantry DB. The sync mechanism is the user's responsibility — we
   * just read/write to the path.
   *
   * Empty string = no sync configured (default).
   */
  personalSyncPath: string;
  /**
   * Phase 5.3 — what to sync.
   *
   * - `'none'` (default): each machine is independent.
   * - `'selective'`: settings + recent-project list travel.
   * - `'full'`: entire pantry (DB minus machine-local exclusions).
   */
  personalSyncMode: PersonalSyncMode;
}

export interface AppSettings {
  identity: IdentitySettings;
  mcp: McpSettings;
  plans: PlansSettings;
  data: DataSettings;
  /**
   * Phase 9 — device discovery and pairing settings.
   * Controls mDNS advertisement, device name, audio sharing with peers.
   */
  device: DeviceSettings;
  /**
   * Phase 5.1 — true once the user completes the first-run wizard.
   * When false (or absent in older settings files), the frontend
   * shows a blocking onboarding overlay before the main app shell.
   */
  firstRunComplete: boolean;
  /** ISO timestamp of last save. Updated automatically. */
  updatedAt: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  identity: {
    displayName: '',
    email: '',
  },
  mcp: {
    port: 19432,
    autodetectOnCollision: true,
  },
  plans: {
    defaultVisibility: 'shared',
    attachmentLocation: 'project',
  },
  data: {
    dataDirOverride: '',
    personalSyncPath: '',
    personalSyncMode: 'none',
  },
  device: {
    deviceName: '',  // '' = auto-detect from os.hostname()
    advertise: true,
    shareAudio: false,
    mobileApiPort: 19480,
  },
  firstRunComplete: false,
  updatedAt: '',
};
