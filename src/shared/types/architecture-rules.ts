/**
 * Phase 32 A7 — architecture rules (awareness spec M7).
 *
 * A rule is a path boundary the team writes down once, kept in the committed
 * `.codetrellis/config.json`: "files under `web/` may not import from `db/`".
 * Patterns are project-relative folder prefixes (`web/`) or globs
 * (`src/**\/ui/**`); `except` names the doors through the wall.
 */

export interface ArchitectureRule {
  /** A slug, unique in the project: `web-not-db`. */
  id: string;
  /** The files the rule is about: `web/`. */
  from: string;
  /** What they may not import: `db/`. */
  mayNotImport: string;
  /** Files they may import all the same: `db/types.ts`. */
  except: string[];
  /** Why, in the team's words: "web talks to db through the API". */
  because: string;
  /** When it was set (ISO). */
  since: string;
  /** Who set it, from the transport. */
  by: string;
}

/** One import that crosses a rule: `from` imports `to`, both project-relative. */
export interface RuleBreach {
  rule: string;
  from: string;
  to: string;
}

/** A rule as the window, an agent and the phone read it. */
export interface RuleView {
  rule: ArchitectureRule;
  /** "web/ may not import db/ (except db/types.ts): web talks to db through the API" */
  words: string;
  /** The imports that break it now, or null when the project's graph is not the one loaded. */
  breaches: RuleBreach[] | null;
  /** "1 import breaks this today", "Nothing breaks this today", or why it cannot be said. */
  breachWords: string;
}
