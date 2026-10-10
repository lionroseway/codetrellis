# Release runbook — the release machine

For the Mac that cuts releases (it holds the Apple credentials and the
manifest signing key). Written so a person, or a Claude Code session on
that Mac, can follow it top to bottom. Nothing is uploaded until step 6, and
step 6 only runs once steps 3–5 have passed.

The order is: **build without publishing → prove the packaged app boots →
run the demo against it → check what only a person can → publish what
was tested → the phone.** The build that is published is the build that was
checked, because step 6 uploads the artefacts step 2 made
(`--skip-build`), not a fresh build.

## 0. Before you start

- [ ] On `main`, up to date, clean tree: `git checkout main && git pull && git status`
- [ ] Node 26: `node -v` says v26. If not: `fnm use 26`
- [ ] `gh auth status` is logged in
- [ ] `scripts/release-env.sh` exists (Apple credentials); `scripts/release-signing-key.pem` exists
- [ ] Quit any running CodeTrellis (a second instance moves to other ports, and the demo would talk to the wrong one)

## 1. Version

- [ ] Set the version in `package.json` and `mobile/app.json` (both the same):
      **0.3.0** for the Phase 33 release (rules and clarity; the plan is
      `docs/releases/v0.3.0-plan.md`).
- [ ] Commit it on a branch, PR into `main`, merge when green, pull.
      The release must be built from a commit on `main`.

## 2. Build, do not publish

```bash
npm ci                                   # clean install; never package a dirty node_modules
node scripts/check-patches.cjs           # every patch in patches/ applied
./scripts/release.sh --dry-run           # macOS signed + notarised locally; Windows/Linux on CI
```

- [ ] `release.sh --dry-run` finishes, with every build-stamp check passing.
- [ ] macOS signing is real, for both DMGs:
      `spctl -a -vvv -t install out/make/CodeTrellis-*-arm64.dmg` says **accepted** and
      **Notarized Developer ID**. Same for `-x64.dmg`. (v0.1.13 shipped unsigned; this is the check.)
- [ ] `out/make/` holds the DMGs, Setup and Portable `.exe`, both AppImages, `.deb`, `.rpm`, all at this version.

## 3. The packaged app boots and opens a real database

```bash
CODETRELLIS_DATA_DIR=/tmp/ct-probe \
  out/make/mac-arm64/CodeTrellis.app/Contents/MacOS/CodeTrellis
```

- [ ] `/tmp/ct-probe/data.db` appears and the log reaches **"Backend initialised"**.
- [ ] Quit. Launch again with your normal data dir (no env var), so it opens
      your real `~/.codetrellis` from 0.2.0: projects, plans and history are
      all there. This is the upgrade path users take.
- [ ] Settings → Data → Record says **Intact**.

## 4. The demo, against the packaged app

Leave the packaged app running (normal data dir), open on any project. In
the window, tick **Settings → MCP Server → "Read your screen, clipboard and
microphone"** (the `capture` capability) so the demo can take its pictures.
Untick it again when the demo is done: it is off by default for a reason.

```bash
npm run demo -- --list                                   # every group and its scenes
npm run demo -- --all --pace=fast --shots=/tmp/ct-demo-shots \
  --connector=out/connector/mcp-connector.cjs
```

`--all` plays the main loop, then the Phase 32 groups: `parallel` (many agents
at once), `observe` (how the work stacks up), `record`, `code-history` (how the
code got here), `teams` and `phone`. Each makes its own throwaway repository
and removes it. `docs/DEMO-JOURNEYS.md` says what to watch for in every scene.

- [ ] Every scene ends without an error, and the run ends with **"Nothing
      looked wrong."** A numbered list instead is the release's to-do list:
      each item names what it expected and what it saw.
- [ ] Some steps are yours, and the window asks for them with a card:
      marking an overlap Intended, setting a breakpoint and answering it,
      approving a criterion, approving two plans, resequencing them, deciding the brief.
      Do each when asked; the demo waits up to 3 minutes. (`--decide` only
      works on a dev build, which serves the HTTP route it uses.)
