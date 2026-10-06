/**
 * Phase 33 C4 — files that look like they hold a secret, by name. A review
 * bundle goes to a model provider the person chose, so these are withheld
 * from it whether or not git ignores them: an untracked `.env` is "in the
 * change" as far as git can tell. By name only; it never reads the file.
 */

const TEMPLATE = /\.(example|sample|template|dist)$/i;
const NAMES = /^(\.env(\..+)?|\.npmrc|\.pypirc|\.netrc|\.pgpass|\.htpasswd|credentials(\.json)?|secrets?\.(json|ya?ml|toml)|service-account.*\.json|id_(rsa|dsa|ecdsa|ed25519))$/i;
const EXTENSIONS = /\.(pem|key|p12|pfx|jks|keystore|ppk|tfvars|kdbx)$/i;

/** True when the path's name says it may hold a secret (`.env`, a private key, `.npmrc`), not its template. */
export function looksSecret(p: string): boolean {
  const name = p.split(/[\\/]/).pop() ?? p;
  if (TEMPLATE.test(name)) return false;
  return NAMES.test(name) || EXTENSIONS.test(name);
}
