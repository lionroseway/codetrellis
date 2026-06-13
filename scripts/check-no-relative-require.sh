#!/usr/bin/env bash
#
# Bundle guard — no relative require('./…') in src/backend.
#
# electron-vite / rollup bundles static `import` and `await import()`, but a
# runtime CommonJS `require('./relative')` is left as-is. On disk in dev it
# resolves fine (and typecheck is happy), so it survives every check EXCEPT the
# one that matters: in the packaged app the relative path doesn't exist next to
# the bundled out/main/main.js, and it throws MODULE_NOT_FOUND at runtime.
#
# This has shipped broken to users twice. This guard fails the build the moment
# a relative require() reappears, on every packaging path (package:mac[:signed],
# package:win, package:linux — incl. the Windows/Linux CI runners).
#
# Bare requires (require('fs'), require('better-sqlite3')) are fine — those are
# Node built-ins / externalized native modules, not relative paths.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${ROOT}/src/backend"

# Match require('./x') / require("../x"); strip the `path:line:` prefix and drop
# matches whose code starts with a line comment so doc examples don't false-trip.
hits="$(
  grep -rnE "require\((['\"])\.\.?/" "$TARGET" --include='*.ts' 2>/dev/null \
    | awk -F: '{ code=$0; sub(/^[^:]*:[0-9]+:/,"",code); if (code !~ /^[[:space:]]*(\/\/|\*)/) print }' \
    || true
)"

if [[ -n "$hits" ]]; then
  echo "✖ bundle guard: relative require() found in src/backend" >&2
  echo "  electron-vite won't bundle these → MODULE_NOT_FOUND in the packaged app." >&2
  echo "  Use a static 'import' (or 'await import()') instead:" >&2
  echo "" >&2
  echo "$hits" | sed 's/^/    /' >&2
  exit 1
fi

echo "✓ bundle guard: no relative require() in src/backend"
