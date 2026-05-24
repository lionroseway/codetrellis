/**
 * Per-project configuration — Phase 1.1 of the CDev target architecture
 * (see `docs/cdev/14-configuration-and-personal-continuity.md` and
 * `docs/cdev/IMPLEMENTATION.md`).
 *
 * Lives at `<projectRoot>/.codetrellis/config.json`. Committed to the
 * manifest like any other plan/item file so the team's agreed
 * conventions travel with the project.
 *
 * Every field is optional. The override resolution rule is
 * **per-item > per-project > per-user**. An absent field means
 * "fall through to the user setting" (`AppSettings`).
 *
 * Schema is intentionally narrow at first; it grows as features land
 * (channels routing, sensor sensitivity, documentation policy, etc.).
 * New fields ADD only — never rename or remove existing keys, so older
 * config files keep parsing cleanly.
 */

import type { DefaultPlanVisibility, AttachmentLocation } from './settings';

export interface ProjectPlansConfig {
  /**
   * Per-project override for the default visibility of newly-created
   * plans. When absent, falls through to the per-user setting.
   */
  defaultVisibility?: DefaultPlanVisibility;
  /**
   * Per-project override for where binary attachments (images, videos)
   * are stored. When absent, falls through to the per-user setting.
   */
  attachmentLocation?: AttachmentLocation;
}

export interface ProjectConfig {
  plans?: ProjectPlansConfig;
  /** ISO timestamp of last save. Updated automatically. */
  updatedAt?: string;
}

/**
 * What a freshly-initialised project config looks like. Empty by
 * design — projects opt in to overrides explicitly.
 */
export const EMPTY_PROJECT_CONFIG: ProjectConfig = {};
