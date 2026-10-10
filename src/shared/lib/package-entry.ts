/**
 * Phase 33 R5 — an outside import, as the package it comes from
 * (RULES-AND-CLARITY §3.3).
 *
 * An import that does not resolve to a file in the project is kept as a
 * package entry: `ecosystem:name`. A package rule names one
 * (`package: npm:stripe`) and says who alone may import it.
 *
 * The name is what the import says, in that language's own spelling:
 *  - npm:      the package, scope kept (`@stripe/stripe-js/pure` → `npm:@stripe/stripe-js`)
 *  - pypi:     the top module (`stripe.api_resources` → `pypi:stripe`)
 *  - go:       the module path (`github.com/stripe/stripe-go/v76/charge` → `go:github.com/stripe/stripe-go`)
 *  - cargo:    the crate (`serde::Deserialize` → `cargo:serde`)
 *  - gem:      the gem (`active_support/core_ext` → `gem:active_support`)
 *  - maven:    the whole dotted name (`com.stripe.Stripe`); a rule names a prefix, `maven:com.stripe`
 *  - nuget:    the whole namespace (`Stripe.Checkout`); a rule names `nuget:Stripe`
 *  - composer: the whole namespace (`Stripe\StripeClient`); a rule names `composer:Stripe`
 *  - swift:    the module (`Stripe`)
 * A rule's package matches an entry that is it, or that starts with it and
 * then the language's separator (`.`, `\`, `/`, `::`), so `maven:com.stripe`
 * covers `maven:com.stripe.model.Charge` and not `maven:com.striped`.
 *
 * The standard library and relative imports are not packages: `node:fs`,
 * Go's `net/http`, Rust's `std::`, `crate::`, `self::`, `super::`.
 * Python and Ruby name the module or the require, not the distribution
 * (`yaml` for PyYAML), which is what the code says.
 */

export const PACKAGE_ECOSYSTEMS = ['npm', 'pypi', 'go', 'cargo', 'maven', 'nuget', 'gem', 'composer', 'swift'] as const;
export type PackageEcosystem = typeof PACKAGE_ECOSYSTEMS[number];

const ECOSYSTEM_RE = new RegExp(`^(${PACKAGE_ECOSYSTEMS.join('|')}):(.+)$`);

/** Whether `s` is a package entry (`npm:stripe`), not a project path. */
export function isPackageEntry(s: string): boolean {
  return ECOSYSTEM_RE.test(s);
}

/** Why a written package name is not one, or null. */
export function packageProblem(s: unknown): string | null {
  if (typeof s !== 'string' || !ECOSYSTEM_RE.test(s.trim())) {
    return `package must be an ecosystem and a name, like npm:stripe (one of ${PACKAGE_ECOSYSTEMS.join(', ')})`;
  }
  return null;
}

const ecosystemOf: Record<string, PackageEcosystem> = {
  typescript: 'npm', javascript: 'npm', tsx: 'npm', jsx: 'npm',
  python: 'pypi', go: 'go', rust: 'cargo', ruby: 'gem',
  java: 'maven', kotlin: 'maven', csharp: 'nuget', php: 'composer', swift: 'swift',
};

const ecosystemOfExt: Record<string, PackageEcosystem> = {
  ts: 'npm', tsx: 'npm', mts: 'npm', cts: 'npm', js: 'npm', jsx: 'npm', mjs: 'npm', cjs: 'npm',
  py: 'pypi', go: 'go', rs: 'cargo', rb: 'gem', java: 'maven', kt: 'maven', kts: 'maven',
  cs: 'nuget', php: 'composer', swift: 'swift',
};

/**
 * The ecosystem whose packages a file can import, from its extension (G10), or
 * null for a file that imports none. A package rule about `npm:stripe` is
 * about the TypeScript files under its `from`, and not the Python ones.
 */
export function ecosystemOfPath(file: string): PackageEcosystem | null {
  const dot = file.lastIndexOf('.');
  return dot > file.lastIndexOf('/') ? ecosystemOfExt[file.slice(dot + 1).toLowerCase()] ?? null : null;
}

/** Whether a package rule (`npm:stripe`) can be about this file: its language imports from that ecosystem. */
export function packageApplies(rulePackage: string, file: string): boolean {
  const eco = ecosystemOfPath(file);
  return eco !== null && rulePackage.startsWith(`${eco}:`);
}

const RUST_LOCAL = new Set(['crate', 'self', 'super', 'std', 'core', 'alloc']);
/** How many path segments name a Go module on hosts that say: `github.com/owner/repo`, `golang.org/x/repo`, `gopkg.in/pkg.v3`. */
const GO_MODULE_SEGMENTS: Array<[RegExp, number]> = [
  [/^golang\.org\/x\//, 3],
  [/^gopkg\.in\//, 2],
  [/^(github\.com|gitlab\.com|bitbucket\.org)\//, 3],
];

/** The package an outside import comes from, or null when it is relative, local or the standard library. */
export function packageEntry(language: string, source: string, isRelative = false): string | null {
  const eco = ecosystemOf[language];
  const s = source.trim();
  if (!eco || !s || isRelative) return null;
  switch (eco) {
    case 'npm': {
      if (s.startsWith('.') || s.startsWith('/') || s.startsWith('node:') || s.startsWith('#')) return null;
      const parts = s.split('/');
      const name = s.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
      return name ? `npm:${name}` : null;
    }
    case 'pypi': {
      if (s.startsWith('.')) return null;
      return `pypi:${s.split('.')[0]}`;
    }
    case 'go': {
      const first = s.split('/')[0];
      if (!first.includes('.')) return null; // the standard library: fmt, net/http
      const keep = GO_MODULE_SEGMENTS.find(([re]) => re.test(s))?.[1] ?? 3;
      return `go:${s.split('/').slice(0, keep).join('/')}`;
    }
    case 'cargo': {
      const head = s.replace(/^::/, '').split('::')[0];
      return RUST_LOCAL.has(head) ? null : `cargo:${head}`;
    }
    case 'gem': return s.startsWith('.') ? null : `gem:${s.split('/')[0]}`;
    case 'maven':
    case 'nuget':
    case 'swift':
      return `${eco}:${s}`;
    case 'composer': return `composer:${s.replace(/^\\/, '')}`;
  }
  return null;
}

const SEPARATORS = ['/', '.', '\\', '::'];

/** Whether a rule's package (`npm:stripe`, `maven:com.stripe`) covers this entry. */
export function packageMatches(rulePackage: string, entry: string): boolean {
  if (rulePackage === entry) return true;
  const r = ECOSYSTEM_RE.exec(rulePackage);
  const e = ECOSYSTEM_RE.exec(entry);
  if (!r || !e || r[1] !== e[1]) return false;
  return SEPARATORS.some((sep) => e[2].startsWith(r[2] + sep));
}
