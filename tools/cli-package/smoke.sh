#!/usr/bin/env bash
# The npm package as a user gets it: packed, installed into an empty prefix
# outside the checkout (so nothing resolves from the repository's own
# node_modules), and run.
#
#   npm run build:cli-package && npm run smoke:cli-package
#
# Needs the registry, for the package's own dependencies. CI runs it on every
# pull request, and the publish workflow runs it on the exact tarball it is
# about to publish (CODETRELLIS_TARBALL).
set -euo pipefail

repo="$(cd "$(dirname "$0")/../.." && pwd)"
work="$(mktemp -d)"
trap 'codetrellis_stop || true; rm -rf "$work"' EXIT
codetrellis_stop() { [[ -x "$work/prefix/bin/codetrellis" ]] && (cd "$repo" && "$work/prefix/bin/codetrellis" stop --data-dir "$work/data" >/dev/null 2>&1); }

tarball="${CODETRELLIS_TARBALL:-}"
if [[ -z "$tarball" ]]; then
  [[ -f "$repo/out/cli-package/package.json" ]] || { echo "No package: run npm run build:cli-package first" >&2; exit 1; }
  tarball="$(cd "$work" && npm pack --silent "$repo/out/cli-package")"
  tarball="$work/$tarball"
fi

echo "== install $(basename "$tarball")"
# With install scripts off: npm 11 still runs them but warns that a later
# version will not, so the package must work without them. better-sqlite3 13
# and node-pty load from the prebuilds they ship.
npm install --global --prefix "$work/prefix" --ignore-scripts --no-audit --no-fund "$tarball" >/dev/null
ct="$work/prefix/bin/codetrellis"

echo "== --version"
version="$("$ct" --version)"
expected="$(node -p "require('$repo/out/cli-package/package.json').version" 2>/dev/null || node -p "require('$repo/package.json').version")"
[[ "$version" == "$expected" ]] || { echo "reported $version, expected $expected" >&2; exit 1; }

echo "== the native modules load from the install"
(cd "$work/prefix/lib/node_modules/codetrellis" 2>/dev/null || cd "$work/prefix/node_modules/codetrellis"
 node -e "new (require('better-sqlite3'))(':memory:'); require('node-pty'); console.log('ok')")

echo "== scan: the grammars parse the sample app"
out="$("$ct" scan --project "$repo/tests/fixtures/sample-app" --data-dir "$work/scan" --json 2>/dev/null | grep '^{')"
echo "$out"
node -e "const r = JSON.parse(process.argv[1]); if (!(r.symbols > 100 && r.parsed > 30)) { console.error('too little parsed'); process.exit(1) }" "$out"

echo "== start, check, stop on this repository"
(cd "$repo" && "$ct" start --quiet --data-dir "$work/data")
(cd "$repo" && "$ct" check --base "${CODETRELLIS_BASE:-HEAD}" --data-dir "$work/data")
codetrellis_stop

echo "== desktop: a usage error is refused before any network"
set +e; "$ct" desktop url --platform beos >/dev/null 2>&1; code=$?; set -e
[[ $code -eq 2 ]] || { echo "expected exit 2, got $code" >&2; exit 1; }

echo "The packed CLI installs and runs."
