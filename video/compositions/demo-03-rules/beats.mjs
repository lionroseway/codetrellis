// Demo 03 · The rule travels with the code (60–90 s). Part 1: check.
// The rule in the repository, promoted from warn to block by a person; an
// agent breaks it and is told; `codetrellis check` fails with exit 3; the run
// is kept; the agent fixes it; the same check passes. Rule checks are
// deterministic: no AI says no. Then the same pull request on GitHub Actions.
// Ends on the passing check, in CI.
const talk = (scene, at) => ({ src: 'talk.mp4', scene, at });
// GitHub's own pages for the sample repository's pull request (talk/ci.sh): the
// same change on real GitHub Actions, failing at the breaking commit, passing
// after the fix. Signed out, so the run's log is not on screen: its exit code is.
const ciFail = (scene, at) => ({ src: 'ci-fail.mp4', scene, at });
const ciPass = (scene, at) => ({ src: 'ci-pass.mp4', scene, at });
const RUN = { fx: 880, fy: 400, z: 1.2 };
const YAML = { fx: 640, fy: 240, z: 1.8 };
const TERM = { fx: 545, fy: 600, z: 1.33 };
const CODE = { fx: 600, fy: 180, z: 1.8 };

export default {
  id: 'demo-03-rules',
  num: '03',
  title: 'The rule travels with the code',
  beats: [
    { dur: 6, clip: talk(10, 1), shots: [{}, { at: 1.2, ...YAML, d: 1.4 }],
      caption: 'The rule is <b>a file in the repository</b>. New rules start at warn.' },
    { dur: 3.6, clip: talk(11, 1.6), shots: [{ fx: 760, fy: 180, z: 1.45 }],
      caption: 'In the Rules view, it holds at <b>warn</b>: said, and passes.' },
    { dur: 9.5, clip: talk(11, 5.2), trimmed: false, shots: [{ fx: 760, fy: 180, z: 1.45 }, { at: 0.2, fx: 640, fy: 470, z: 1.3, d: 1.2 }],
      caption: 'A person promotes it to <b>block</b>. No agent can.' },
    { dur: 4.5, clip: talk(11, 14.7), trimmed: false, shots: [{ fx: 760, fy: 180, z: 1.45 }],
      caption: 'Saved, and checked against the code.' },
    { dur: 5, clip: talk(12, 4), shots: [{ fx: 720, fy: 250, z: 1.4 }],
      caption: 'An agent can <b>propose</b> a rule. A person accepts or rejects.' },
    { dur: 8, clip: talk(13, 3), shots: [{ fx: 790, fy: 440, z: 1.5 }],
      caption: 'An agent imports the database from an endpoint. <b>It is told.</b>' },
    { dur: 9, clip: talk(14, 1.4), shots: [TERM],
      caption: '<code>codetrellis check</code>: does not conform. <b>Exit 3.</b> No AI needed.' },
    { dur: 6, clip: talk(15, 3.5), shots: [{ fx: 600, fy: 270, z: 1.5 }],
      caption: 'The run is kept, <b>beside the rules</b>.' },
    { dur: 4, clip: talk(16, 0.8), shots: [CODE],
      caption: 'The finding, on the line.' },
    { dur: 5, clip: talk(16, 8.4), shots: [CODE],
      caption: 'The agent moves the call <b>into the service</b>.' },
    { dur: 9, clip: talk(17, 1.4), shots: [TERM],
      caption: 'Same check, same rule: <b>conforms</b>.' },
    { dur: 5.5, clip: ciFail(2, 0.3), shots: [RUN, { at: 2.2, fx: 780, fy: 600, z: 1.5, d: 1.3 }],
      caption: 'The same pull request, on GitHub Actions: <b>exit 3</b>.' },
    { dur: 4.5, clip: ciPass(1, 0.3), shots: [{ fx: 520, fy: 440, z: 1.6 }],
      caption: 'After the fix, the same check <b>passes</b>.' },
    { dur: 5, clip: ciPass(2, 0.3), shots: [RUN],
      caption: 'One rule, one check: <b>on a laptop, and in CI</b>.' },
  ],
};
