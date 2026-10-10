#!/usr/bin/env sh
# CodeTrellis agent checks for any CI runner (Phase 33 C5).
#
# Your own agent reviews the change, headless, on your own model and key,
# held to the review's contract: no shell, files or web; every finding cites
# the diff and is checked; each pass is kept as a check run. CodeTrellis never
# holds a model key and never pays for a call. Advisory: it exits 0 unless
# CODETRELLIS_REVIEW_ARGS asks for --fail-on.
#
# Needs git (with the base fetched), Node 26, the repository checked out, and
# the agent's CLI: Claude Code (`npm i -g @anthropic-ai/claude-code`) or Codex.
#
#   CODETRELLIS_REVIEW       the cost dial: auto (default), on-request, off
#   CODETRELLIS_REVIEW_ASKED 1 when someone asked for this run (a label, a
#                            comment, a manual trigger); on-request runs only then
#   CODETRELLIS_AUTH         how the agent signs in: env:ANTHROPIC_API_KEY,
#                            env:CLAUDE_CODE_OAUTH_TOKEN, oidc:bedrock,
#                            oidc:vertex, oidc:foundry (after the host's own
#                            OIDC step), env:OPENAI_API_KEY with --agent codex
#   CODETRELLIS_BASE         the ref the change started from (default: the
#                            host's own variable, else origin's default)
#   CODETRELLIS_SARIF        where to write SARIF 2.1.0 (default codetrellis-review.sarif)
#   CODETRELLIS_MARKDOWN     where to write the markdown (default codetrellis-review.md)
#   CODETRELLIS_REVIEW_ARGS  more flags: --agent codex --model …, --verify,
#                            --skills <dir>, --suite payments, --post, --fail-on block
#
# A pull request from a fork gets no secrets on most hosts; with no
# credential this says so and exits 0.
set -u

dial="${CODETRELLIS_REVIEW:-auto}"
case "$dial" in
  off) echo "codetrellis review: off (CODETRELLIS_REVIEW=off)"; exit 0 ;;
  on-request)
    if [ "${CODETRELLIS_REVIEW_ASKED:-}" != "1" ]; then
      echo "codetrellis review: on request only, and nobody asked for this run"; exit 0
    fi ;;
  auto) ;;
  *) echo "codetrellis review: CODETRELLIS_REVIEW is auto, on-request or off, not '$dial'" >&2; exit 2 ;;
esac

auth="${CODETRELLIS_AUTH:-}"
case "$auth" in
  env:*)
    var="${auth#env:}"
    if [ -z "$(printenv "$var" 2>/dev/null)" ]; then
      echo "codetrellis review: $var is not set (no such secret here, or a fork's pull request, which gets none); nothing reviewed"; exit 0
    fi ;;
  oidc:*|"") ;;
  *) echo "codetrellis review: CODETRELLIS_AUTH is env:<VARIABLE> or oidc:<provider>" >&2; exit 2 ;;
esac

SARIF="${CODETRELLIS_SARIF:-codetrellis-review.sarif}"
MARKDOWN="${CODETRELLIS_MARKDOWN:-codetrellis-review.md}"
BASE="${CODETRELLIS_BASE:-${CI_MERGE_REQUEST_TARGET_BRANCH_NAME:-${SYSTEM_PULLREQUEST_TARGETBRANCH:-${BITBUCKET_PR_DESTINATION_BRANCH:-${CHANGE_TARGET:-${GITHUB_BASE_REF:-}}}}}}"
BASE="${BASE#refs/heads/}"

if ! command -v codetrellis >/dev/null 2>&1; then
  dir="${TMPDIR:-/tmp}/codetrellis"
  [ -d "$dir" ] || git clone --depth 1 https://github.com/lionroseway/codetrellis "$dir"
  (cd "$dir" && npm ci --ignore-scripts && npx patch-package && npm link) >/dev/null
fi

codetrellis start --quiet || exit 1
base_flag=""
if [ -n "$BASE" ]; then
  git rev-parse --verify --quiet "origin/$BASE" >/dev/null || git fetch --quiet origin "$BASE" || true
  base_flag="--base origin/$BASE"
fi
auth_flag=""
[ -n "$auth" ] && auth_flag="--auth $auth"

# One review, three renderings: the words in the log, SARIF for the host's
# code view, markdown for a comment or the job summary.
# shellcheck disable=SC2086 # the flags are words, split on purpose
codetrellis review $base_flag $auth_flag ${CODETRELLIS_REVIEW_ARGS:-} --sarif-out "$SARIF" --markdown-out "$MARKDOWN"
code=$?
codetrellis stop
exit "$code"
