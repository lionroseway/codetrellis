#!/usr/bin/env sh
# CodeTrellis's pipeline for any CI runner (Phase 33 B7).
#
# Runs the stages in the base's .codetrellis/pipeline.yaml (B6), in order and
# beside each other as it says, each stage a check run naming itself; a stage
# grounded by others gets what they found. Without a pipeline file, every rule
# runs in one stage. GitHub Actions and GitLab variants only call this. It
# needs git (with the base fetched), Node 26 and the repository checked out.
#
#   CODETRELLIS_BASE   the ref the change started from (default: the host's
#                      own variable when it has one, else origin's default)
#   CODETRELLIS_STAGE  run one stage only, for a CI that wants a job per stage
#   CODETRELLIS_AUTH   how an agent stage's reviewer signs in:
#                      env:ANTHROPIC_API_KEY, env:CLAUDE_CODE_OAUTH_TOKEN,
#                      oidc:bedrock, … (as review.sh). Unset, or a variable
#                      that is empty (a fork's pull request gets no secrets),
#                      and agent stages are skipped, their rules guides
#   CODETRELLIS_AGENT  the reviewer: claude-code (default) or codex
#   CODETRELLIS_ARGS   more flags for `check`: --strict, --model …
#
# Exit 0 when the pipeline passes, 3 when a stage that is not advisory fails,
# anything else when it could not run. It runs once, so an agent stage's
# review is paid for once.
set -u

BASE="${CODETRELLIS_BASE:-${CI_MERGE_REQUEST_TARGET_BRANCH_NAME:-${SYSTEM_PULLREQUEST_TARGETBRANCH:-${BITBUCKET_PR_DESTINATION_BRANCH:-${CHANGE_TARGET:-${GITHUB_BASE_REF:-}}}}}}"
BASE="${BASE#refs/heads/}"

if ! command -v codetrellis >/dev/null 2>&1; then
  dir="${TMPDIR:-/tmp}/codetrellis"
  [ -d "$dir" ] || git clone --depth 1 https://github.com/lionroseway/codetrellis "$dir"
  (cd "$dir" && npm ci --ignore-scripts && npx patch-package && npm link) >/dev/null
fi

base_flag=""
if [ -n "$BASE" ]; then
  git rev-parse --verify --quiet "origin/$BASE" >/dev/null || git fetch --quiet origin "$BASE" || true
  if git rev-parse --verify --quiet "origin/$BASE" >/dev/null; then base_flag="--base origin/$BASE"; else base_flag="--base $BASE"; fi
fi
stage_flag=""
[ -n "${CODETRELLIS_STAGE:-}" ] && stage_flag="--stage $CODETRELLIS_STAGE"

agent_flag=""
auth="${CODETRELLIS_AUTH:-}"
case "$auth" in
  env:*)
    if [ -n "$(printenv "${auth#env:}" 2>/dev/null)" ]; then
      agent_flag="--agent ${CODETRELLIS_AGENT:-claude-code} --auth $auth"
    else
      echo "codetrellis pipeline: ${auth#env:} is not set (no such secret here, or a fork's pull request); agent stages are skipped"
    fi ;;
  oidc:*) agent_flag="--agent ${CODETRELLIS_AGENT:-claude-code} --auth $auth" ;;
  "") ;;
  *) echo "codetrellis pipeline: CODETRELLIS_AUTH is env:<VARIABLE> or oidc:<provider>" >&2; exit 2 ;;
esac

codetrellis start --quiet || exit 1
# shellcheck disable=SC2086 # the flags are words, split on purpose
codetrellis check --pipeline $base_flag $stage_flag $agent_flag ${CODETRELLIS_ARGS:-}
code=$?
codetrellis stop
exit "$code"
