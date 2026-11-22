#!/usr/bin/env bash
# Demo 03's CI beat, on real GitHub Actions: the sample repository's pull
# request failing the conformity check, then passing it after the fix.
#
#   bash talk/ci.sh            rebuild the repository, run both, record both
#
# The repository is public (lionroseway/acme-customer-api by default; set
# CI_REPO for another you can push to) and holds only the fictional sample.
# Run again and it starts over: `main` and the branch are force-pushed back to
# the breaking commit, the same pull request fails, is recorded, is fixed, and
# is recorded passing. Pages are recorded signed out, so the footage is what
# anyone sees: the commit's ✗ or ✓, and the run with its exit code. (The run's
# log and its summary need a sign-in on GitHub, so they are not on screen.)
#
# Needs `gh` signed in with push rights to CI_REPO.
set -euo pipefail
cd "$(dirname "$0")/.."
. bin/env.sh

REPO="${CI_REPO:-lionroseway/acme-customer-api}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
SRC="$WORK/acme-customer-api"
push() { git -C "$SRC" -c credential.helper='!gh auth git-credential' push -q --force "https://github.com/$REPO.git" "$@"; }

(cd "$REPO_DIR" && node --import tsx video/talk/ci-repo.ts "$SRC" > /dev/null)
gh repo view "$REPO" --json name > /dev/null 2>&1 || gh repo create "$REPO" --public \
  --description "Sample repository for the CodeTrellis demo videos: a small API whose endpoints must go through its services. Fictional; no real data."

# The newest run for the branch's commit, once it has finished: its id.
run_for() {
  local sha="$1" id=""
  for _ in $(seq 1 60); do
    id="$(gh run list --repo "$REPO" --commit "$sha" --json databaseId,status --jq '.[0] | select(.status == "completed") | .databaseId' 2>/dev/null || true)"
    [ -n "$id" ] && { echo "$id"; return; }
    sleep 5
  done
  echo "no finished run for $sha" >&2; return 1
}
record() { # record <capture> <run id> <words for the scenes>
  cat > "$WORK/plan.json" <<JSON
{ "steps": [
  { "title": "The pull request's commits: $3", "url": "https://github.com/$REPO/pull/$PR/commits", "waitFor": "Commits on", "hold": 5 },
  { "title": "The run: $3", "url": "https://github.com/$REPO/actions/runs/$2", "waitFor": "Total duration", "scrollTo": "Total duration", "block": "start", "hold": 6 }
] }
JSON
  node capture/pages.cjs --out="captures/$1" --plan="$WORK/plan.json"
  node capture/encode.cjs "captures/$1" --blend
}

push main:refs/heads/main breach:refs/heads/prefs-save
PR="$(gh pr list --repo "$REPO" --head prefs-save --json number --jq '.[0].number')"
[ -n "$PR" ] || PR="$(gh pr create --repo "$REPO" --base main --head prefs-save \
  --title "Save preferences: validate in the service, add the endpoint" \
  --body 'Story 1 of the customer-preferences epic: `savePreferences` refuses a language that is not a two-letter code, and `PUT /customers/:id/preferences` saves a change.' | sed 's#.*/##')"

FAIL="$(run_for "$(git -C "$SRC" rev-parse breach)")"
[ "$(gh run view "$FAIL" --repo "$REPO" --json conclusion --jq .conclusion)" = failure ] || { echo "the breaking commit's run should fail" >&2; exit 1; }
record ci-fail-hd "$FAIL" "the check has failed"

push fixed:refs/heads/prefs-save
PASS="$(run_for "$(git -C "$SRC" rev-parse fixed)")"
[ "$(gh run view "$PASS" --repo "$REPO" --json conclusion --jq .conclusion)" = success ] || { echo "the fixed commit's run should pass" >&2; exit 1; }
record ci-pass-hd "$PASS" "the check passes"
echo "captures/ci-fail-hd and captures/ci-pass-hd: https://github.com/$REPO/pull/$PR (runs $FAIL, $PASS)"
