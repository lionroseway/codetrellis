/**
 * System model — see docs/SYSTEM-MODEL.md
 *
 * A "system" is a coherent unit of code with its own conventions and
 * runtime: an npm package, a Python project, a Rust crate, a standalone
 * TS area, etc. Detected by manifest signals; files belong to their
 * nearest ancestor system.
 */

export type SystemLanguage =
  | 'typescript' | 'javascript'
  | 'python' | 'rust' | 'go'
  | 'php' | 'java' | 'ruby'
  | 'mixed' | 'unknown';

export type ManifestKind =
  | 'package.json'
  | 'pyproject.toml'
  | 'setup.py'
  | 'requirements.txt'
  | 'Cargo.toml'
  | 'go.mod'
  | 'composer.json'
  | 'pom.xml'
  | 'build.gradle'
  | 'build.gradle.kts'
  | 'Gemfile'
  | 'tsconfig.json'
  | 'pnpm-workspace.yaml'
  | 'nx.json'
  | 'turbo.json'
  | 'informal';

export interface DiscoveredSystem {
  /** Stable id derived from the root path */
  id: string;
  /** Display name (from manifest or directory name) */
  name: string;
  /** Absolute path to the system root */
  rootPath: string;
  /** Path relative to project root (empty string for the project-root system) */
  relativeRoot: string;
  /** Primary language */
  language: SystemLanguage;
  /** Which manifest signaled this system */
  manifestKind: ManifestKind;
  /** Absolute path to the manifest file (null for informal systems) */
  manifestPath: string | null;
  /** Whether the manifest declares sub-workspaces */
  isWorkspaceRoot: boolean;
  /** Workspace globs if this is a workspace root */
  workspaceGlobs?: string[];
  /** npm-style package name if applicable (drives alias resolution) */
  packageName?: string;
  /** Candidate entry points relative to rootPath (for alias resolution) */
  entryHints?: string[];
  /** Raw manifest data subset — useful for downstream consumers */
  packageMeta?: {
    main?: string;
    source?: string;
    types?: string;
    module?: string;
    exports?: unknown;
  };
}

/**
 * One workspace-alias mapping. The resolver tries the longest-prefix
 * match first.
 */
export interface AliasMapping {
  alias: string;          // e.g. "@swf/ui" or "@app"
  rootPath: string;       // absolute directory the alias points at
  /** Optional explicit entry-point candidates (resolver tries these in order) */
  entries?: string[];
  /** Where this alias came from (for debugging) */
  source: 'package' | 'tsconfig-paths';
}
