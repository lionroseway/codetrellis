#!/usr/bin/env sh
# CodeTrellis's conformity check for any CI runner (Phase 33 C2).
#
# Any host that can run a shell can run this: GitHub Actions, GitLab CI,
# Azure Pipelines, Bitbucket Pipelines, Jenkins, Buildkite, a cron job. The
# other recipes in this folder only call it. It needs git (with the base
# fetched: a full clone, or `git fetch origin <base>`), Node 26, and the
# repository checked out in the working directory.
#
#   CODETRELLIS_BASE   the ref the change started from (default: the host's
#                      own variable when it has one, else origin's default)
#   CODETRELLIS_JUNIT  a JUnit XML report your tests wrote, if any
#   CODETRELLIS_SARIF  where to write SARIF 2.1.0 (default codetrellis.sarif)
#   CODETRELLIS_ARGS   more flags for `check`: --strict, --suite payments, …
#
# Exit 0 when the change conforms, 3 when it does not, anything else when
# the check could not run. It writes the SARIF either way, for the host to
# show the findings where the code is.
set -u

SARIF="${CODETRELLIS_SARIF:-codetrellis.sarif}"
BASE="${CODETRELLIS_BASE:-${CI_MERGE_REQUEST_TARGET_BRANCH_NAME:-${SYSTEM_PULLREQUEST_TARGETBRANCH:-${BITBUCKET_PR_DESTINATION_BRANCH:-${CHANGE_TARGET:-${GITHUB_BASE_REF:-}}}}}}"
BASE="${BASE#refs/heads/}"

if ! command -v codetrellis >/dev/null 2>&1; then
  dir="${TMPDIR:-/tmp}/codetrellis"
  [ -d "$dir" ] || git clone --depth 1 https://github.com/lionroseway/codetrellis "$dir"
  (cd "$dir" && npm ci --ignore-scripts && npx patch-package && npm link) >/dev/null
fi

codetrellis start --quiet || exit 1
if [ -n "${CODETRELLIS_JUNIT:-}" ] && [ -f "$CODETRELLIS_JUNIT" ]; then
  codetrellis report-tests "$CODETRELLIS_JUNIT" || true
fi

base_flag=""
if [ -n "$BASE" ]; then
  git rev-parse --verify --quiet "origin/$BASE" >/dev/null || git fetch --quiet origin "$BASE" || true
  base_flag="--base origin/$BASE"
fi

# shellcheck disable=SC2086 # the flags are words, split on purpose
codetrellis check $base_flag ${CODETRELLIS_ARGS:-} --format sarif > "$SARIF"
code=$?
# shellcheck disable=SC2086
codetrellis check $base_flag ${CODETRELLIS_ARGS:-} || true
codetrellis stop
exit "$code"
