---
name: codetrellis-release-notes
description: Write or rewrite the GitHub release notes for a CodeTrellis version on lionroseway/codetrellis-releases. Use when cutting a release, when asked to write release notes or a changelog, or when asked to fix the notes on a release that already shipped.
---

# Release notes

The notes are the only part of a release most people read. They are read by
someone deciding whether to install this, and by someone who already has the
last one and wants to know what changes for them.

`scripts/release.sh` publishes a **download page**, not release notes — a
boilerplate list of files and first-launch tips with no "what's new" in it at
all. That is fine as a floor and wrong as a finished artefact. v0.1.14 shipped
the whole of Phase 19's security hardening, four gates and a dependency sweep,
under the words "installer downloads." Nobody reading it could tell.

So: the script publishes the floor, and you replace it.

```bash
gh release edit v0.1.X --repo lionroseway/codetrellis-releases --notes-file <file>
```

## What good looks like

v0.1.13 is the reference. Copy its shape, not its contents:

1. **One line saying what kind of release this is.** "a big reliability +
   mobile-companion release". A reader decides from that line whether to read on.
2. **Anything they must DO**, before anything they might enjoy. Re-pairing,
   sideloading a new APK, a settings toggle that is now off by default. This
   goes near the top or it gets missed.
3. **What's new, grouped by the surface it touches** — Mobile / Desktop /
   Reliability / Security. Not by phase, not by PR, not by commit.
4. **Downloads** — a table of file → platform.
5. **First-launch notes** — per platform, the thing that goes wrong on first run.

## Write outcomes, not commits

The single biggest difference between notes people read and notes people skip.

| Don't | Do |
|---|---|
| "fix(peer): reconnect state machine" | "A network blip no longer boots you back to the device list" |
| "Phase 27 adds 5 grammars" | "Go, Ruby, C#, Kotlin and Swift codebases now map" |
| "surface plan_versions" | "Every plan now has a revision history you can scroll back through" |
| "refactored the capability matrix" | "Agents are authorised per tool — a tool you have not granted is refused by name" |

Read the commit, then ask: *what can someone do now that they could not
before, or what stopped hurting?* If a change has no answer to that, it does
not belong in the notes — a dependency bump is not news unless it changed
something the user can feel.

Group aggressively. Ninety commits become a dozen bullets. A bullet that
covers five commits is doing its job.

## The rules that are specific to this repo

- **Never claim a property you have not checked.** "signed + notarized" is a
  factual claim about the artefact in the release. v0.1.13's notes said it
  while the DMGs were unsigned — `npm run package:mac` does not sign, and that
  release had been cut with it. Verify before you write it:
  `spctl -a -vvv -t install <dmg>` must say *accepted / Notarized Developer ID*.

- **A security release says what got better, not where the holes were.** The
  source repo is public and the finding register is deliberately not in it. Write
  the posture — "every local transport now authenticates", "remote surfaces are
  off by default and discovery is a separate switch from exposure" — never a
  finding-by-finding map with file paths and versions affected. If a note would
  help someone attack the previous version, cut it. Users still need to know a
  release is a security release and that they should take it.

- **Protocol changes that force re-pairing are the top item.** Pairing changed
  in the 0.1.14 line and the old companion simply could not connect. That is the
  most important sentence in such a release and it must not sit under a fold.

- **Say which mobile artefacts are in this release.** Desktop and companion
  ship in lockstep when the peer protocol moves. If an APK or a TestFlight
  build is not in a release, say so — v0.1.14 silently shipped without an
  Android APK that v0.1.12 and v0.1.13 both had, and the notes said nothing.

- **Footer the source commit.** `Built from lionroseway/codetrellis @ <sha>`
  so a release can always be traced back to a tree.

## Gathering the material

```bash
git log --format="%s%n%b" <previous-release-sha>..<this-release-sha>
```

Read the bodies, not just the subjects — this repo's commit messages explain
*why*, and the why is usually the user-facing sentence you want. Cross-check
against the release's actual assets (`gh release view --json assets`) so the
downloads section describes what is really attached.

## Tone

Plain, specific, and honest about limits. "Not code-signed yet, so SmartScreen
may warn once" is better than silence, and far better than a promise. No
marketing voice, no exclamation marks, no "we're excited to". Emoji section
headers are established in this repo's notes — keep them, sparingly.

Where a known problem remains, name it. Someone who hits it having been warned
files a useful issue; someone who hits it unwarned assumes the release is
broken.
