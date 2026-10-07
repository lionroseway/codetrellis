/**
 * Phase 32 A7 — architecture rules (awareness spec M7).
 *
 * A rule is a path boundary the team writes down once, kept in the committed
 * `.codetrellis/config.json`: "files under `web/` may not import from `db/`".
 * Patterns are project-relative folder prefixes (`web/`) or globs
 * (`src/**\/ui/**`); `except` names the doors through the wall.
 */

/**
 * How hard a rule holds (Phase 33 R4). `block` fails CI (exit 3) and raises a
 * high signal; `warn` is reported and CI passes (`--strict` makes it block);
 * `guide` is shown to agents whose work touches it, and nothing is checked.
 */
export type RuleStrength = 'block' | 'warn' | 'guide';

export const RULE_STRENGTHS: readonly RuleStrength[] = ['block', 'warn', 'guide'];

export type RuleKind = 'imports' | 'package' | 'symbol' | 'calls' | 'folder' | 'grep' | 'agent';

/**
 * Who judges a rule (Phase 33 B5), whatever its strength: code over the graph
 * and the text (`deterministic`), code by likeness (`fuzzy`, a `match: fuzzy`
 * target), or an agent review against the rule's words (`agent`).
 */
export type RuleEngine = 'deterministic' | 'fuzzy' | 'agent';
export const RULE_ENGINES: readonly RuleEngine[] = ['deterministic', 'fuzzy', 'agent'];

export interface ArchitectureRule {
  /** A slug, unique in the project: `web-not-db`. */
  id: string;
  /**
   * What it checks (Phase 33 R5). `imports`, the default: files in `from`
   * may not import files in `mayNotImport`. `package`: only the files in
   * `only` may import the outside package named in `mayNotImport`
   * (`npm:stripe`); `from` is where the rule applies, everywhere (`**`) when
   * not said. `symbol` (R6): only the files in `only` may import the named
   * export in `mayNotImport` (`src/payments/charge.ts#createCharge`), from
   * its file or through any barrel that passes it on. `calls` (R7): only the
   * files in `only` may make the call in `mayNotImport`: an HTTP host or path
   * (`http:api.stripe.com`) or a SQL table (`sql:payments`). `folder` (R8):
   * the files in the folder `from` are named to `files`, of the `kinds`, and
   * export one name each when `exports` is `one`; `mayNotImport` is empty.
   * `grep` (B2): the files in `in` (less `except`) may not hold the text in
   * `mayNotImport` on any line, or with `must`, must hold it on one; `from`
   * is `**`. `agent` (B5): words an agent review judges the files in `in`
   * by, kept in `mayNotImport`; no code checks it.
   */
  kind?: RuleKind;
  /** The files the rule is about: `web/`. */
  from: string;
  /** What they may not import: `db/`, or for a package rule the package, `npm:stripe`. */
  mayNotImport: string;
  /**
   * How a package, symbol or call rule's target is matched (Phase 33 B1):
   * absent, exactly as it always was; `glob` (`http:*.stripe.com`); `regex`
   * (`http:api\\.(stripe|paypal)\\.com(/.*)?`). See shared/lib/matcher.ts.
   */
  match?: 'glob' | 'regex' | 'fuzzy';
  /**
   * A fuzzy target's threshold (Phase 33 B3): how alike, above 0.5 and below
   * 1, an entry must be to match; 0.85 unless the rule says.
   */
  threshold?: number;
  /** A grep rule's files (B2): `src/backend/`, `src/routes/*.ts`. */
  in?: string[];
  /** A grep rule that requires its text, rather than forbidding it (B2). */
  must?: boolean;
  /** A grep rule's text, in any case (B2). */
  ignoreCase?: boolean;
  /** A package rule's files that alone may import it: `src/payments/index.ts`. */
  only?: string[];
  /** A folder rule's name patterns (R8): `*-service.ts`. */
  files?: string[];
  /** A folder rule's file kinds, by extension (R8): `ts`. */
  kinds?: string[];
  /** A folder rule's `one`: each file exports one name (R8). */
  exports?: 'one';
  /** The judgement half of a folder rule, in prose, for people and agents (R8). Never checked. */
  guide?: string;
  /** Files they may import all the same: `db/types.ts`; for a package rule, parts of it they may (`npm:stripe/types`). */
  except: string[];
  /** Why, in the team's words: "web talks to db through the API". */
  because: string;
  /** When it was set (ISO). */
  since: string;
  /** Who set it, from the transport. */
  by: string;
  /**
   * How hard it holds. A rule written before Phase 33 R4 has none and read as
   * `block`, which is what it did then; a new rule starts at `warn`.
   */
  strength: RuleStrength;
  /**
   * The suite it is kept in: `.codetrellis/rules/<suite>.yaml` (Phase 33 R1).
   * Absent for a rule still in `.codetrellis/config.json`, where Phase 32 kept
   * them, until a person moves it.
   */
  suite?: string;
}

/** One import that crosses a rule: `from` imports `to`, both project-relative. */
export interface RuleBreach {
  rule: string;
  from: string;
  to: string;
}

/** A rule as the window, an agent and the phone read it. */
export interface RuleView {
  /** Where it is kept: the suite file, or `.codetrellis/config.json` until it is moved. */
  where: string;
  rule: ArchitectureRule;
  /** "web/ may not import db/ (except db/types.ts): web talks to db through the API" */
  words: string;
  /** The imports that break it now, or null when the project's graph is not the one loaded. */
  breaches: RuleBreach[] | null;
  /** "1 import breaks this today", "Nothing breaks this today", or why it cannot be said. */
  breachWords: string;
}
