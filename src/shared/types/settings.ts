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

/**
 * Session-persistence plan / Track A — independent triggers for the
 * "keep desktop awake" assertion. The blocker engages on the *union*
 * of the checked triggers, then AND-gated by `onlyWhenOnAC` if set.
 * No exclusive modes — the user composes the behavior they want.
 */
export interface PowerTriggers {
  /** Hold the assertion while a paired mobile peer's heartbeat is fresh. */
  whileMobileConnected: boolean;
  /** Hold the assertion while any MCP agent has tool-called recently. */
  whileAgentActive: boolean;
  /** Hold the assertion the entire time CodeTrellis is running. */
  always: boolean;
}

export interface PowerSettings {
  triggers: PowerTriggers;
  /**
   * macOS-only: also prevent lid-close sleep via a `caffeinate -s`
   * helper. powerSaveBlocker alone doesn't beat lid-close on Mac.
   * UI hides this toggle on non-darwin platforms.
   */
  preventLidCloseSleep: boolean;
  /**
   * Safety net: when true and the laptop is on battery, the blocker
   * does NOT engage even if a trigger is checked. Prevents the
   * "walked away unplugged → dead battery" footgun.
   */
  onlyWhenOnAC: boolean;
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
   * Session-persistence plan / Track A — desktop awake control.
   * Independent triggers + AC gate + macOS lid-close prevention.
   * All toggles default `false` (no behavior change for existing users).
   */
  power: PowerSettings;
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
    // OFF BY DEFAULT (Phase 19, finding A3).
    //
    // This used to default to `true`, which meant every new profile bound
    // the mobile API on 0.0.0.0 — every interface — and advertised itself
    // over mDNS, on whatever network the machine happened to be on. The
    // bring-your-own-VPN story describes the intended REMOTE model; it did
    // not describe this default.
    //
    // Turning it off collapses the LAN attack surface behind the whole peer
    // finding set: pairing, reconnect, terminal broadcast, the debug
    // endpoints. They exist only once a user has deliberately enabled
    // mobile pairing.
    advertise: false,
    // SEPARATE FROM `advertise`, and also off (Phase 19, finding A3 / 1.4).
    //
    // These were one switch, and worse, only mDNS ever honoured it —
    // `startMobileApiServer()` ran unconditionally, so :19480 bound 0.0.0.0
    // on every launch whatever the setting said. Discovery and exposure are
    // now independent, as the review requires: advertising without a
    // listener is inert, and a listener without advertising is still
    // reachable by anyone who knows the address. The listener is the
    // security-relevant one.
    exposeMobileApi: false,
    shareAudio: false,
    mobileApiPort: 19480,
  },
  power: {
    triggers: {
      whileMobileConnected: false,
      whileAgentActive: false,
      always: false,
    },
    preventLidCloseSleep: false,
    onlyWhenOnAC: true,
  },
  firstRunComplete: false,
  updatedAt: '',
};