- [ ] The demo moves the window itself: replay plays at 4× and returns to
      live, play-forward opens and closes, Settings opens at a section and
      closes again, and Awareness marks the card a scene is about. If the
      window is left in replay or with Settings open, that is a finding.
- [ ] `/tmp/ct-demo-shots` has one picture per scene, and each shows what its
      caption says. A shot the window never showed is flagged, not saved.
- [ ] Everything the demo changed on disk, it changed back: `git status` in
      `tests/fixtures/sample-app` is clean.

The same Phase 32 scenes run in CI with no window
(`tests/e2e/demo-check.test.ts`), so a failure here that CI did not see is
about the packaged app, the window, or this machine.

## 5. What only a person can check

| # | Do | You should see |
|---|---|---|
| 1 | Open the Timeline, quit the app, relaunch | Every tool call from step 4 is still there, a lane per agent |
| 2 | Replay: scrub back to the middle of step 4 | The graph, the stack and what waited on you, as they were then |
| 3 | Settings → Git and Settings → Review hosts | Keeping remotes current is **off**; review hosts are **off**; turning one on asks you, in the window |
| 4 | Settings → Data → Record; **Export evidence** on the replay bar, then **Verify evidence…** on the file | "Intact" with an entry count; the export names who signed it and verifies as one unbroken chain |
| 5 | Quit the app. In a clone: `npm ci && npm link && codetrellis start && codetrellis status` | A headless backend starts and `status` prints what is in progress |
| 6 | Pair the phone (step 7's build, or the store build) | Needs you, an overlap with Acknowledge / Intended / Reply, the lines of work; a high overlap pushes |
| 7 | First launch of the packaged app | It offers once to add the `codetrellis` command. Choose Add, and give the password if macOS asks |
| 8 | A **new** terminal: `codetrellis --version`, then `which codetrellis` | This version, and `/usr/local/bin/codetrellis` linked into the app |
| 9 | Settings → MCP Server → Command line | It says the command is installed. Remove it, then Add it again: both work |
| 10 | In a clone of this repo: `codetrellis check --base origin/main` | The `layers`, `native` and `conventions` suites hold, exit 0 |
| 11 | The Rules view, then the Checks view | This repo's rulebook. A loosening asks for a signed approval in the window |
| 12 | `codetrellis desktop url` | The last public DMG's URL for this Mac (this version is not public until step 6) |

- [ ] Every row behaves as written. A row that does not is a release blocker
      until someone decides otherwise; write down what happened.

## 6. Publish what was tested

```bash
./scripts/release.sh --skip-build        # uploads out/make/* from step 2
```

- [ ] The public release exists on `lionroseway/codetrellis-releases` with every
      file from step 2, `SHA256SUMS` and `SHA256SUMS.sig`.
- [ ] Replace the script's download page with the real notes:
      `gh release edit vX.Y.Z --repo lionroseway/codetrellis-releases --notes-file docs/releases/vX.Y.Z.md`
- [ ] Bump the version in the releases repo's README download table; push.
- [ ] The installed 0.2.0 offers the update, and the download verifies.

## 7. The phone

The companion changed in Phase 33 (Needs you and awareness), so it ships
with this release. Pairing has not changed since 0.1.14, so no one
re-pairs.

```bash
./scripts/release-mobile.sh                         # iOS: build locally, submit to TestFlight
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
./scripts/release-mobile.sh --platform android      # Android: build; upload by hand
```

- [ ] Install the new build on a real phone and repeat step 5 row 6 against the released desktop.
- [ ] Attach the APK to the GitHub release; say in the notes which phone builds are in it.

## If something fails

Stop before step 6. Nothing is public until then. Write what happened in an
issue (no security details: the source repo is public) and fix it on `main`
with a test, then start again from step 1. A packaging fault is diagnosed
from a clean `npm ci`, never from a reused `node_modules`.
