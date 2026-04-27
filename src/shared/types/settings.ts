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

export interface IdentitySettings {
  /** Display name shown in attributions (e.g. "Your Name"). */
  displayName: string;
  /**
   * Stable id used as the canonical author key (e.g. "you@example.com").
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

export interface PlansSettings {
  /**
   * Default visibility for newly-created plans. `shared` = export to
   * `<project>/.codetrellis/plans/` so git tracks it. `local` = DB-only.
   * Phase 13 §A reads this when materialising new plans.
   */
  defaultVisibility: DefaultPlanVisibility;
}

export interface DataSettings {
  /**
   * Override for `~/.codetrellis/`. Empty string = use the default
   * (or the `CODETRELLIS_DATA_DIR` env var if present).
   * Test harness sets this via env var; users set it in the panel.
   */
  dataDirOverride: string;
}

export interface AppSettings {
  identity: IdentitySettings;
  mcp: McpSettings;
  plans: PlansSettings;
  data: DataSettings;
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
  },
  data: {
    dataDirOverride: '',
  },
  updatedAt: '',
};
