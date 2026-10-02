# Release runbook — the release machine

For the Mac that cuts releases (it holds the Apple credentials and the
manifest signing key). Written so a person, or a Claude Code session on
that Mac, can follow it top to bottom. Nothing is uploaded until step 6, and
step 6 only runs once steps 3–5 have passed.

The order is: **build without publishing → prove the packaged app boots →
run the demo against it → drive the new features → publish what was
tested → the phone.** The build that is published is the build that was
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
      **0.1.18** for the Phase 32 release (the owner, 2 October; bugs found are
      fixed before 0.2.0).
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
      your real `~/.codetrellis` from 0.1.17: projects, plans and history are
      all there. This is the upgrade path users take.
- [ ] Settings → Data → Record says **Intact**.

## 4. The demo, against the packaged app

Leave the packaged app running (normal data dir), open on any project. In
the window, tick **Settings → MCP Server → "Read your screen, clipboard and
microphone"** (the `capture` capability) so the demo can take its pictures.
Untick it again when the demo is done: it is off by default for a reason.

```bash
npm run demo -- --list
npm run demo -- --pace=fast --shots=/tmp/ct-demo-shots
npm run demo -- --scene=brief --connector=out/connector/mcp-connector.cjs
```

- [ ] Every scene ends without an error. Watch the window, not the terminal:
      each scene narrates itself with a card. `docs/DEMO-JOURNEYS.md` says what
      to look for in each.
- [ ] `/tmp/ct-demo-shots` has one picture per scene, and each shows what its
      caption says.
- [ ] The `brief` scene waits for a person to decide in the window (send back
      or approve). Decide it; `--decide` works only on a dev build.
- [ ] Everything the demo changed on disk, it changed back: `git status` in
      `tests/fixtures/sample-app` is clean.

The demo's 24 scenes predate Phase 32. Step 5 covers what Phase 32 added.

## 5. Drive the new features (Phase 32)

Against the packaged app, with Claude Code (or any MCP agent) connected
through the connector from `docs/recipes/mcp.json`. Use a scratch clone so
nothing real is touched:

```bash
git clone https://github.com/lionroseway/codetrellis /tmp/ct-drive && cd /tmp/ct-drive
git worktree add ../ct-drive-a -b drive-a && git worktree add ../ct-drive-b -b drive-b
```

Open `/tmp/ct-drive` in the app. Each row is a JOURNEYS.md journey; the test
named proves it in CI, and this proves it in the packaged app.

| # | Do | You should see | Journey |
|---|---|---|---|
| 1 | Start an agent in each worktree | Two chips in the top bar, each with its branch and agent; the Awareness tab lists both | A1 |
| 2 | Have both agents edit the same function | Within seconds, an overlap in Awareness; each agent's next tool reply carries a short note naming the other line of work | B1 |
| 3 | Mark the overlap **Intended** | It goes quiet; changing the function again does not repeat it | B5 |
| 4 | Set a breakpoint on a file ("ask me before touching it"), then have an agent write to it | The write is held; the window asks you; approving lets it through | K1 |
| 5 | Open the Timeline, quit the app, relaunch | Every tool call is still there, grouped by agent | Timeline |
| 6 | Replay: scrub back ten minutes | The graph, the stack and what waited on you, as they were then | G1 |
| 7 | Stack and Review tabs | The two lines of work, what clashes, and a merge order with reasons | H1, D2 |
| 8 | Changes tab: compare `drive-a` with `main`; open line history on a changed file | File-by-file diff; each line's commit, author and agent | L6 |
| 9 | Settings → Data → Record; then **Export evidence** on the replay bar, and **Verify evidence…** on the file | "Intact" with an entry count; the export names who signed it and verifies as one unbroken chain | G2 |
| 10 | Settings → Git and Review hosts | Keeping remotes current is **off**; review hosts are **off**. Turning one on asks you, in the window | — |
| 11 | From a terminal in the clone: `npm ci && npm link && codetrellis start && codetrellis status` (app quit first) | Headless backend starts, `status` prints what is in progress | L3 |
| 12 | Pair the phone (step 7's build, or the store build) | Needs you, the overlap with Acknowledge / Intended / Reply, the lines of work; a high overlap pushes | C2 |

- [ ] Every row behaves as written. A row that does not is a release blocker
      until someone decides otherwise; write down what happened.
- [ ] Clean up: `git worktree remove ../ct-drive-a ../ct-drive-b`, delete `/tmp/ct-drive`.

## 6. Publish what was tested

```bash
./scripts/release.sh --skip-build        # uploads out/make/* from step 2
```

- [ ] The public release exists on `lionroseway/codetrellis-releases` with every
      file from step 2, `SHA256SUMS` and `SHA256SUMS.sig`.
- [ ] Replace the script's download page with the real notes:
      `gh release edit vX.Y.Z --repo lionroseway/codetrellis-releases --notes-file docs/releases/vX.Y.Z.md`
- [ ] Bump the version in the releases repo's README download table; push.
- [ ] The installed 0.1.17 offers the update, and the download verifies.

## 7. The phone

The companion changed in Phase 32 (Needs you, overlaps, breakpoints), so it
ships with this release. Pairing has not changed since 0.1.14, so no one
re-pairs.

```bash
./scripts/release-mobile.sh                         # iOS: build locally, submit to TestFlight
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
./scripts/release-mobile.sh --platform android      # Android: build; upload by hand
```

- [ ] Install the new build on a real phone and repeat step 5 row 12 against the released desktop.
- [ ] Attach the APK to the GitHub release; say in the notes which phone builds are in it.

## If something fails

Stop before step 6. Nothing is public until then. Write what happened in an
issue (no security details: the source repo is public) and fix it on `main`
with a test, then start again from step 1. A packaging fault is diagnosed
from a clean `npm ci`, never from a reused `node_modules`.
