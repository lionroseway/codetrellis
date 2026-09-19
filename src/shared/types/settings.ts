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
import type { PeerCapabilityName } from './peer';

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
  /**
   * Phase 30 — what MCP clients may do, per tool, by capability.
   *
   * Absent means `DEFAULT_GRANTS`: read, write, project, files. `terminal`,
   * `settings` and `capture` are off until the user turns them on, so
   * connecting an agent does not by itself hand it a shell, your microphone,
   * or the switch that exposes this desktop to the network.
   *
   * Per-INSTALLATION, not per-agent — one toggle covers every client on this
   * machine. Per-agent grants need a pairing-style moment that MCP has no
   * equivalent of; see the Phase 30 spec.
   */
  capabilities?: PeerCapabilityName[];
  /**
   * Phase 30 — which projects a path-taking MCP tool may reach.
   *
   *  - `'opened'` (default): a tool naming a `project_path` must name a
   *    project that is open. Nothing reaches a path you did not watch get
   *    opened.
   *  - `'anywhere'`: today's behaviour, for a fully autonomous agent.
   *
   * A DIFFERENT AXIS from `capabilities`, which answer which tools may be
   * called at all. This answers which projects those tools may reach.
   *
   * It is not sandboxing and must not be described as such: `open_project`
   * broadcasts `ui-open-project`, which opens a tab and switches to it, so
   * an agent can still widen its own scope — visibly. What `'opened'` buys
   * is that nothing reaches a path the user did not see opened.
   */
  projectScope?: McpProjectScope;
}

/** See `McpSettings.projectScope`. */
export type McpProjectScope = 'opened' | 'anywhere';

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

/**
 * Where outbound channel webhooks are allowed to go.
 *
 * Phase 19, finding 20. A webhook URL comes from
 * `<projectRoot>/.codetrellis/config.json` — a file in the REPOSITORY. So
 * cloning a repo and opening it used to be enough to make this process send
 * plan data to a URL that repo's author chose, from inside the developer's
 * network. The valuable destinations are the ones only that machine can
 * reach: cloud metadata on 169.254.169.254, an internal admin panel, another
 * tool on 127.0.0.1.
 *
 * A URL in a cloned repository has no standing on its own; the user approves
 * the host, once, here.
 */
export interface WebhookSettings {
  /**
   * Hostnames the user has approved as webhook destinations.
   *
   * Matched EXACTLY, case-insensitively. No wildcards — a wildcard is an
   * approval for hosts the user has not seen. Empty by default, so a fresh
   * install fires no webhooks at all until someone decides otherwise.
   */
  allowedHosts: string[];
  /**
   * Permit webhooks to LOOPBACK addresses (127.0.0.0/8, ::1) — and only
   * loopback.
   *
   * A developer running a local webhook receiver is a real case, and refusing
   * it outright would be the kind of rule people work around. But it stays off
   * by default, and it does NOT extend to the rest of the private space: the
   * LAN, and the cloud metadata service on 169.254.169.254, remain
   * unreachable however this is set.
   *
   * With it on, the residual risk is exactly this: a repository you clone can
   * reach a service on your own machine, on a host you have already approved.
   */
  allowLoopback: boolean;
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
   * Phase 19, finding 20 — which hosts outbound channel webhooks may reach.
   * Empty by default: webhook URLs arrive in repository files.
   */
  webhooks: WebhookSettings;
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
    // Omitted rather than spelled out: absent means DEFAULT_GRANTS, and
    // writing the list here would freeze a copy of it that could drift.
    projectScope: 'opened',
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
  // Empty: a webhook URL arrives in a repository file, so nothing is
  // reachable until the user says so (Phase 19, finding 20).
  webhooks: {
    allowedHosts: [],
    allowLoopback: false,
  },
  firstRunComplete: false,
  updatedAt: '',
};
